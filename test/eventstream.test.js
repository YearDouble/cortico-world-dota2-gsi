import test from 'node:test'
import assert from 'node:assert/strict'

import { EventStream } from '../src/eventstream.js'

function generic(data) {
  return { event_type: 'generic_event', game_time: 100, data: JSON.stringify(data) }
}

test('普通击杀和一血的字段语义相反（D16 实测）', () => {
  const stream = new EventStream()
  const kill = stream.ingest([
    generic({ type: 'CHAT_MESSAGE_HERO_KILL', value: 280, playerid1: 5, playerid2: 0, playerid3: 3, playerid4: 7, playerid5: -1, playerid6: -1, time: 54.13 }),
  ])[0]
  assert.equal(kill.kind, 'kill')
  assert.equal(kill.victimId, 5)
  assert.equal(kill.killerId, 0)
  assert.deepEqual(kill.assists, [3, 7])
  assert.equal(kill.fb, false)

  const fb = stream.ingest([
    generic({ type: 'CHAT_MESSAGE_FIRSTBLOOD', value: 280, playerid1: 0, playerid2: 5, time: 54.13 }),
  ])[0]
  assert.equal(fb.fb, true)
  assert.equal(fb.killerId, 0)
  assert.equal(fb.victimId, 5)
  assert.deepEqual(fb.assists, [])
})

test('同一事件在滚动窗口里反复出现，只收一次', () => {
  const stream = new EventStream()
  const record = generic({ type: 'CHAT_MESSAGE_HERO_KILL', value: 280, playerid1: 5, playerid2: 0, time: 54.13 })
  const first = stream.ingest([record])
  assert.equal(first.length, 1)
  for (let i = 0; i < 40; i++) stream.ingest([record])
  assert.equal(stream.counts.kill, 1)
  assert.ok(stream.duplicates >= 40)
})

test('内容不同就是不同事件', () => {
  const stream = new EventStream()
  const out = stream.ingest([
    generic({ type: 'CHAT_MESSAGE_HERO_KILL', value: 280, playerid1: 5, playerid2: 0, time: 54.13 }),
    generic({ type: 'CHAT_MESSAGE_HERO_KILL', value: 200, playerid1: 6, playerid2: 1, time: 55.5 }),
  ])
  assert.equal(out.length, 2)
})

test('噪声类型直接丢弃', () => {
  const stream = new EventStream()
  const out = stream.ingest([
    generic({ type: 'CHAT_MESSAGE_RANDOM', value: 4, playerid1: 26, time: 1 }),
    generic({ type: 'CHAT_MESSAGE_NO_BATTLE_POINTS', value: 1, playerid1: -1, time: 1 }),
    { event_type: 'chat_message', game_time: 90, player_id: 0, channel_type: 12, message: '-gold 100000' },
    { event_type: 'bounty_rune_pickup', game_time: 610, player_id: 2, team: 'radiant', bounty_value: 46 },
  ])
  assert.equal(out.length, 0)
})

test('原生事件带 offset 换到 clock 基准', () => {
  const stream = new EventStream()
  const roshan = stream.ingest([{ event_type: 'roshan_killed', game_time: 374, killed_by_team: 'radiant', killer_player_id: 0 }], -138)[0]
  assert.equal(roshan.kind, 'roshanKilled')
  assert.equal(roshan.time, 236)
  assert.equal(roshan.team, 'radiant')

  const aegis = stream.ingest([{ event_type: 'aegis_picked_up', game_time: 381, player_id: 0, snatched: false }], -138)[0]
  assert.equal(aegis.kind, 'aegis')
  assert.equal(aegis.playerId, 0)
})

test('出装和买活照收，出装流水单记', () => {
  const stream = new EventStream()
  const out = stream.ingest([
    generic({ type: 'CHAT_MESSAGE_ITEM_PURCHASE', value: 600, playerid1: 0, playerid2: -1, time: -22.2 }),
    generic({ type: 'CHAT_MESSAGE_BUYBACK', value: 0, playerid1: 3, playerid2: -1, time: 402.5 }),
  ])
  assert.equal(out.length, 2)
  assert.equal(out[0].kind, 'purchase')
  assert.equal(out[1].kind, 'buyback')
  assert.equal(stream.purchases.length, 1)
})

test('塔击杀：value=击杀方（真机 12 起配对实锤），tier 在 value3', () => {
  const stream = new EventStream()
  const tower = stream.ingest([
    generic({ type: 'CHAT_MESSAGE_TOWER_KILL', value: 2, playerid1: -1, playerid2: 0, value2: 90, value3: 1, time: 93.86 }),
  ])[0]
  assert.equal(tower.kind, 'towerKill')
  assert.equal(tower.killerTeam, 'radiant')
  assert.equal(tower.tier, 1)
  assert.equal(tower.killerId, -1)
})
