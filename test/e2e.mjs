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

/** 真机帧（2026-11-15 探针样本裁剪），一条一行带 ts 外壳。 */
function loadProbeFrames() {
  const file = new URL('./fixtures/real-probe.jsonl', import.meta.url)
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line).body)
}

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

  // v0.2 管线：真机帧回放一遍，看名单、位置库和事件文本。
  // HTTP 链路上面那段已经验过，这里直接喂状态机，好让真机帧进独立的状态。
  const probeFrames = loadProbeFrames()
  if (probeFrames.length > 0) {
    console.log(`\n=== 真机帧回放（${probeFrames.length} 帧）===\n`)
    const probeState = new DotaState()
    let cursor = 0
    let at = Date.now() - probeFrames.length * 500
    for (const frame of probeFrames) {
      probeState.ingest(frame, at)
      at += 500
      cursor += 1
    }
    console.log(`喂了 ${cursor} 帧真机数据，产生 ${probeState.events.length} 条事件：\n`)
    for (const event of probeState.events) console.log(`  ${event.text}`)
    console.log('\n位置库回执（dota_minimap）：\n')
    console.log(probeState.minimapReceipt())
    console.log('\n位置库调试：\n')
    console.log(probeState.auxDebugText())
  }

  await receiver.stop()
}

if (!process.env.NODE_TEST_CONTEXT) await main()
