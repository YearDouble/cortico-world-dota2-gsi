import test from 'node:test'
import assert from 'node:assert/strict'

import { FightEngine } from '../src/fights.js'
import { MinimapTracker } from '../src/minimap.js'
import { IdMap } from '../src/idmap.js'
import { heroFrame, fill } from './helpers.js'

function setup() {
  return { engine: new FightEngine(), tracker: new MinimapTracker(), idmap: new IdMap() }
}

function run({ engine, tracker, idmap }, clock, records = [], heroes = null, phase = 'playing', extra = {}) {
  if (heroes) tracker.ingest(heroFrame(clock, heroes), clock)
  return engine.update({
    clock,
    snap: { phase, player: { team: 'radiant', gold: 800 }, clock, ...(extra.snap ?? {}) },
    records,
    tracker,
    idmap,
    ...(extra.mode ? { mode: extra.mode } : {}),
    ...(extra.cfgTimings ? { cfgTimings: extra.cfgTimings } : {}),
  })
}

function kill(time, victimId, killerId, assists = []) {
  return { kind: 'kill', key: `k${time}|${victimId}`, time, gameTime: time, victimId, killerId, assists, bounty: 280, fb: false }
}

test('两人头窗口收口成一条团战，报几换几和击杀者', () => {
  const ctx = setup()
  ctx.idmap.bind(0, 'npc_dota_hero_axe')
  ctx.idmap.selfId = 0
  ctx.idmap.bind(7, 'npc_dota_hero_viper')
  ctx.idmap.bind(8, 'npc_dota_hero_luna')

  run(ctx, 100, [kill(100, 7, 0)])
  run(ctx, 102, [kill(102, 8, 0)])
  // 收口前没事件。
  const early = run(ctx, 110)
  assert.equal(early.filter((event) => event.type === 'dota.fight.ended').length, 0)
  const events = run(ctx, 117)
  const fight = events.find((event) => event.type === 'dota.fight.ended')
  assert.ok(fight, '应该收口')
  assert.match(fight.text, /团战收口：敌方倒下 2 人，我方阵亡 0 人，你没死/)
  assert.match(fight.text, /你击杀了 viper 和 luna/)
  assert.match(fight.text, /\[刀塔 1:57\]/)
})

test('单杀不收口，散落的击杀不算同一场', () => {
  const ctx = setup()
  ctx.idmap.selfId = 0
  run(ctx, 100, [kill(100, 7, 0)])
  let events = run(ctx, 200)
  assert.equal(events.filter((event) => event.type === 'dota.fight.ended').length, 0)

  // 间隔超过 20 秒，新窗口从 300 重新起算，100 那个单杀不掺进来。
  run(ctx, 300, [kill(300, 8, 0)])
  run(ctx, 302, [kill(302, 9, 1)])
  events = run(ctx, 320)
  const fights = events.filter((event) => event.type === 'dota.fight.ended')
  assert.equal(fights.length, 1)
  assert.match(fights[0].text, /敌方倒下 2 人，我方阵亡 0 人/)
})

test('自己阵亡写进团战总结', () => {
  const ctx = setup()
  ctx.idmap.selfId = 0
  ctx.idmap.bind(0, 'npc_dota_hero_axe')
  ctx.idmap.bind(7, 'npc_dota_hero_viper')
  // 你击杀 viper，随后 viper 的队友杀了你：1 换 1。
  run(ctx, 100, [kill(100, 7, 0)])
  run(ctx, 102, [kill(102, 0, 7)])
  const events = run(ctx, 117)
  const fight = events.find((event) => event.type === 'dota.fight.ended')
  assert.match(fight.text, /敌方倒下 1 人，我方阵亡 1 人，你也倒了。/)
  assert.match(fight.text, /viper围殴你/)
})

test('敌方全员消失 ≥10 秒报一条，30 秒内不重复', () => {
  const ctx = setup()
  const enemies = [1, 2, 3, 4, 5].map((i) => ({ unit: `npc_dota_hero_enemy${i}`, x: 5000 + i * 100, y: 5000, enemy: true }))
  const self = { unit: 'npc_dota_hero_axe', x: 0, y: 0, self: true, team: 2 }
  run(ctx, 100, [], [self, ...enemies])
  // 敌人从 100 起消失，到 111 满足 10 秒。
  let events = run(ctx, 108, [], [self])
  assert.equal(events.filter((event) => event.type === 'dota.intel.missing_all').length, 0)
  events = run(ctx, 111, [], [self])
  assert.equal(events.filter((event) => event.type === 'dota.intel.missing_all').length, 1)
  events = run(ctx, 125, [], [self])
  assert.equal(events.filter((event) => event.type === 'dota.intel.missing_all').length, 0)
})

