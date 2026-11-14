import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'

import definition from '../src/index.js'

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

function makeCtx(port) {
  return {
    id: 'dota2-gsi',
    cfg: { net: { port, throttle: 0.5, heartbeat: 10 }, display: { rawKeys: false } },
    dataDir: os.tmpdir(),
    timezone: 'Asia/Shanghai',
    botName: 'test',
    persist: () => {},
  }
}

test('定义形状符合 api 6', () => {
  assert.equal(definition.id, 'dota2-gsi')
  assert.equal(typeof definition.label, 'string')
  const defaults = definition.defaults()
  assert.equal(defaults.enabled, false)
  assert.equal(defaults.net.port, 35123)
  assert.equal(typeof definition.create, 'function')
  assert.ok(Array.isArray(definition.describe.events))
})

test('三个工具、环境提示词、面板、配置键都对', () => {
  const world = definition.create(makeCtx(35123))
  assert.equal(world.tools().length, 3)
  assert.deepEqual(world.envPromptVars(), {})

  const web = world.webUi('zh')
  assert.equal(web.panels[0].id, 'live')
  assert.ok(fs.existsSync(web.promptDocs[0].path))
  for (const group of web.config) {
    for (const key of Object.keys(group.schema.properties)) {
      assert.ok(key.startsWith('worlds.dota2-gsi.'), `配置键要从 config.json 根算起：${key}`)
    }
  }
})

test('起服务、收两帧、把事件交给宿主', async () => {
  const port = await freePort()
  const world = definition.create(makeCtx(port))
  const pushed = []
  const host = {
    pushEvent: async (event, opts) => {
      pushed.push({ event, trigger: opts?.trigger })
      return { cursor: 1 }
    },
    log: { info() {}, warn() {} },
  }

  await world.start(host)
  try {
    for (const frame of [frames[4], frames[6]]) {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(frame),
      })
      assert.equal(response.status, 200)
    }
    await new Promise((resolve) => setTimeout(resolve, 60))

    const died = pushed.find((item) => item.event.type === 'dota.player.died')
    assert.ok(died, '没有收到阵亡事件')
    assert.equal(died.trigger, 'flush')
    assert.equal(died.event.source, 'dota2-gsi')
    assert.match(died.event.text, /45 秒后复活/)
    assert.match(died.event.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
  } finally {
    await world.stop()
  }
  assert.equal(world.receiver, null)
})

test('面板接口：喂一段测试数据能看到事件和卡', async () => {
  const world = definition.create(makeCtx(await freePort()))
  const simulated = await world.invokePanel('live', 'simulate', ['sequence'])
  assert.equal(simulated.ok, true)
  assert.ok(simulated.frames > 5)
  assert.ok(simulated.events.length > 5)

  const status = await world.invokePanel('live', 'status', [])
  assert.equal(status.ok, true)
  assert.ok(status.configText.includes('"buildings"'))
  assert.ok(status.events.length > 0)
  assert.match(status.card, /刀塔战况|没有对局/)

  const raw = await world.invokePanel('live', 'raw', [])
  assert.ok(raw.text.includes('"provider"'))
})
