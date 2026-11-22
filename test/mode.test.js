import test from 'node:test'
import assert from 'node:assert/strict'

import { ModeInference } from '../src/mode.js'

function snap({ income = null, level = null, gameModeNum = null, lastHits = null, creepGold = null } = {}) {
  return {
    player: income === null && creepGold === null ? {} : { goldFromIncome: income, goldFromCreepKills: creepGold, lastHits },
    hero: level === null ? {} : { level },
    gameModeNum,
  }
}

test('被动金钱 3 金/秒 = 常规（真机实测基线）', () => {
  const mode = new ModeInference()
  assert.equal(mode.observe(snap({ income: 87 }), 29), 'unknown', '30 秒前不下结论')
  assert.equal(mode.observe(snap({ income: 300 }), 100), 'regular')
  assert.equal(mode.basis, 'income')
  assert.equal(mode.incomeRate, 3)
})

test('被动金钱翻倍 = Turbo', () => {
  const mode = new ModeInference()
  assert.equal(mode.observe(snap({ income: 600 }), 100), 'turbo')
  assert.equal(mode.basis, 'income')
  assert.equal(mode.isTurbo, true)
})

test('落在中间带不硬判，等更强信号', () => {
  const mode = new ModeInference()
  assert.equal(mode.observe(snap({ income: 420 }), 100), 'unknown')
  assert.equal(mode.isTurbo, false)
})

test('肉山本体早露头是铁证：能把已判的常规改回 Turbo', () => {
  const mode = new ModeInference()
  mode.observe(snap({ income: 300 }), 100)
  assert.equal(mode.mode, 'regular')
  mode.noteTurbo('roshan')
  assert.equal(mode.mode, 'turbo')
  assert.equal(mode.basis, 'roshan')
})

test('等级兜底：4 分钟后 9 级算 Turbo、4 级算常规', () => {
  const turbo = new ModeInference()
  assert.equal(turbo.observe(snap({ level: 9 }), 300), 'turbo')
  const regular = new ModeInference()
  assert.equal(regular.observe(snap({ level: 4 }), 300), 'regular')
})

test('将来 GSI 补了 game_mode 就走字段，优先于推断', () => {
  const mode = new ModeInference()
  assert.equal(mode.observe(snap({ gameModeNum: 23, income: 300 }), 100), 'turbo')
  assert.equal(mode.basis, 'game_mode')

  const regular = new ModeInference()
  assert.equal(regular.observe(snap({ gameModeNum: 22, income: 600 }), 100), 'regular')
})

test('补刀单价：一刀约 40 金 = 常规（year 2026-11-22 提议的早期信号）', () => {
  const mode = new ModeInference()
  assert.equal(mode.observe(snap({ lastHits: 8, creepGold: 330 }), 120), 'regular')
  assert.equal(mode.basis, 'creep')
  assert.equal(mode.creepBounty, 41.3)
})

test('补刀单价翻倍 = Turbo，且能推翻被动金钱误判的常规', () => {
  const mode = new ModeInference()
  // 被动金钱没翻倍（3.0 金/秒）→ 先按常规走。
  mode.observe(snap({ income: 300 }), 100)
  assert.equal(mode.mode, 'regular')
  // 兵线金钱翻倍（82 金/刀）→ 改判 Turbo。
  assert.equal(mode.observe(snap({ income: 300, lastHits: 10, creepGold: 820 }), 130), 'turbo')
  assert.equal(mode.basis, 'creep')
})

test('补刀太少不下结论，中间带也不硬判', () => {
  const mode = new ModeInference()
  assert.equal(mode.observe(snap({ lastHits: 2, creepGold: 90 }), 120), 'unknown')
  const middle = new ModeInference()
  assert.equal(middle.observe(snap({ lastHits: 10, creepGold: 580 }), 150), 'unknown')
})
