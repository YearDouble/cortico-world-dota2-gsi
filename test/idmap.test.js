import test from 'node:test'
import assert from 'node:assert/strict'

import { IdMap, teamOfChatId } from '../src/idmap.js'
import { MinimapTracker } from '../src/minimap.js'
import { heroFrame } from './helpers.js'

test('chat id 的队属：≤4 天辉、5+ 夜魇', () => {
  assert.equal(teamOfChatId(0), 'radiant')
  assert.equal(teamOfChatId(4), 'radiant')
  assert.equal(teamOfChatId(5), 'dire')
  assert.equal(teamOfChatId(9), 'dire')
  assert.equal(teamOfChatId(-1), null)
})

test('自己的 id 从 team_slot 算，夜魇 +5（D16，待真机验证）', () => {
  const idmap = new IdMap()
  idmap.updateSelf({ player: { team: 'radiant', teamSlot: 3 }, hero: { key: 'npc_dota_hero_axe' } })
  assert.equal(idmap.selfId, 3)
  assert.equal(idmap.name(3), 'npc_dota_hero_axe')

  const dire = new IdMap()
  dire.updateSelf({ player: { team: 'dire', teamSlot: 2 }, hero: { key: 'npc_dota_hero_lina' } })
  assert.equal(dire.selfId, 7)
  assert.equal(dire.name(7), 'npc_dota_hero_lina')
})

test('受害者靠死亡瞬间的消失来关联', () => {
  const tracker = new MinimapTracker()
  const idmap = new IdMap()
  idmap.updateSelf({ player: { team: 'radiant', teamSlot: 0 }, hero: { key: 'npc_dota_hero_axe' } })
  // 敌方 viper 在 clock 100 露头，之后消失；击杀事件 time=101。
  tracker.ingest(
    heroFrame(100, [
      { unit: 'npc_dota_hero_axe', x: 0, y: 0, self: true, team: 2 },
      { unit: 'npc_dota_hero_viper', x: 6000, y: 6000, enemy: true },
    ]),
    100,
  )
  tracker.ingest(heroFrame(102, [{ unit: 'npc_dota_hero_axe', x: 0, y: 0, self: true, team: 2 }]), 102)

  idmap.associateVictim({ kind: 'kill', victimId: 7, time: 101 }, tracker)
  assert.equal(idmap.name(7), 'npc_dota_hero_viper')
})

test('消失太久的不算受害者，宁可不解出来', () => {
  const tracker = new MinimapTracker()
  const idmap = new IdMap()
  // viper 早在 50 秒前就不见了（那是别的事），击杀在 100。
  tracker.ingest(
    heroFrame(50, [
      { unit: 'npc_dota_hero_axe', x: 0, y: 0, self: true, team: 2 },
      { unit: 'npc_dota_hero_viper', x: 6000, y: 6000, enemy: true },
    ]),
    50,
  )
  tracker.ingest(heroFrame(100, [{ unit: 'npc_dota_hero_axe', x: 0, y: 0, self: true, team: 2 }]), 100)
  idmap.associateVictim({ kind: 'kill', victimId: 7, time: 100 }, tracker)
  assert.equal(idmap.name(7), null)
})

test('队伍过滤：天辉的受害者不会绑到夜魇头上', () => {
  const tracker = new MinimapTracker()
  const idmap = new IdMap()
  tracker.ingest(
    heroFrame(100, [
      { unit: 'npc_dota_hero_axe', x: 0, y: 0, self: true, team: 2 },
      { unit: 'npc_dota_hero_viper', x: 6000, y: 6000, enemy: true },
    ]),
    100,
  )
  tracker.ingest(heroFrame(101, [{ unit: 'npc_dota_hero_axe', x: 0, y: 0, self: true, team: 2 }]), 101)
  // victimId=2 是天辉的 id，viper 是夜魇，绑不上；axe 在击杀之后还活着露头，也不算受害者。
  idmap.associateVictim({ kind: 'kill', victimId: 2, time: 100 }, tracker)
  assert.equal(idmap.name(2), null)
})
