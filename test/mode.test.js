import test from 'node:test'
import assert from 'node:assert/strict'

import { ModeInference } from '../src/mode.js'

function snap({ income = null, level = null, gameModeNum = null, lastHits = null, creepGold = null, xpm = null } = {}) {
  return {
    player: { goldFromIncome: income, goldFromCreepKills: creepGold, lastHits, xpm },
    hero: level === null ? {} : { level },
    gameModeNum,
  }
}

test('主信号 XPM：加速局 2-3 分钟就上 1000，直接判 Turbo', () => {
  const mode = new ModeInference()
  assert.equal(mode.observe(snap({ xpm: 1200 }), 200), 'turbo')
  assert.equal(mode.basis, 'xpm')
  assert.equal(mode.isTurbo, true)
})

test('XPM 低位且过了 7 分钟 = 常规（真机校准：常规 381-613，加速 1494-2256）', () => {
  const mode = new ModeInference()
  assert.equal(mode.observe(snap({ xpm: 550 }), 450), 'regular')
  assert.equal(mode.basis, 'xpm')
  // 7 分钟之前不判常规——低分段/劣势局会和加速局重叠。
  const early = new ModeInference()
  assert.equal(early.observe(snap({ xpm: 550 }), 300), 'unknown')
})

test('被动金钱不再判常规（2026-11-22 校准：加速局也是 3 金/秒，判了就是错的）', () => {
  const mode = new ModeInference()
  assert.equal(mode.observe(snap({ income: 300 }), 100), 'unknown')
  assert.equal(mode.incomeRate, 3, '实测值还是记下来，面板上看')
})

test('被动金钱翻倍仍当 Turbo 证据（备份信号）', () => {
  const mode = new ModeInference()
  assert.equal(mode.observe(snap({ income: 600 }), 100), 'turbo')
  assert.equal(mode.basis, 'income')
})

test('补刀单价只判 Turbo，不判常规（加速局实测约 41 金/刀，和常规没差别）', () => {
  const mode = new ModeInference()
  assert.equal(mode.observe(snap({ lastHits: 8, creepGold: 330 }), 120), 'unknown')
  assert.equal(mode.creepBounty, 41.3)
  const doubled = new ModeInference()
  assert.equal(doubled.observe(snap({ lastHits: 10, creepGold: 820 }), 130), 'turbo')
  assert.equal(doubled.basis, 'creep')
})

test('Turbo 证据能推翻先前误判的常规', () => {
  const mode = new ModeInference()
  mode.observe(snap({ xpm: 550 }), 450)
  assert.equal(mode.mode, 'regular')
  // 之后 XPM 飙上去（或者肉山早露头、补刀单价翻倍）都要能改判。
  assert.equal(mode.observe(snap({ xpm: 1500 }), 460), 'turbo')

  const byRoshan = new ModeInference()
  byRoshan.observe(snap({ xpm: 550 }), 450)
  byRoshan.noteTurbo('roshan')
  assert.equal(byRoshan.mode, 'turbo')
  assert.equal(byRoshan.basis, 'roshan')
})

test('等级兜底只判 Turbo（≥8 @ 4 分钟），不再判常规', () => {
  const turbo = new ModeInference()
  assert.equal(turbo.observe(snap({ level: 9 }), 300), 'turbo')
  const regular = new ModeInference()
  assert.equal(regular.observe(snap({ level: 4 }), 300), 'unknown')
})

test('将来 GSI 补了 game_mode 就走字段，优先于推断', () => {
  const mode = new ModeInference()
  assert.equal(mode.observe(snap({ gameModeNum: 23, xpm: 550 }), 300), 'turbo')
  assert.equal(mode.basis, 'game_mode')

  const regular = new ModeInference()
  assert.equal(regular.observe(snap({ gameModeNum: 22, xpm: 1500 }), 300), 'regular')
})

test('落在中间带不硬判', () => {
  const mode = new ModeInference()
  assert.equal(mode.observe(snap({ xpm: 800 }), 300), 'unknown')
  assert.equal(mode.observe(snap({ income: 420 }), 100), 'unknown')
})