test('敌人回来了就重新武装 missing_all', () => {
  const ctx = setup()
  const enemies = [1, 2, 3, 4, 5].map((i) => ({ unit: `npc_dota_hero_enemy${i}`, x: 5000 + i * 100, y: 5000, enemy: true }))
  const self = { unit: 'npc_dota_hero_axe', x: 0, y: 0, self: true, team: 2 }
  run(ctx, 100, [], [self, ...enemies])
  run(ctx, 111, [], [self])
  // 回来一眼（冷却 30 秒在 141 到期），再消失 10 秒还能再报。
  run(ctx, 130, [], [self, ...enemies])
  const events = run(ctx, 145, [], [self])
  assert.equal(events.filter((event) => event.type === 'dota.intel.missing_all').length, 1)
})

test('敌方 ≥3 人同区域 ≥10 秒报抱团', () => {
  const ctx = setup()
  const self = { unit: 'npc_dota_hero_axe', x: 0, y: 0, self: true, team: 2 }
  const group = [
    { unit: 'npc_dota_hero_e1', x: 0, y: -6200, enemy: true },
    { unit: 'npc_dota_hero_e2', x: 500, y: -6100, enemy: true },
    { unit: 'npc_dota_hero_e3', x: -400, y: -6300, enemy: true },
  ]
  run(ctx, 100, [], [self, ...group])
  let events = run(ctx, 108, [], [self, ...group])
  assert.equal(events.filter((event) => event.type === 'dota.intel.grouped').length, 0)
  events = run(ctx, 111, [], [self, ...group])
  const grouped = events.find((event) => event.type === 'dota.intel.grouped')
  assert.ok(grouped)
  assert.match(grouped.text, /敌方 3 人在下路，抱团了/)
})

test('消失 ≥20 秒的敌人贴脸，报绕后', () => {
  const ctx = setup()
  const self = { unit: 'npc_dota_hero_axe', x: 0, y: 0, self: true, team: 2 }
  const viper = { unit: 'npc_dota_hero_viper', x: 6000, y: 6000, enemy: true }
  run(ctx, 100, [], [self, viper])
  // 21 秒后出现在 360 距离内，露头那一拍就报。
  const events = run(ctx, 121, [], [self, { ...viper, x: 300, y: 200 }])
  const nearby = events.find((event) => event.type === 'dota.intel.nearby')
  assert.ok(nearby, '应该报绕后')
  assert.match(nearby.text, /viper.*绕后出现在你附近/)
})

test('敌方 2 人进肉山坑报威胁（首刷后）', () => {
  const ctx = setup()
  const self = { unit: 'npc_dota_hero_axe', x: 0, y: 0, self: true, team: 2 }
  const pit = [
    { unit: 'npc_dota_hero_e1', x: 2400, y: -2200, enemy: true },
    { unit: 'npc_dota_hero_e2', x: 2600, y: -2400, enemy: true },
  ]
  const events = run(ctx, 1301, [], [self, ...pit])
  const threat = events.find((event) => event.type === 'dota.intel.roshan_threat')
  assert.ok(threat)
  assert.match(threat.text, /敌方 2 人在肉山坑/)
})

test('两个肉山坑都算坑（7.33 起轮换）', () => {
  const ctx = setup()
  const self = { unit: 'npc_dota_hero_axe', x: 0, y: 0, self: true, team: 2 }
  const radiantPit = [
    { unit: 'npc_dota_hero_e1', x: -3100, y: 2300, enemy: true },
    { unit: 'npc_dota_hero_e2', x: -3300, y: 2500, enemy: true },
  ]
  const events = run(ctx, 1301, [], [self, ...radiantPit])
  const threat = events.find((event) => event.type === 'dota.intel.roshan_threat')
  assert.ok(threat, '上路坑也要报')
  assert.match(threat.text, /敌方 2 人在肉山坑/)
})

test('首刷前不报打盾威胁（肉山还没出来）', () => {
  const ctx = setup()
  const self = { unit: 'npc_dota_hero_axe', x: 0, y: 0, self: true, team: 2 }
  const pit = [
    { unit: 'npc_dota_hero_e1', x: 2400, y: -2200, enemy: true },
    { unit: 'npc_dota_hero_e2', x: 2600, y: -2400, enemy: true },
  ]
  const events = run(ctx, 101, [], [self, ...pit])
  assert.equal(events.filter((event) => event.type === 'dota.intel.roshan_threat').length, 0)
  assert.equal(ctx.engine.roshan.phase, 'pending')
})

