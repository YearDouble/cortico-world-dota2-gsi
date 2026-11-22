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

test('主信号·首波金额：加速给双倍（~80）→ Turbo，0:00 刷 1:00 前就能判出来', () => {
  const mode = new ModeInference()
  mode.noteBountyPickup(20, 80)
  assert.equal(mode.mode, 'turbo')
  assert.equal(mode.basis, 'bounty')
})

test('首波金额 ~40 = 常规（真机归档实测基线：172 秒时 40）', () => {
  const mode = new ModeInference()
  mode.noteBountyPickup(15, 40)
  assert.equal(mode.mode, 'regular')
  assert.equal(mode.basis, 'bounty')
})

test('首波金额落在中间带不硬判（阈值等一局真机校准）', () => {
  const mode = new ModeInference()
  mode.noteBountyPickup(30, 60)
  assert.equal(mode.mode, 'unknown')
})

test('节奏信号：240 秒内 ≥3 次拾取只能是 2 分钟一波的加速局（每波只有 2 个符）', () => {
  const mode = new ModeInference()
  // 首波金额 60（中间带）不判，让节奏来说话。
  ;[5, 130, 140].forEach((t) => mode.noteBountyPickup(t, 60))
  assert.equal(mode.mode, 'turbo')
  assert.equal(mode.basis, 'bounty')
  const late = new ModeInference()
  ;[10, 250, 260].forEach((t) => late.noteBountyPickup(t, 60))
  assert.equal(late.mode, 'unknown', '480 秒内不足 5 次，常规也说得通')
})

test('XPM 不再判 Turbo（打钱快慢因人而异，year 定调），只作低速确认', () => {
  const mode = new ModeInference()
  assert.equal(mode.observe(snap({ xpm: 1500 }), 200), 'unknown', '雪崩的常规局不该被误判成加速')
  const regular = new ModeInference()
  assert.equal(regular.observe(snap({ xpm: 550 }), 450), 'regular')
  assert.equal(regular.basis, 'xpm')
  const early = new ModeInference()
  assert.equal(early.observe(snap({ xpm: 550 }), 300), 'unknown', '7 分钟之前不判常规')
})

test('Turbo 证据能推翻先前误判的常规', () => {
  const mode = new ModeInference()
  mode.observe(snap({ xpm: 550 }), 450)
  assert.equal(mode.mode, 'regular')
  // 赏金符节奏（480 秒内 5 次）随后翻案。
  ;[10, 250, 260, 470, 480].forEach((t) => mode.noteBountyPickup(t, 60))
  assert.equal(mode.mode, 'turbo')

  const byRoshan = new ModeInference()
  byRoshan.observe(snap({ xpm: 550 }), 450)
  byRoshan.noteTurbo('roshan')
  assert.equal(byRoshan.mode, 'turbo')
  assert.equal(byRoshan.basis, 'roshan')
})

test('被动金钱不再判常规（校准：加速局也是 3 金/秒），翻倍仍是 Turbo 备份', () => {
  const mode = new ModeInference()
  assert.equal(mode.observe(snap({ income: 300 }), 100), 'unknown')
  assert.equal(mode.incomeRate, 3)
  const doubled = new ModeInference()
  assert.equal(doubled.observe(snap({ income: 600 }), 100), 'turbo')
})

test('补刀单价只判 Turbo（加速局实测约 41 金/刀，和常规没差别）', () => {
  const mode = new ModeInference()
  assert.equal(mode.observe(snap({ lastHits: 8, creepGold: 330 }), 120), 'unknown')
  assert.equal(mode.creepBounty, 41.3)
  const doubled = new ModeInference()
  assert.equal(doubled.observe(snap({ lastHits: 10, creepGold: 820 }), 130), 'turbo')
})

test('将来 GSI 补了 game_mode 就走字段，优先于推断', () => {
  const mode = new ModeInference()
  assert.equal(mode.observe(snap({ gameModeNum: 23, xpm: 1500 }), 300), 'turbo')
  assert.equal(mode.basis, 'game_mode')

  const regular = new ModeInference()
  assert.equal(regular.observe(snap({ gameModeNum: 22, xpm: 550 }), 450), 'regular')
})
