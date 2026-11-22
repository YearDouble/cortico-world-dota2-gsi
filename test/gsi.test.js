import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { gsiConfigText, libraryPathsFromVdf, writeGsiConfig, gsiFilePath, launchOptionState } from '../src/gsi.js'

test('cfg 文本带端口、节流和 buildings', () => {
  const text = gsiConfigText({ port: 35123, throttle: 0.5, heartbeat: 10 })
  assert.match(text, /127\.0\.0\.1:35123\/"/)
  assert.match(text, /"throttle"\t"0\.5"/)
  assert.match(text, /"heartbeat"\t"10\.0"/)
  assert.match(text, /"buildings"\t"1"/)
  assert.match(text, /"wearables"\t"0"/)
})

test('cfg 订 events 和 minimap，弃订恒空的段（D15）', () => {
  const text = gsiConfigText()
  assert.match(text, /"events"\t"1"/)
  assert.match(text, /"minimap"\t"1"/)
  assert.doesNotMatch(text, /"draft"/)
  assert.doesNotMatch(text, /"roshan"/)
  assert.doesNotMatch(text, /"neutralitems"/)
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

test('启动项检测：多账号里任何一个写了就算写了', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steam-root-'))
  try {
    const write = (account, launch) => {
      const dir = path.join(root, 'userdata', account, 'config')
      fs.mkdirSync(dir, { recursive: true })
      const options = launch === null ? '' : `\t\t\t"LaunchOptions"\t\t"${launch}"\n`
      fs.writeFileSync(
        path.join(dir, 'localconfig.vdf'),
        `"UserLocalConfigStore"\n{\n\t"Software"\n\t{\n\t\t"Valve"\n\t\t{\n\t\t\t"Steam"\n\t\t\t{\n\t\t\t\t"apps"\n\t\t\t\t{\n\t\t\t\t\t"570"\n\t\t\t\t\t{\n${options}\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}\n`,
        'utf8',
      )
      return path.join(dir, 'localconfig.vdf')
    }

    // 一个账号没写、一个写了：结论是写了（用户可能从任意账号启动）。
    const withOpt = write('111', '-perfectworld -gamestateintegration')
    write('222', null)
    let state = launchOptionState(root)
    assert.equal(state.state, 'set')
    assert.equal(state.path, withOpt)

    // 全都改掉：结论是没写。
    fs.rmSync(path.join(root, 'userdata', '111'), { recursive: true, force: true })
    state = launchOptionState(root)
    assert.equal(state.state, 'unset')

    // 一个账号都没有 570：不知道。
    fs.rmSync(path.join(root, 'userdata', '222'), { recursive: true, force: true })
    state = launchOptionState(root)
    assert.equal(state.state, 'unknown')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
