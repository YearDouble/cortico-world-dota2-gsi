/** v0.2 管线集成：真机 fixture 回放 + 合成场景，全走 DotaState.ingest 一条链。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import readline from 'node:readline'

import { DotaState } from '../src/state.js'
import { heroFrame, fill } from './helpers.js'

async function loadProbeFrames() {
  const frames = []
  const file = fs.readFileSync(new URL('./fixtures/real-probe.jsonl', import.meta.url), 'utf8')
  for (const line of file.trim().split('\n')) {
    if (!line) continue
    frames.push(JSON.parse(line).body)
  }
  return frames
}

test('真机帧回放：不炸、位置库有货、事件流去重生效', async () => {
  const frames = await loadProbeFrames()
  const state = new DotaState()
  let at = 1000
  const allEvents = []
  for (const frame of frames) {
    const result = state.ingest(frame, at)
    assert.equal(result.accepted, true)
    allEvents.push(...result.events)
    at += 500
  }
  assert.ok(state.tracker.heroes.size > 0, '位置库应该认出了英雄')
  assert.ok(state.stream.counts.kill > 0, '击杀应该收到过')
  assert.ok(state.stream.duplicates > 0, '滚动窗口去重应该拦掉过重复')
  const receipt = state.minimapReceipt()
  assert.match(receipt, /^\[ok\]/)
})

test('真机帧回放：dota_minimap 回执是人话，带名单和肉山行', async () => {
  const frames = await loadProbeFrames()
  const state = new DotaState()
  let at = 1000
  for (const frame of frames) {
    state.ingest(frame, at)
    at += 500
  }
  const receipt = state.minimapReceipt()
  assert.match(receipt, /敌方名单: \d\/5 已确认/)
  assert.match(receipt, /肉山: /)
})

test('里程碑升级：跨 6 报大招解锁，跨两级合并一条，没跨不报', () => {
  const state = new DotaState()
  const base = { provider: { appid: 570 }, map: { game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 600, game_time: 600, matchid: 'm2' } }
  state.ingest({ ...base, hero: { name: 'npc_dota_hero_axe', id: 2, level: 5, alive: true } }, 1000)
  // 5 → 16：跨 6 和 15，合并一条。
  const up = state.ingest({ ...base, map: { ...base.map, clock_time: 900, game_time: 900 }, hero: { name: 'npc_dota_hero_axe', id: 2, level: 16, alive: true } }, 1500)
  const leveled = up.events.filter((event) => event.type === 'dota.player.leveled')
  assert.equal(leveled.length, 1)
  assert.match(leveled[0].text, /你到 16 级，大招解锁、进入前中期/)

  // 16 → 17：没跨节点，不报。
  const plain = state.ingest({ ...base, map: { ...base.map, clock_time: 950, game_time: 950 }, hero: { name: 'npc_dota_hero_axe', id: 2, level: 17, alive: true } }, 1600)
  assert.equal(plain.events.filter((event) => event.type === 'dota.player.leveled').length, 0)
})

test('开局名单：敌方 5/5 确认后发一条 lineup', () => {
  const state = new DotaState()
  const self = { unit: 'npc_dota_hero_axe', x: -6000, y: -6000, self: true, team: 2 }
  const allies = [1, 2, 3, 4].map((i) => ({ unit: `npc_dota_hero_ally${i}`, x: -5000 + i * 100, y: -5000, team: 2 }))
  const enemies = [1, 2, 3, 4, 5].map((i) => ({ unit: `npc_dota_hero_foe${i}`, x: 5000 + i * 100, y: 5000, enemy: true }))

  state.ingest(heroFrame(50, [self, ...allies, ...enemies.slice(0, 2)]), 1000)
  const full = state.ingest(heroFrame(80, fill([self, ...allies, ...enemies], 16)), 2000)
  const lineup = full.events.filter((event) => event.type === 'dota.match.lineup')
  assert.equal(lineup.length, 1)
  assert.match(lineup[0].text, /你=axe（天辉）/)
  assert.match(lineup[0].text, /队友 ally1\/ally2\/ally3\/ally4/)
  assert.match(lineup[0].text, /敌方 foe1\/foe2\/foe3\/foe4\/foe5/)

  // 一局只发一次。
  const again = state.ingest(heroFrame(90, fill([self, ...allies, ...enemies], 16)), 2500)
  assert.equal(again.events.filter((event) => event.type === 'dota.match.lineup').length, 0)
})

test('换 matchid 整体重置，名单重新确认', () => {
  const state = new DotaState()
  const self = { unit: 'npc_dota_hero_axe', x: -6000, y: -6000, self: true, team: 2 }
  const enemies = [1, 2, 3, 4, 5].map((i) => ({ unit: `npc_dota_hero_foe${i}`, x: 5000 + i * 100, y: 5000, enemy: true }))
  state.ingest(heroFrame(100, fill([self, ...enemies], 16), 'm1'), 1000)
  assert.equal(state.tracker.enemyRosterCount(), 5)
  assert.equal(state.lineupEmitted, true)

  const next = state.ingest(heroFrame(120, fill([self, ...enemies], 16), 'm2'), 2000)
  assert.equal(state.matchKey, 'm2')
  // 重置后名单重新确认，新的一局再发一条 lineup。
  assert.equal(next.events.filter((event) => event.type === 'dota.match.lineup').length, 1)
})

test('自己阵亡有击杀事件对账，不记 mismatch', () => {
  const state = new DotaState()
  const base = { provider: { appid: 570 }, map: { game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 600, game_time: 600, matchid: 'm3' } }
  const killData = JSON.stringify({ type: 'CHAT_MESSAGE_HERO_KILL', value: 300, playerid1: 0, playerid2: 7, playerid3: -1, playerid4: -1, playerid5: -1, playerid6: -1, time: 601 })
  state.ingest({ ...base, hero: { name: 'npc_dota_hero_axe', id: 2, level: 6, alive: true }, player: { team_name: 'radiant', team_slot: 0, kills: 0, deaths: 0, assists: 0 } }, 1000)
  const died = state.ingest(
    {
      ...base,
      map: { ...base.map, clock_time: 602, game_time: 602 },
      hero: { name: 'npc_dota_hero_axe', id: 2, level: 6, alive: false, respawn_seconds: 40 },
      player: { team_name: 'radiant', team_slot: 0, kills: 0, deaths: 1, assists: 0 },
      events: [{ event_type: 'generic_event', game_time: 601, data: killData }],
    },
    1500,
  )
  assert.ok(died.events.some((event) => event.type === 'dota.player.died'))
  // 击杀事件 victimId=0 对上了自己的 id。
  assert.equal(state.idmap.selfIdMismatches, 0)
  assert.equal(state.idmap.name(0), 'npc_dota_hero_axe')
})

test('bot 局幻影清扫：选人残留不进 lineup，真人重新进图补回（2026-11-15 真机复盘）', () => {
  const state = new DotaState()
  const self = { unit: 'npc_dota_hero_axe', x: -6000, y: -6000, self: true, team: 2 }
  const mk = (clockSec, entries, phase) => ({
    provider: { appid: 570 },
    map: { game_state: phase, clock_time: clockSec, game_time: Math.max(0, clockSec), matchid: 'bot1' },
    hero: { name: 'npc_dota_hero_axe', id: 2, level: 1, alive: true, xpos: self.x, ypos: self.y },
    player: { team_name: 'radiant', team_slot: 0 },
    minimap: Object.fromEntries(entries.map((entry, i) => [
      `o${i}`,
      {
        xpos: entry.x ?? entry.ref.x,
        ypos: entry.y ?? entry.ref.y,
        image: entry.self ? 'minimap_herocircle_self' : entry.enemy ? 'minimap_enemyicon' : 'minimap_herocircle',
        team: entry.team ?? (entry.enemy ? 3 : 2),
        yaw: 0,
        unitname: entry.unit,
        visionrange: 1800,
      },
    ])),
  })

  // 选人阶段：bot 局敌我全标队色 2，还夹三个后来没进名单的幻影。
  const phantoms = [
    { unit: 'npc_dota_hero_juggernaut', x: -5200, y: -5300, team: 2 },
    { unit: 'npc_dota_hero_windrunner', x: -5400, y: -5100, team: 2 },
    { unit: 'npc_dota_hero_slardar', x: -5600, y: -5400, team: 2 },
  ]
  const realAllies = [
    { unit: 'npc_dota_hero_dragon_knight', x: -5000, y: -5000, team: 2 },
    { unit: 'npc_dota_hero_luna', x: -4800, y: -5200, team: 2 },
    { unit: 'npc_dota_hero_sniper', x: -4600, y: -5100, team: 2 },
    { unit: 'npc_dota_hero_pudge', x: -4400, y: -5300, team: 2 },
  ]
  const realEnemies = [
    { unit: 'npc_dota_hero_silencer', x: 5000, y: 5000, team: 2 },
    { unit: 'npc_dota_hero_bristleback', x: 5100, y: 5200, team: 2 },
    { unit: 'npc_dota_hero_tidehunter', x: 5200, y: 5100, team: 2 },
    { unit: 'npc_dota_hero_zeus', x: 5300, y: 5300, team: 2 },
    { unit: 'npc_dota_hero_drow_ranger', x: 5400, y: 5200, team: 2 },
  ]

  state.ingest(mk(-30, [self, ...phantoms, ...realAllies, ...realEnemies], 'DOTA_GAMERULES_STATE_STRATEGY_TIME'), 1000)
  assert.equal(state.tracker.heroesOf('radiant').length, 13, '选人阶段 bot 局敌我全挤天辉栏（已知暂态，含自己）')

  // 开局第一帧：幻影不再出现，真人（含一个换了敌人的重名英雄）重新进图；敌方真实队色是 3。
  const realEnemiesDire = realEnemies.map((hero) => ({ ...hero, team: 3 }))
  const fresh = state.ingest(
    mk(5, [{ ...self }, ...realAllies, ...realEnemiesDire], 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS'),
    2000,
  )
  assert.equal(state.preGameSwept, true)
  const radiantNames = state.tracker.heroesOf('radiant').map((hero) => hero.short)
  assert.ok(!radiantNames.includes('juggernaut'), '幻影剑圣该被扫掉')
  assert.ok(!radiantNames.includes('windrunner'), '幻影风行该被扫掉')
  assert.ok(!radiantNames.includes('slardar'), '幻影大鱼该被扫掉')
  assert.equal(state.tracker.heroesOf('radiant').length, 5, '己方 5 人')
  assert.equal(state.tracker.enemyRosterCount(), 5, '敌方 5/5')

  // lineup 在清扫之后才发，阵容不含幻影。
  const lineup = fresh.events.find((event) => event.type === 'dota.match.lineup')
  assert.ok(lineup, '名单齐了该发 lineup')
  assert.ok(!/juggernaut|windrunner|slardar/.test(lineup.text), 'lineup 不含幻影')
  assert.match(lineup.text, /pudge/)

  // 清扫一局只做一次。
  state.ingest(mk(10, [{ ...self }], 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS'), 3000)
  assert.equal(state.tracker.heroesOf('radiant').length, 5, '后续帧不再清真人（他们只是暂时在雾里）')
})

test('面板调试文本能生成', () => {
  const state = new DotaState()
  state.ingest(heroFrame(100, fill([{ unit: 'npc_dota_hero_axe', x: 0, y: 0, self: true, team: 2 }], 9)), 1000)
  const text = state.auxDebugText()
  assert.match(text, /名单: /)
  assert.match(text, /事件流: /)
  assert.match(text, /id 映射: /)
})
