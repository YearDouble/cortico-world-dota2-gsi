import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { DotaState } from '../src/state.js'
import { createTools } from '../src/tools.js'

const frames = JSON.parse(fs.readFileSync(new URL('../data/sample-match.json', import.meta.url), 'utf8'))

function toolMap(state) {
  return new Map(createTools(state, { timezone: 'Asia/Shanghai' }).map((tool) => [tool.name, tool]))
}

function feed(state, list) {
  for (const frame of list) state.ingest(frame, Date.now())
}

test('五个工具，名字和只读标签都对', () => {
  const tools = createTools(new DotaState())
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['dota_status', 'dota_events', 'dota_match', 'dota_minimap', 'dota_mode'],
  )
  for (const tool of tools) assert.deepEqual(tool.tags, ['read'])
})

test('dota_mode：只查、手动设、设回 auto，都写进设置（Coo 也能改的通道）', async () => {
  const saved = []
  const state = new DotaState({ cfg: { mode: { force: 'auto' } } })
  const tools = new Map(
    createTools(state, {
      timezone: 'Asia/Shanghai',
      persist: (patch) => {
        // 和宿主 persist 的深合并语义一致（数组整体替换、对象深合并）。
        for (const [key, value] of Object.entries(patch)) {
          if (typeof value === 'object' && value !== null && typeof saved[key] === 'object' && saved[key] !== null) {
            saved[key] = { ...saved[key], ...value }
          } else {
            saved[key] = value
          }
        }
      },
    }).map((tool) => [tool.name, tool]),
  )
  const mode = tools.get('dota_mode')

  // 只查不改：不写设置。
  const query = await mode.handler({})
  assert.match(query, /^\[ok\] 当前模式/)
  assert.equal(saved.mode, undefined, '查询不该动设置')

  // Coo/用户设成加速：立即生效 + 写进设置。
  const set = await mode.handler({ mode: 'turbo' })
  assert.match(set, /模式已设为「加速」/)
  assert.equal(state.mode.mode, 'turbo')
  assert.equal(state.mode.basis, 'manual')
  assert.deepEqual(saved.mode?.force, 'turbo')

  // 手动优先：推断信号不再改判。
  state.mode.observe({ player: { xpm: 550 } }, 450)
  assert.equal(state.mode.mode, 'turbo')

  // 设回 auto：恢复推断（unknown，等证据）。
  const back = await mode.handler({ mode: 'auto' })
  assert.match(back, /恢复推断/)
  assert.equal(state.mode.mode, 'unknown')
  assert.deepEqual(saved.mode?.force, 'auto')

  // 非法值拒绝。
  const bad = await mode.handler({ mode: 'fastest' })
  assert.match(bad, /^\[fail\]/)
})

test('dota_minimap 没数据时说清楚，有位置库时给名单', async () => {
  const empty = toolMap(new DotaState()).get('dota_minimap')
  assert.match(await empty.handler({}), /^\[ok\] 还没有收到 Dota 2 的数据/)
})

test('没数据时 dota_status 给配置提示', async () => {
  const tools = toolMap(new DotaState())
  const text = await tools.get('dota_status').handler({})
  assert.match(text, /^\[ok\]/)
  assert.match(text, /还没有收到/)
})

test('对局中 dota_status 给卡片', async () => {
  const state = new DotaState()
  feed(state, frames.slice(0, 5))
  const text = await toolMap(state).get('dota_status').handler({})
  assert.match(text, /^\[ok\] \[刀塔战况\]/)
  assert.match(text, /生命 900\/900/)
})

test('dota_events 按分钟过滤，参数越界会说明', async () => {
  const state = new DotaState()
  feed(state, frames)
  const text = await toolMap(state).get('dota_events').handler({ minutes: 999, limit: 3 })
  assert.match(text, /^\[ok\]/)
  assert.match(text, /minutes 超出范围/)
  const lines = text.split('\n')
  assert.equal(lines.filter((line) => line.startsWith('[刀塔')).length, 3)
})

test('dota_match 没记录时说没有，打完给上一局', async () => {
  const empty = toolMap(new DotaState()).get('dota_match')
  assert.match(await empty.handler({}), /还没有对局记录/)

  const state = new DotaState()
  feed(state, frames)
  const text = await toolMap(state).get('dota_match').handler({})
  assert.match(text, /^\[ok\] 上一局/)
  assert.match(text, /天辉胜/)
  assert.match(text, /12\/5\/9/)
})