test('肉山被杀等盾、发倒计时，到点报刷新（带估）', () => {
  const ctx = setup()
  ctx.idmap.selfId = 0
  ctx.idmap.bind(0, 'npc_dota_hero_axe')

  const roshanKilled = { kind: 'roshanKilled', key: 'r1', time: 1300, gameTime: 1300, team: 'dire', killerId: 7 }
  let events = run(ctx, 1301, [roshanKilled])
  assert.equal(events.filter((event) => event.type === 'dota.map.roshan').length, 0, '等盾还没发')

  const aegis = { kind: 'aegis', key: 'a1', time: 1308, gameTime: 1308, playerId: 0, snatched: false }
  events = run(ctx, 1309, [aegis])
  const roshanEvent = events.find((event) => event.type === 'dota.map.roshan')
  assert.ok(roshanEvent)
  assert.match(roshanEvent.text, /肉山被夜魇拿了，盾在 axe 手里；约 11 分钟后刷新（估/)

  // 没到点不报刷新。
  events = run(ctx, 1600)
  assert.equal(events.filter((event) => event.text.includes('刷新')).length, 0)
  events = run(ctx, 1961)
  const respawn = events.find((event) => event.type === 'dota.map.roshan')
  assert.match(respawn.text, /肉山应该刷新了（按时间估，没看到本体）/)
  assert.equal(ctx.engine.roshan.alive, true)
  assert.equal(ctx.engine.roshan.estimated, true)
})

test('小地图看到肉山本体：不用等估时，直接算刷新', () => {  const ctx = setup()
  ctx.idmap.selfId = 0
  const self = { unit: 'npc_dota_hero_axe', x: 0, y: 0, self: true, team: 2 }
  const killed = { kind: 'roshanKilled', key: 'r2', time: 1300, gameTime: 1300, team: 'radiant', killerId: 0 }
  run(ctx, 1301, [killed], fill([self]))
  assert.equal(ctx.engine.roshan.phase, 'dead')

  // 估时（11 分钟）没到，但本体已经出现在上路坑：信眼睛。
  const rosh = { unit: 'npc_dota_roshan', x: -3182, y: 2382, team: 4 }
  const events = run(ctx, 1500, [], fill([self, rosh]))
  const revived = events.find((event) => event.type === 'dota.map.roshan' && event.text.includes('刷新了'))
  assert.ok(revived, '看到本体就发刷新')
  assert.equal(ctx.engine.roshan.alive, true)
  assert.equal(ctx.engine.roshan.estimated, false)
  assert.equal(ctx.engine.roshan.deaths, 1)
})

test('肉山时刻能在设置里改：首刷提前、复活基准可调', () => {
  const ctx = setup()
  const self = { unit: 'npc_dota_hero_axe', x: 0, y: 0, self: true, team: 2 }
  // 首刷改成 1:00，一分钟后就该在场。
  run(ctx, 61, [], fill([self]), 'playing', { cfgTimings: { roshanFirst: 60 } })
  assert.equal(ctx.engine.roshan.phase, 'alive')
  assert.equal(ctx.engine.roshan.firstSpawn, 60)

  // 复活基准改成 360 秒，第一次死就按 6 分钟算。
  const killed = { kind: 'roshanKilled', key: 'r3', time: 70, gameTime: 70, team: 'dire', killerId: 7 }
  run(ctx, 71, [killed], fill([self]), 'playing', { cfgTimings: { roshanFirst: 60, roshanRespawn: 360 } })
  assert.equal(ctx.engine.roshan.respawnAt, 430)

  // Turbo 默认 0:00 起就在场。
  const turbo = setup()
  run(turbo, 1, [], fill([self]), 'playing', { mode: 'turbo' })
  assert.equal(turbo.engine.roshan.phase, 'alive')
})

test('终局收口 flush 返回完整事件对象（2026-11-22 金丝雀回归）', () => {
  const ctx = setup()
  ctx.idmap.selfId = 0
  ctx.idmap.bind(0, 'npc_dota_hero_axe')
  // 局末还开着口的团战：两个击杀在窗口里，直接走 flush（postgame 边界那条路）。
  ctx.engine.window = [
    { kind: 'kill', key: 'k1', time: 100, victimId: 7, killerId: 0, assists: [], bounty: 280, fb: false },
    { kind: 'kill', key: 'k2', time: 110, victimId: 8, killerId: 1, assists: [], bounty: 280, fb: false },
  ]
  ctx.engine.lastKillTime = 110
  const events = ctx.engine.flush(130, ctx.idmap, (key) => key, 'radiant')
  assert.equal(events.length, 1)
  for (const event of events) {
    // 2026-11-15 毒事件的形状就是这里推出了裸字符串（type/text 全 undefined）。
    assert.equal(typeof event, 'object')
    assert.equal(typeof event.type, 'string')
    assert.equal(typeof event.text, 'string')
    assert.match(event.text, /团战收口：/)
  }
})

