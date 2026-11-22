import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

import { loadNames } from '../src/namefile.js'
import { heroName, itemName } from '../src/names.js'

const PACKAGE_DIR = path.join(import.meta.dirname, '..')

test('包内自带中文名表：127 英雄 + 188 装备', () => {
  const names = loadNames({ packageDir: PACKAGE_DIR })
  assert.ok(names, '应该能读到 data/names.zh.json')
  assert.equal(Object.keys(names.heroes ?? {}).length, 127)
  assert.ok(Object.keys(names.items ?? {}).length >= 150, '装备表至少 150 条')
})

test('名字解析：内部键 → 中文，未知键退回短名', () => {
  const names = loadNames({ packageDir: PACKAGE_DIR })
  assert.equal(heroName('npc_dota_hero_nevermore', names), '影魔')
  assert.equal(heroName('npc_dota_hero_axe', names), '斧王')
  assert.equal(itemName('item_blink', names), '闪烁匕首')
  assert.equal(itemName('item_black_king_bar', names), '黑皇杖')
  // 表里没有的键别乱猜，退回去掉前缀的短名。
  assert.equal(heroName('npc_dota_hero_not_a_real_hero', names), 'not_a_real_hero')
  // rawKeys 模式仍然优先。
  assert.equal(heroName('npc_dota_hero_nevermore', names, true), 'npc_dota_hero_nevermore')
})

test('用户自己的名表放 data 目录会覆盖包内条目', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dota-names-'))
  try {
    fs.mkdirSync(path.join(dir, 'dota2-gsi'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'dota2-gsi', 'names.zh.json'),
      JSON.stringify({ heroes: { nevermore: '影魔（我自己的叫法）' } }),
      'utf8',
    )
    const names = loadNames({ dataDir: dir, packageDir: PACKAGE_DIR })
    assert.equal(heroName('npc_dota_hero_nevermore', names), '影魔（我自己的叫法）')
    // 没被覆盖的条目还在。
    assert.equal(heroName('npc_dota_hero_axe', names), '斧王')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
