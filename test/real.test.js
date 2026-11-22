import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { normalize } from '../src/snapshot.js'
import { DotaState } from '../src/state.js'

const payload = JSON.parse(fs.readFileSync(new URL('./fixtures/real-playing.json', import.meta.url), 'utf8'))

test('真机帧：英雄、装备、建筑都解析得出来', () => {
  const snap = normalize(payload)
  assert.equal(snap.phase, 'playing')
  assert.equal(snap.hero.key, 'npc_dota_hero_pudge')
  assert.ok(snap.player.kills !== null)
  assert.ok(snap.items.every((item) => item.key !== 'empty'))
  assert.ok(snap.items.some((item) => item.area === 'tp'))
  assert.ok(Object.keys(snap.buildings.radiant).length > 0)
})

test('真机帧重复到达不产生事件', () => {
  const state = new DotaState()
  state.ingest(payload, 1000)
  const second = state.ingest(payload, 2000)
  assert.deepEqual(second.events, [])
})

test('卡片里不会出现 empty', () => {
  const state = new DotaState()
  state.ingest(payload, 1000)
  const card = state.cardText(1100)
  assert.ok(!card.includes('empty'), card)
  assert.match(card, /pudge/)
})
