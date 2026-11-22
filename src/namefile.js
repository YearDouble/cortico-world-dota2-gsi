/** 可选的中文名表。装到 data 目录或包里的 data\names.zh.json，代码只读不写。 */
import fs from 'node:fs'
import path from 'node:path'

function readTable(file) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    const data = JSON.parse(text)
    if (!data || typeof data !== 'object') return null
    const table = {}
    for (const key of ['heroes', 'items', 'abilities']) {
      if (data[key] && typeof data[key] === 'object') table[key] = data[key]
    }
    return Object.keys(table).length > 0 ? table : null
  } catch {
    return null
  }
}

/**
 * 中文名表。包内自带宽表（data/names.zh.json，127 英雄 + 常用装备），
 * data 目录下的同名文件按条目覆盖包内表——用户改自己的叫法时不会被发版冲掉。
 */
export function loadNames({ dataDir, packageDir } = {}) {
  // 先读包内的默认表，再读 data 目录的用户表，后读的覆盖先读的。
  const sources = []
  if (packageDir) sources.push(path.join(packageDir, 'data', 'names.zh.json'))
  if (dataDir) sources.push(path.join(dataDir, 'dota2-gsi', 'names.zh.json'))

  let merged = null
  for (const file of sources) {
    const table = readTable(file)
    if (!table) continue
    merged ??= {}
    for (const [key, value] of Object.entries(table)) merged[key] = { ...(merged[key] ?? {}), ...value }
  }
  return merged
}
