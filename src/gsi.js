/** 找 Dota 目录、生成 cfg、判断 Steam 启动项。只读检测；写入只写自己那一个文件。 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const CFG_NAME = 'gamestate_integration_coopanion.cfg'

export function gsiConfigText({ port = 35123, throttle = 0.5, heartbeat = 10 } = {}) {
  return [
    '"Coopanion Dota 2"',
    '{',
    `\t"uri"\t\t"http://127.0.0.1:${port}/"`,
    '\t"timeout"\t"5.0"',
    '\t"buffer"\t"0.1"',
    `\t"throttle"\t"${throttle}"`,
    `\t"heartbeat"\t"${heartbeat}.0"`,
    '\t"data"',
    '\t{',
    '\t\t"provider"\t"1"',
    '\t\t"map"\t\t"1"',
    '\t\t"player"\t"1"',
    '\t\t"hero"\t\t"1"',
    '\t\t"abilities"\t"1"',
    '\t\t"items"\t\t"1"',
    '\t\t"draft"\t\t"1"',
    '\t\t"buildings"\t"1"',
    '\t\t"wearables"\t"0"',
    '\t}',
    '}',
    '',
  ].join('\r\n')
}

export function steamRootFromRegistry() {
  if (process.platform !== 'win32') return null
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 4000,
    })
    const line = out.split(/\r?\n/).find((row) => row.includes('SteamPath'))
    const value = line?.split('REG_SZ')[1]?.trim()
    return value ? value.replace(/\//g, '\\') : null
  } catch {
    return null
  }
}

/** 从 libraryfolders.vdf 里取出所有 Steam 库路径，包含 Steam 根本身。 */
export function libraryPathsFromVdf(text, steamRoot) {
  const out = new Set()
  if (steamRoot) out.add(steamRoot)
  if (typeof text !== 'string') return [...out]
  for (const match of text.matchAll(/"path"\s+"([^"]+)"/g)) {
    const value = match[1].replace(/\\\\/g, '\\')
    if (value) out.add(value)
  }
  // 旧格式：直接给序号和路径。
  for (const match of text.matchAll(/"\d+"\s+"([A-Za-z]:[^"]+)"/g)) {
    const value = match[1].replace(/\\\\/g, '\\')
    if (value) out.add(value)
  }
  return [...out]
}

export function findDotaCfgDir({ steamRoot } = {}) {
  const root = steamRoot ?? steamRootFromRegistry()
  if (!root) return null
  const libraries = [root]
  try {
    const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8')
    libraries.push(...libraryPathsFromVdf(vdf, null))
  } catch {
    // 没有 libraryfolders.vdf 时只用 Steam 根目录。
  }

  for (const library of new Set(libraries)) {
    const cfgDir = path.join(library, 'steamapps', 'common', 'dota 2 beta', 'game', 'dota', 'cfg')
    try {
      if (fs.statSync(cfgDir).isDirectory()) return { cfgDir, gameDir: path.dirname(cfgDir), library }
    } catch {
      // 这个库里没装，试下一个。
    }
  }
  return null
}

export function gsiFilePath(cfgDir) {
  return path.join(cfgDir, 'gamestate_integration', CFG_NAME)
}

export function writeGsiConfig(cfgDir, text = gsiConfigText()) {
  if (!cfgDir) throw new Error('没有配置目录')
  const dir = path.join(cfgDir, 'gamestate_integration')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, CFG_NAME)
  fs.writeFileSync(file, text, { encoding: 'utf8' })
  return file
}

/** Steam 启动项里有没有 -gamestateintegration。只看，不改。 */
export function launchOptionState(steamRoot) {
  const root = steamRoot ?? steamRootFromRegistry()
  if (!root) return { state: 'unknown', path: null, value: null }
  let userdata
  try {
    userdata = fs.readdirSync(path.join(root, 'userdata'), { withFileTypes: true })
  } catch {
    return { state: 'unknown', path: null, value: null }
  }

  for (const entry of userdata) {
    if (!entry.isDirectory()) continue
    const file = path.join(root, 'userdata', entry.name, 'config', 'localconfig.vdf')
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const index = text.indexOf('"570"')
    if (index < 0) continue
    const window = text.slice(index, index + 6000)
    const match = /"LaunchOptions"\s+"([^"]*)"/.exec(window)
    if (!match) return { state: 'unset', path: file, value: '' }
    const value = match[1]
    return { state: value.includes('-gamestateintegration') ? 'set' : 'unset', path: file, value }
  }
  return { state: 'unknown', path: null, value: null }
}
