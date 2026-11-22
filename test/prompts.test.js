import test from 'node:test'
import assert from 'node:assert/strict'

import { PromptEngine } from '../src/prompts.js'
import { MinimapTracker } from '../src/minimap.js'
import { DotaState } from '../src/state.js'
import { heroFrame, fill } from './helpers.js'

/** 自机位置：中路或天辉下路野区（安全劣单都算非中单）。 */
const MID_POS = { unit: 'npc_dota_hero_axe', x: -3190, y: -2926, self: true, team: 2 }
const SIDE_POS = { unit: 'npc_dota_hero_axe', x: -2000, y: -5000, self: true, team: 2 }
const POOLS = [
  { unit: 'npc_dota_lotus_pool', x: -7548, y: 4209, team: 5 },
  { unit: 'npc_dota_lotus_pool', x: 7503, y: -4404, team: 5 },
]

function setup(selfPos) {
  const tracker = new MinimapTracker()
  for (let t = 1; t <= 10; t++) tracker.ingest(heroFrame(t, fill(selfPos ? [selfPos, ...POOLS] : POOLS)), t)
  const engine = new PromptEngine()
  // 暖机：中单判定要攒够样本（MIN_SAMPLES=20），从 1 秒喂到 40 秒（都在最早触发点 70 秒之前）。
  for (let t = 1; t <= 40; t++) {
    engine.tick({ clock: t, snap: { phase: 'playing' }, tracker })
  }
  return { engine, tracker }
}

function tick(ctx, clock, { cfgTimings, mode = 'unknown' } = {}) {
  return ctx.engine.tick({
    clock,
    snap: { phase: 'playing' },
    tracker: ctx.tracker,
    cfgTimings,
    mode,
  })
}

test('中单：圣水符发、莲花不发', () => {
  const ctx = setup(MID_POS)
  let events = tick(ctx, 80)
  assert.equal(events.filter((e) => e.type === 'dota.map.pickup').length, 0, '提前量之前不响')

  events = tick(ctx, 90) // 水符 120 - 30
  const water = events.find((e) => e.text.includes('圣水符'))
  assert.ok(water, '中单该收到圣水符提醒')
  assert.match(water.text, /\[刀塔 1:30\]/)
  assert.doesNotMatch(water.text, /秒后|还有 \d+ 秒/, '文案不带精确秒数（延迟不可控）')
  assert.match(water.text, /圣水符马上出|圣水符要刷了/)

  events = tick(ctx, 91)
  assert.equal(events.filter((e) => e.type === 'dota.map.pickup').length, 0, '每条只发一次')

  events = tick(ctx, 150) // 莲花 180 - 30
  assert.equal(events.filter((e) => e.text.includes('莲花')).length, 0, '中单不发莲花')
})

test('非中单：莲花发（带哪朵近）、圣水符不发', () => {
  const ctx = setup(SIDE_POS)
  let events = tick(ctx, 90)
  assert.equal(events.filter((e) => e.text.includes('圣水符')).length, 0, '非中单不收圣水符')

  events = tick(ctx, 150) // 莲花 180 - 30
  const lotus = events.find((e) => e.text.includes('莲花'))
  assert.ok(lotus, '该收到莲花提醒')
  // 下路池 (7503,-4404) 离自机更近。
  assert.match(lotus.text, /下路那朵离你近/)

  events = tick(ctx, 330) // 莲花第二次 360 - 30
  const second = events.find((e) => e.text.includes('莲花'))
  assert.ok(second, '第二次莲花也提醒')
  assert.notEqual(second.text, lotus.text, '同一类两次措辞要轮换，别说一样的话')
})

test('经验符谁都发', () => {
  for (const pos of [MID_POS, SIDE_POS]) {
    const ctx = setup(pos)
    const events = tick(ctx, 390) // 420 - 30
    const wisdom = events.find((e) => e.text.includes('经验符文'))
    assert.ok(wisdom, `${pos === MID_POS ? '中单' : '非中单'}该收到经验符提醒`)
  }
})

