import test from 'node:test'
import assert from 'node:assert/strict'

import { ModeInference } from '../src/mode.js'

function snap({ income = null, level = null, gameModeNum = null } = {}) {
  return {
    player: income === null ? {} : { goldFromIncome: income },
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
