/**
 * 生成 describe.json：内容取定义里的 describe 和 ENV_PROMPT.md。
 *
 *   node tools/build-describe.mjs
 *
 * 市场只读这个文件，不执行扩展代码；改完工具、事件或提示词要重新跑一次。
 */
import fs from 'node:fs'
import path from 'node:path'

import definition from '../src/index.js'

const packageDir = path.join(import.meta.dirname, '..')
const world = definition.create({
  id: definition.id,
  cfg: {},
  dataDir: undefined,
  timezone: 'Asia/Shanghai',
})

const prompts = []
for (const doc of world.webUi('zh').promptDocs ?? []) {
  if (doc.role !== 'envPrompt' || !fs.existsSync(doc.path)) continue
  prompts.push({
    key: doc.key,
    title: doc.title,
    ...(doc.role ? { role: doc.role } : {}),
    content: fs.readFileSync(doc.path, 'utf8'),
  })
}

const file = {
  tools: definition.describe.tools,
  events: definition.describe.events,
  ...(prompts.length > 0 ? { prompts } : {}),
}

const out = path.join(packageDir, 'describe.json')
fs.writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
console.log(`[ok] ${out}：${file.tools.length} 个工具、${file.events.length} 个事件、${prompts.length} 份提示词`)
