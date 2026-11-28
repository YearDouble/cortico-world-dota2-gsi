#!/usr/bin/env node
/**
 * 生成 data/names.zh.json（英雄 / 装备的中文名表）。
 *
 *   node tools/build-names.mjs --index <知识库/wiki/index.md> --items <知识库/装备.md> \
 *        [--heroes-json <缓存>] [--items-json <缓存>] [--out data/names.zh.json]
 *
 * 数据来源：
 *   - 内部键名（npc_dota_hero_nevermore → nevermore、item_blink → blink）来自 OpenDota 常量接口；
 *   - 中文名来自本机 Dota 2 知识库（7.42 版核对过的索引和装备表）。
 * 两者按「英雄 id」和「英文显示名」合并；合不上的条目跳过，卡片自动退回内部键名，不会错。
 *
 * 知识库路径不在包里（那是 Coo 的笔记），所以这个脚本只在维护时跑，生成结果随包发布。
 */
import fs from 'node:fs'
import path from 'node:path'

const OPENDOTA_HEROES = 'https://api.opendota.com/api/heroes'
const OPENDOTA_ITEMS = 'https://api.opendota.com/api/constants/items'

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    const value = argv[i + 1]
    if (!key?.startsWith('--') || value === undefined) continue
    out[key.slice(2)] = value
  }
  return out
}

async function loadJson(url, cached) {
  if (cached) return JSON.parse(fs.readFileSync(cached, 'utf8'))
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} 返回 ${response.status}`)
  return response.json()
}

/** `| 11 | 影魔 | Shadow Fiend | 影魔.md |  |` → Map(id → 中文名) */
function parseWikiIndex(text) {
  const byId = new Map()
  for (const line of text.split(/\r?\n/)) {
    const match = /^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/.exec(line)
    if (!match) continue
    byId.set(Number(match[1]), match[2].trim())
  }
  return byId
}

/** `### 闪烁匕首 (Blink Dagger)` → [{ zh, en }] */
function parseItemHeadings(text) {
  const out = []
  for (const line of text.split(/\r?\n/)) {
    const match = /^###\s+(.+?)\s*\(([^)]+)\)\s*$/.exec(line)
    if (!match) continue
    out.push({ zh: match[1].trim(), en: match[2].trim() })
  }
  return out
}

/** 英文名归一：小写、去标点、空格变下划线——用来兜底匹配 OpenDota 的内部键。 */
function normalizeKey(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '_')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.index || !args.items) {
    console.error('[failed] 用法：node tools/build-names.mjs --index <wiki/index.md> --items <装备.md> [--heroes-json f] [--items-json f] [--out f]')
    process.exit(1)
  }
  const outFile = args.out ?? path.join(import.meta.dirname, '..', 'data', 'names.zh.json')
  return { args, outFile }
}

const { args, outFile } = main()

const heroes = await loadJson(OPENDOTA_HEROES, args['heroes-json'])
const itemConstants = await loadJson(OPENDOTA_ITEMS, args['items-json'])

const wikiById = parseWikiIndex(fs.readFileSync(args.index, 'utf8'))
const heroTable = {}
let heroMissed = 0
for (const hero of heroes) {
  const zh = wikiById.get(hero.id)
  const short = String(hero.name ?? '').replace(/^npc_dota_hero_/, '')
  if (!zh || !short) {
    heroMissed += 1
    continue
  }
  heroTable[short] = zh
}

const byDname = new Map()
for (const [key, value] of Object.entries(itemConstants)) {
  const dname = typeof value?.dname === 'string' ? value.dname.trim().toLowerCase() : ''
  if (dname) byDname.set(dname, key)
}

const itemTable = {}
/** 知识库装备表里没有、或英文名对不上的补充条目（2026-11-25 真机遇到）。 */
const EXTRA_ITEMS = { famango: '莲花', diffusal_blade: '散失之刃' }
const itemMissed = []
for (const { zh, en } of parseItemHeadings(fs.readFileSync(args.items, 'utf8'))) {
  let key = byDname.get(en.toLowerCase())
  if (!key) {
    // 兜底：英文名直接归一成内部键，再确认这个键真的存在（避免造出不存在的键）。
    const guess = normalizeKey(en)
    if (itemConstants[guess]) key = guess
  }
  if (!key) {
    itemMissed.push(en)
    continue
  }
  itemTable[key] = zh
}
Object.assign(itemTable, EXTRA_ITEMS)

// 排序输出，diff 稳定。
const sorted = (table) => Object.fromEntries(Object.entries(table).sort(([a], [b]) => a.localeCompare(b)))
const payload = {
  _meta: {
    note: '英雄/装备中文名表。由 tools/build-names.mjs 生成，不要手改。',
    source: 'OpenDota 内部键名 + 本机 Dota 2 知识库 7.42 中文名',
    generatedAt: new Date().toISOString().slice(0, 10),
  },
  heroes: sorted(heroTable),
  items: sorted(itemTable),
}

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
console.log(`[ok] ${outFile}`)
console.log(`     英雄 ${Object.keys(heroTable).length}/${heroes.length}（缺 ${heroMissed}）`)
console.log(`     装备 ${Object.keys(itemTable).length}/${Object.keys(itemTable).length + itemMissed.length}（缺 ${itemMissed.length}）`)
if (itemMissed.length > 0) console.log(`     没合上的装备：${itemMissed.join('、')}`)
