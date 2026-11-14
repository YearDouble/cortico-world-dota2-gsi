/**
 * 端到端演练：起接收器，按顺序把一局帧 POST 进去，打印每条事件和最后的卡。
 *
 *   node test/e2e.mjs
 *
 * 不开游戏，只验证「HTTP → 快照 → 事件」这条链。事件文本是给人看的，读一遍像不像人话。
 * 被 `node --test` 扫到时不执行，避免测试输出里混进演练内容。
 */
import fs from 'node:fs'
import net from 'node:net'

import { DotaReceiver } from '../src/receiver.js'
import { DotaState } from '../src/state.js'

const frames = JSON.parse(fs.readFileSync(new URL('../data/sample-match.json', import.meta.url), 'utf8'))

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function main() {
  const port = await freePort()
  const state = new DotaState()
  const receiver = new DotaReceiver({ port, onPayload: (payload) => state.ingest(payload) })
  await receiver.start()

  console.log(`接收器：http://127.0.0.1:${port}/`)
  let count = 0

  for (const frame of frames) {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(frame),
    })
    if (response.status !== 200) console.log(`  第 ${count + 1} 帧返回 ${response.status}`)
    count += 1
    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  console.log(`\n喂了 ${count} 帧，产生 ${state.events.length} 条事件：\n`)
  for (const event of state.events) console.log(`  ${event.text}`)

  console.log('\n最后的卡：\n')
  console.log(state.cardText())

  await receiver.stop()
}

if (!process.env.NODE_TEST_CONTEXT) await main()
