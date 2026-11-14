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

export function loadNames({ dataDir, packageDir } = {}) {
  const sources = []
  if (dataDir) sources.push(path.join(dataDir, 'dota2-gsi', 'names.zh.json'))
  if (packageDir) sources.push(path.join(packageDir, 'data', 'names.zh.json'))

  let merged = null
  for (const file of sources) {
    const table = readTable(file)
    if (!table) continue
    merged ??= {}
    for (const [key, value] of Object.entries(table)) merged[key] = { ...(merged[key] ?? {}), ...value }
  }
  return merged
}
