import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { gsiConfigText, libraryPathsFromVdf, writeGsiConfig, gsiFilePath } from '../src/gsi.js'

test('cfg 文本带端口、节流和 buildings', () => {
  const text = gsiConfigText({ port: 35123, throttle: 0.5, heartbeat: 10 })
  assert.match(text, /127\.0\.0\.1:35123\/"/)
  assert.match(text, /"throttle"\t"0\.5"/)
  assert.match(text, /"heartbeat"\t"10\.0"/)
  assert.match(text, /"buildings"\t"1"/)
  assert.match(text, /"wearables"\t"0"/)
})

test('libraryfolders 的新旧两种写法都能读', () => {
  const vdf = [
    '"libraryfolders"',
    '{',
    '\t"0"',
    '\t{',
    '\t\t"path"\t\t"E:\\\\Software\\\\Steam"',
    '\t}',
    '\t"1"',
    '\t{',
    '\t\t"path"\t\t"D:\\\\SteamLibrary"',
    '\t}',
    '}',
  ].join('\n')
  const paths = libraryPathsFromVdf(vdf, 'C:\\Steam')
  const lowered = paths.map((item) => item.toLowerCase())
  assert.ok(lowered.includes('c:\\steam'))
  assert.ok(lowered.includes('e:\\software\\steam'))
  assert.ok(lowered.includes('d:\\steamlibrary'))
})

test('写 cfg 只写自己那一个文件', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dota-gsi-'))
  try {
    const file = writeGsiConfig(dir, gsiConfigText({ port: 36001 }))
    assert.equal(file, gsiFilePath(dir))
    assert.ok(fs.existsSync(file))
    assert.match(fs.readFileSync(file, 'utf8'), /36001/)
    assert.deepEqual(fs.readdirSync(path.join(dir, 'gamestate_integration')), [
      'gamestate_integration_coopanion.cfg',
    ])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