test('Turbo：莲花按 90 秒表，首刷提前量在 1:00', () => {
  const ctx = setup(SIDE_POS)
  let events = tick(ctx, 50, { mode: 'turbo' })
  assert.equal(events.filter((e) => e.text.includes('莲花')).length, 0)
  events = tick(ctx, 60, { mode: 'turbo' }) // 90 - 30
  assert.ok(events.find((e) => e.text.includes('莲花')), 'Turbo 莲花 1:00 提醒')
})

test('模式还没判出来时按常规兜底，不会早报莲花', () => {
  const ctx = setup(SIDE_POS)
  const early = tick(ctx, 60, { mode: 'unknown' }) // Turbo 的触发点
  assert.equal(early.filter((e) => e.text.includes('莲花')).length, 0, '判不出来时不在 1:00 乱报')
  const regular = tick(ctx, 150, { mode: 'unknown' }) // 常规 180 - 30
  assert.ok(regular.find((e) => e.text.includes('莲花')), '按常规时间响')
})

test('设置覆盖：改时刻生效，0 关掉', () => {
  const ctx = setup(SIDE_POS)
  let events = tick(ctx, 150, { cfgTimings: { lotus1: 0, lotus2: 300 } })
  assert.equal(events.filter((e) => e.text.includes('莲花')).length, 0, 'lotus1=0 关掉')

  events = tick(ctx, 270, { cfgTimings: { lotus1: 0, lotus2: 300 } })
  assert.ok(events.find((e) => e.text.includes('莲花')), 'lotus2 改成 300 秒后 4:30 提醒')
})

test('莲花池没见过时文案降级成河道', () => {
  const ctx = setup(null) // 不喂池子
  const events = tick(ctx, 150)
  const lotus = events.find((e) => e.text.includes('莲花'))
  assert.match(lotus.text, /河道那朵/)
})

test('换局重置：fired 清空后还能再发', () => {
  const ctx = setup(SIDE_POS)
  tick(ctx, 150)
  assert.ok(ctx.engine.fired.size >= 1)
  ctx.engine.reset()
  assert.equal(ctx.engine.fired.size, 0)
  const events = tick(ctx, 150)
  assert.ok(events.find((e) => e.text.includes('莲花')), '重置后同一时刻再发一条')
})

test('state 全链：换 matchid 后提醒重新武装', () => {
  const state = new DotaState()
  const self = SIDE_POS
  const frame = (clockSec, matchid) => ({
    provider: { appid: 570 },
    map: { game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: clockSec, game_time: clockSec, matchid },
    hero: { name: 'npc_dota_hero_axe', id: 2, level: 6, alive: true, xpos: self.x, ypos: self.y },
    player: { team_name: 'radiant', team_slot: 0 },
    minimap: {
      o0: { xpos: self.x, ypos: self.y, image: 'minimap_herocircle_self', team: 2, yaw: 0, unitname: self.unit, visionrange: 1800 },
      o1: { xpos: POOLS[0].x, ypos: POOLS[0].y, image: 'minimap_lotuspool', team: 5, yaw: 0, unitname: POOLS[0].unit, visionrange: 0 },
      o2: { xpos: POOLS[1].x, ypos: POOLS[1].y, image: 'minimap_lotuspool', team: 5, yaw: 0, unitname: POOLS[1].unit, visionrange: 0 },
    },
  })

  state.ingest(frame(1, 'mA'), 1000)
  const fired = state.ingest(frame(160, 'mA'), 2000)
  assert.equal(fired.events.filter((e) => e.type === 'dota.map.pickup').length, 1)

  const nextMatch = state.ingest(frame(160, 'mB'), 3000)
  assert.equal(nextMatch.events.filter((e) => e.type === 'dota.map.pickup').length, 1, '新的一局重新提醒')
})