test('位置库判死的塔报带路别的事件，TOWER_KILL 兜底不重复', () => {
  const ctx = setup()
  const self = { unit: 'npc_dota_hero_axe', x: 0, y: 0, self: true, team: 2 }
  const tower = { unit: 'npc_dota_badguys_tower1_top', x: 6400, y: -1200, team: 3 }
  run(ctx, 100, [], fill([self, tower]))
  // 塔消失，第 4 个缺席帧判死，当拍就报。缺席帧也要是有效帧（元素数够）。
  run(ctx, 101, [], fill([self]))
  run(ctx, 102, [], fill([self]))
  run(ctx, 103, [], fill([self]))
  const events = run(ctx, 104, [], fill([self]))
  const building = events.find((event) => event.type === 'dota.map.building')
  assert.ok(building)
  assert.match(building.text, /夜魇上路一塔被摧毁/)

  // 同一时期的 TOWER_KILL 记录来对账，不该再发一条。
  const towerKill = { kind: 'towerKill', key: 't1', time: 104, gameTime: 104, killerId: -1, killerTeam: 'radiant', tier: 1, bounty: 90 }
  const later = run(ctx, 113, [towerKill])
  assert.equal(later.filter((event) => event.type === 'dota.map.building').length, 0)
})

test('位置库漏看的塔由 TOWER_KILL 兜底', () => {
  const ctx = setup()
  const self = { unit: 'npc_dota_hero_axe', x: 0, y: 0, self: true, team: 2 }
  run(ctx, 100, [], [self])
  const towerKill = { kind: 'towerKill', key: 't2', time: 200, gameTime: 200, killerId: 2, killerTeam: 'radiant', tier: 2, bounty: 110 }
  let events = run(ctx, 201, [towerKill], [self])
  assert.equal(events.filter((event) => event.type === 'dota.map.building').length, 0, '等匹配窗口过')
  events = run(ctx, 209, [], [self])
  const fallback = events.find((event) => event.type === 'dota.map.building')
  assert.ok(fallback)
  assert.match(fallback.text, /夜魇二塔被摧毁/)
})

test('自己买活发一条', () => {
  const ctx = setup()
  ctx.idmap.selfId = 0
  const buyback = { kind: 'buyback', key: 'b1', time: 400, gameTime: 400, playerId: 0 }
  const events = run(ctx, 401, [buyback])
  const event = events.find((item) => item.type === 'dota.player.buyback')
  assert.ok(event)
  assert.match(event.text, /你买活了，剩 800 金/)
})

test('别人买活不报', () => {
  const ctx = setup()
  ctx.idmap.selfId = 0
  const buyback = { kind: 'buyback', key: 'b2', time: 400, gameTime: 400, playerId: 6 }
  const events = run(ctx, 401, [buyback])
  assert.equal(events.filter((item) => item.type === 'dota.player.buyback').length, 0)
})

test('击杀归属过 kill_list 地面真值：对不上就不说「你击杀了」（2026-11-22 Coo 反馈）', () => {
  const ctx = setup()
  ctx.idmap.selfId = 0
  ctx.idmap.bind(0, 'npc_dota_hero_axe')
  ctx.idmap.bind(7, 'npc_dota_hero_viper')
  ctx.idmap.bind(8, 'npc_dota_hero_luna')
  // kill_list 存在但没有 victimid_7/8：归属对不上，宁可不说。
  run(ctx, 100, [kill(100, 7, 0)], null, 'playing', { snap: { player: { team: 'radiant', killList: {} } } })
  run(ctx, 102, [kill(102, 8, 0)], null, 'playing', { snap: { player: { team: 'radiant', killList: {} } } })
  let events = run(ctx, 117, [], null, 'playing', { snap: { player: { team: 'radiant', killList: {} } } })
  const fight = events.find((event) => event.type === 'dota.fight.ended')
  assert.ok(fight)
  assert.doesNotMatch(fight.text, /你击杀了/)

  // kill_list 确认了：才说「你击杀了」。
  const ctx2 = setup()
  ctx2.idmap.selfId = 0
  ctx2.idmap.bind(0, 'npc_dota_hero_axe')
  ctx2.idmap.bind(7, 'npc_dota_hero_viper')
  ctx2.idmap.bind(8, 'npc_dota_hero_luna')
  run(ctx2, 100, [kill(100, 7, 0)], null, 'playing', { snap: { player: { team: 'radiant', killList: { 7: 1, 8: 2 } } } })
  run(ctx2, 102, [kill(102, 8, 0)], null, 'playing', { snap: { player: { team: 'radiant', killList: { 7: 1, 8: 2 } } } })
  events = run(ctx2, 117, [], null, 'playing', { snap: { player: { team: 'radiant', killList: { 7: 1, 8: 2 } } } })
  const fight2 = events.find((event) => event.type === 'dota.fight.ended')
  assert.match(fight2.text, /你击杀了/)
})
