import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { DotaState } from '../src/state.js'
import { normalize } from '../src/snapshot.js'

const frames = JSON.parse(fs.readFileSync(new URL('../data/sample-match.json', import.meta.url), 'utf8'))

function feed(state, list, start = Date.now() - list.length * 500, step = 500) {
  const events = []
  let at = start
  for (const frame of list) {
    events.push(...state.ingest(frame, at).events)
    at += step
  }
  return { events, end: at }
}

test('第一帧只建基线，不发事件', () => {
  const state = new DotaState()
  const result = state.ingest(frames[0], 1000)
  assert.equal(result.accepted, true)
  assert.deepEqual(result.events, [])
  assert.equal(state.received, 1)
})

test('一局完整走完，关键事件都出得来', () => {
  const state = new DotaState()
  const { events } = feed(state, frames)
  const types = new Set(events.map((event) => event.type))
  for (const type of [
    'dota.match.started',
    'dota.match.phase',
    'dota.player.died',
    'dota.player.respawned',
    'dota.player.leveled',
    'dota.player.killed',
    'dota.player.item',
    'dota.map.roshan',
    'dota.map.building',
    'dota.map.daynight',
    'dota.match.ended',
  ]) {
    assert.ok(types.has(type), `缺少事件：${type}`)
  }
})

test('事件文本带时间和事实，不夹带判断', () => {
  const state = new DotaState()
  const { events } = feed(state, frames)
  const death = events.find((event) => event.type === 'dota.player.died')
  assert.match(death.text, /\[刀塔 16:40\]/)
  assert.match(death.text, /45 秒后复活/)
  assert.match(death.text, /比分 天辉 3–1 夜魇/)
})

test('同一帧重复到达不再发事件', () => {
  const state = new DotaState()
  const { end } = feed(state, frames.slice(0, 5))
  const before = state.events.length
  const result = state.ingest(frames[4], end + 500)
  assert.deepEqual(result.events, [])
  assert.equal(state.events.length, before)
})

test('终局帧只发一条汇总，不补发过期细节', () => {
  const state = new DotaState()
  const { end } = feed(state, frames.slice(0, -1))
  const result = state.ingest(frames.at(-1), end + 500)
  assert.equal(result.events.length, 1)
  assert.equal(result.events[0].type, 'dota.match.ended')
  assert.match(result.events[0].text, /天辉胜/)
})

test('状态卡里有英雄、等级、血蓝、金钱、战绩、装备', () => {
  const state = new DotaState()
  feed(state, frames.slice(0, 5))
  const card = state.cardText()
  assert.match(card, /nevermore/)
  assert.match(card, /Lv\.9/)
  assert.match(card, /生命 900\/900/)
  assert.match(card, /金钱 1200/)
  assert.match(card, /3\/0\/2/)
  assert.match(card, /装备：blink、power_treads/)
})

test('没收到数据时的回执', () => {
  const state = new DotaState()
  const text = state.statusText()
  assert.match(text, /^\[ok\] 还没有收到 Dota 2 的数据/)
})

test('打完回到菜单后，回执里有上一局', () => {
  const state = new DotaState()
  const { events, end } = feed(state, [...frames, frames[0]])
  assert.ok(!events.some((event) => event.type === 'dota.match.left'), '正常结束不该报中途退出')
  const text = state.statusText(end + 1000)
  assert.match(text, /没有对局/)
  assert.match(text, /上一局：40:00/)
})

test('局内断线只报一次，恢复时报断线时长', () => {
  const clock = { t: 1000 }
  const state = new DotaState({ now: () => clock.t })
  state.ingest(frames[4], clock.t)
  clock.t += 60_000
  const stale = state.checkStale()
  assert.equal(stale.type, 'dota.match.disconnected')
  assert.equal(state.checkStale(), null)

  const resumed = state.ingest(frames[5], clock.t)
  assert.equal(resumed.events[0].type, 'dota.match.reconnected')
  assert.match(resumed.events[0].text, /断线 1 分/)
})

test('菜单里没数据不算断线', () => {
  const clock = { t: 1000 }
  const state = new DotaState({ now: () => clock.t })
  state.ingest(frames[0], clock.t)
  clock.t += 60_000
  assert.equal(state.checkStale(), null)
  assert.equal(state.connection().state, 'stale')
})

test('非 Dota 报文不进状态', () => {
  const state = new DotaState()
  const result = state.ingest({ provider: { appid: 730 } }, 1000)
  assert.equal(result.accepted, false)
  assert.equal(state.received, 0)
})

test('空装备格子不算装备，中立栏和回城卷轴分开', () => {
  const snap = normalize({
    provider: { appid: 570 },
    map: { game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS' },
    items: {
      slot0: { name: 'empty' },
      slot1: { name: 'item_blink', cooldown: 0 },
      slot6: { name: 'empty' },
      slot8: { name: 'item_tpscroll' },
      neutral0: { name: 'item_enhancement_seed' },
      teleport0: { name: 'item_tpscroll', charges: 1 },
      stash0: { name: 'item_recipe_blink' },
    },
  })
  const places = snap.items.map((item) => `${item.area}:${item.slot}:${item.key}`).sort()
  assert.deepEqual(places, ['bag:8:item_tpscroll', 'inv:1:item_blink', 'neutral:0:item_enhancement_seed', 'tp:0:item_tpscroll'])
})

test('选人阶段 id 为 0 的假英雄不算数', () => {
  const snap = normalize({
    provider: { appid: 570 },
    map: { game_state: 'DOTA_GAMERULES_STATE_HERO_SELECTION', clock_time: -90 },
    hero: { id: 0, name: '', level: 0 },
  })
  assert.equal(snap.hero, null)
})

test('开局载入的空白帧不当成退赛，也不重复报开局', () => {
  const state = new DotaState()
  let at = 1000
  state.ingest(frames[4], at)
  at += 500
  const blank = state.ingest(frames[0], at)
  assert.deepEqual(blank.events, [])
  at += 700
  const back = state.ingest(frames[5], at)
  assert.deepEqual(back.events, [])
})

test('真的掉出对局，过了宽限才报一次', () => {
  const state = new DotaState()
  let at = 1000
  state.ingest(frames[4], at)
  at += 500
  assert.deepEqual(state.ingest(frames[0], at).events, [])
  at += 3000
  assert.deepEqual(state.ingest(frames[0], at).events, [])
  at += 4000
  const left = state.ingest(frames[0], at)
  assert.equal(left.events.length, 1)
  assert.equal(left.events[0].type, 'dota.match.left')
  at += 1000
  assert.deepEqual(state.ingest(frames[0], at).events, [])
})

test('出兵前不报天亮', () => {
  const before = {
    ...frames[3],
    map: { ...frames[3].map, game_state: 'DOTA_GAMERULES_STATE_PRE_GAME', clock_time: -1, game_time: 0, daytime: false },
  }
  const after = {
    ...frames[3],
    map: { ...frames[3].map, game_state: 'DOTA_GAMERULES_STATE_PRE_GAME', clock_time: 0, game_time: 0, daytime: true },
  }
  const state = new DotaState()
  state.ingest(before, 1000)
  const out = state.ingest(after, 1500)
  assert.ok(!out.events.some((event) => event.type === 'dota.map.daynight'))
})
