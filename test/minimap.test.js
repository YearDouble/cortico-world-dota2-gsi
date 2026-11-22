import test from 'node:test'
import assert from 'node:assert/strict'

import { MinimapTracker, regionOf, teamOf, buildingKeyOf } from '../src/minimap.js'
import { heroFrame, fill } from './helpers.js'

test('区域判定：坑、基地、边路、中路、河道、野区', () => {
  assert.equal(regionOf(2500, -2300), '肉山坑')
  assert.equal(regionOf(-7000, -6000), '天辉基地')
  assert.equal(regionOf(6000, 5000), '夜魇基地')
  assert.equal(regionOf(-6600, -1000), '上路')
  assert.equal(regionOf(0, -6200), '下路')
  assert.equal(regionOf(-3190, -2926), '中路')
  assert.equal(regionOf(1000, -1000), '河道')
  assert.equal(regionOf(-2000, -5000), '天辉野区')
  assert.equal(regionOf(1500, 3000), '夜魇野区')
  assert.equal(regionOf(null, null), null)
})

test('team 编码和建筑键换算', () => {
  assert.equal(teamOf(2), 'radiant')
  assert.equal(teamOf(3), 'dire')
  assert.equal(teamOf(5), null)
  assert.equal(buildingKeyOf('npc_dota_badguys_tower1_top'), 'dota_badguys_tower1_top')
})

test('self 圈认自己，名单按队分开', () => {
  const tracker = new MinimapTracker()
  tracker.ingest(
    heroFrame(100, [
      { unit: 'npc_dota_hero_axe', x: -6000, y: -6000, self: true, team: 2 },
      { unit: 'npc_dota_hero_lina', x: -3000, y: -3000, team: 2 },
      { unit: 'npc_dota_hero_viper', x: 2000, y: 2000, enemy: true },
    ]),
    100,
  )
  assert.equal(tracker.selfKey, 'npc_dota_hero_axe')
  assert.equal(tracker.selfTeam, 'radiant')
  assert.equal(tracker.enemyRosterCount(), 1)
  assert.equal(tracker.heroesOf('radiant').length, 2)
})

test('敌方建筑连续 4 个有效帧不见才判死，黑窗不背锅', () => {
  const tracker = new MinimapTracker()
  const tower = { unit: 'npc_dota_badguys_tower1_top', x: 6400, y: -1200, team: 3 }
  tracker.ingest(heroFrame(100, fill([tower, { unit: 'npc_dota_hero_axe', x: 0, y: 0, self: true, team: 2 }], 9)), 100)
  tracker.ingest(heroFrame(101, fill([tower], 9)), 101)

  // 黑窗：元素不足的帧不计数。
  tracker.ingest(heroFrame(102, []), 102)
  tracker.ingest(heroFrame(103, []), 103)
  assert.equal(tracker.deadBuildings.size, 0)

  // 正常帧缺席 4 次才判死。
  tracker.ingest(heroFrame(104, fill([], 9)), 104)
  tracker.ingest(heroFrame(105, fill([], 9)), 105)
  tracker.ingest(heroFrame(106, fill([], 9)), 106)
  assert.equal(tracker.deadBuildings.size, 0)
  tracker.ingest(heroFrame(107, fill([], 9)), 107)
  assert.equal(tracker.deadBuildings.size, 1)
  const death = [...tracker.deadBuildings.values()][0]
  assert.equal(death.key, 'dota_badguys_tower1_top')
  assert.equal(death.side, 'dire')
  assert.equal(death.lane, 'top')
  assert.equal(death.tier, 1)
  assert.equal(death.at, 107)
})

test('塔死了是粘性的，复活不了', () => {
  const tracker = new MinimapTracker()
  const tower = { unit: 'npc_dota_badguys_tower1_mid', x: 6400, y: 0, team: 3 }
  tracker.ingest(heroFrame(100, fill([tower], 9)), 100)
  for (let clock = 101; clock <= 105; clock++) tracker.ingest(heroFrame(clock, fill([], 9)), clock)
  assert.equal(tracker.deadBuildings.size, 1)
  // 死过的塔再出现在报文里也不翻活。
  tracker.ingest(heroFrame(106, fill([tower], 9)), 106)
  assert.equal(tracker.deadBuildings.size, 1)
  assert.equal(tracker.buildings.size, 0)
})

test('消失 ≥20 秒的敌人重新露头，记一次现身', () => {
  const tracker = new MinimapTracker()
  tracker.ingest(
    heroFrame(100, [
      { unit: 'npc_dota_hero_axe', x: 0, y: 0, self: true, team: 2 },
      { unit: 'npc_dota_hero_viper', x: 6000, y: 6000, enemy: true },
    ]),
    100,
  )
  tracker.ingest(heroFrame(101, [{ unit: 'npc_dota_hero_axe', x: 0, y: 0, self: true, team: 2 }]), 101)
  tracker.ingest(heroFrame(119, [{ unit: 'npc_dota_hero_axe', x: 0, y: 0, self: true, team: 2 }]), 119)
  // 差 1 秒不满 20 秒，不算。
  assert.equal(tracker.takeAppearances().length, 0)
  tracker.ingest(heroFrame(121, [{ unit: 'npc_dota_hero_axe', x: 0, y: 0, self: true, team: 2 }, { unit: 'npc_dota_hero_viper', x: 500, y: 300, enemy: true }]), 121)
  const appearances = tracker.takeAppearances()
  assert.equal(appearances.length, 1)
  assert.equal(appearances[0].key, 'npc_dota_hero_viper')
  assert.equal(appearances[0].away, 21)
})
