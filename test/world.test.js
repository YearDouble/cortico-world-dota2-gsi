import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'

import definition from '../src/index.js'

const frames = JSON.parse(fs.readFileSync(new URL('../data/sample-match.json', import.meta.url), 'utf8'))

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

function makeCtx(port) {
  return {
    id: 'dota2-gsi',
    cfg: { net: { port, throttle: 0.5, heartbeat: 10 }, display: { rawKeys: false } },
    dataDir: os.tmpdir(),
    timezone: 'Asia/Shanghai',
    botName: 'test',
    persist: () => {},
  }
}

test('定义形状符合 api 6', () => {
  assert.equal(definition.id, 'dota2-gsi')
  assert.equal(typeof definition.label, 'string')
  const defaults = definition.defaults()
  assert.equal(defaults.enabled, false)
  assert.equal(defaults.net.port, 35123)
  assert.equal(typeof definition.create, 'function')
  assert.ok(Array.isArray(definition.describe.events))
})

test('五个工具、环境提示词、面板、配置键都对', () => {
  const world = definition.create(makeCtx(35123))
  assert.equal(world.tools().length, 5)
  assert.ok(world.tools().some((tool) => tool.name === 'dota_mode'), 'dota_mode（手动指定模式）在列')
  assert.deepEqual(world.envPromptVars(), {})

  const web = world.webUi('zh')
  assert.equal(web.panels[0].id, 'live')
  assert.ok(fs.existsSync(web.promptDocs[0].path))
  for (const group of web.config) {
    for (const key of Object.keys(group.schema.properties)) {
      assert.ok(key.startsWith('worlds.dota2-gsi.'), `配置键要从 config.json 根算起：${key}`)
    }
  }
})

test('起服务、收两帧、把事件交给宿主', async () => {
  const port = await freePort()
  const world = definition.create(makeCtx(port))
  const pushed = []
  const host = {
    pushEvent: async (event, opts) => {
      pushed.push({ event, trigger: opts?.trigger })
      return { cursor: 1 }
    },
    log: { info() {}, warn() {} },
  }

  await world.start(host)
  try {
    for (const frame of [frames[4], frames[6]]) {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(frame),
      })
      assert.equal(response.status, 200)
    }
    await new Promise((resolve) => setTimeout(resolve, 60))

    const died = pushed.find((item) => item.event.type === 'dota.player.died')
    assert.ok(died, '没有收到阵亡事件')
    assert.equal(died.trigger, 'flush')
    assert.equal(died.event.source, 'dota2-gsi')
    assert.match(died.event.text, /45 秒后复活/)
    assert.match(died.event.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
  } finally {
    await world.stop()
  }
  assert.equal(world.receiver, null)
})

test('面板接口：喂一段测试数据能看到事件和卡', async () => {
  const world = definition.create(makeCtx(await freePort()))
  const simulated = await world.invokePanel('live', 'simulate', ['sequence'])
  assert.equal(simulated.ok, true)
  assert.ok(simulated.frames > 5)
  assert.ok(simulated.events.length > 5)

  const status = await world.invokePanel('live', 'status', [])
  assert.equal(status.ok, true)
  assert.ok(status.configText.includes('"buildings"'))
  assert.ok(status.events.length > 0)
  assert.match(status.card, /刀塔战况|没有对局/)

  const raw = await world.invokePanel('live', 'raw', [])
  assert.ok(raw.text.includes('"provider"'))
})

test('deliver 丢弃无 type/text 的畸形事件，不进宿主（2026-11-15 事故守卫）', async () => {
  const world = definition.create(makeCtx(35123))
  const pushed = []
  const warns = []
  world.host = {
    pushEvent: async (envelope) => {
      pushed.push(envelope)
      return { cursor: 1 }
    },
    log: {
      info() {},
      warn(message) {
        warns.push(message)
      },
    },
  }

  // 空对象、字符串、只有 type、只有 text、undefined——都不得进宿主（会炸主循环）。
  const junk = [{}, '一段裸文本', { type: 'dota.map.pickup' }, { text: '有正文没类型' }, undefined]
  for (const item of junk) {
    assert.doesNotThrow(() => world.deliver(item))
  }
  assert.equal(pushed.length, 0, '畸形事件一个都不该推')
  assert.equal(warns.length, junk.length, '每条都要告警（带形状和堆栈）')
  assert.ok(warns.every((message) => message.includes('丢弃畸形事件')))
  assert.ok(warns[1].includes('一段裸文本'), '告警里能看见事件形状')
  assert.ok(warns.every((message) => message.includes('at ')), '告警带堆栈，方便定位产生分支')

  // 正常事件照常推。
  world.deliver({ type: 'dota.map.score', text: '[刀塔 12:00] 比分 1–0。', meta: { clock: 720 } })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(pushed.length, 1)
  assert.equal(pushed[0].type, 'dota.map.score')
  assert.equal(pushed[0].source, 'dota2-gsi')
  assert.ok(pushed[0].ts)
})
