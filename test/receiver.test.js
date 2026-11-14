import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { DotaReceiver } from '../src/receiver.js'
import { DotaState } from '../src/state.js'

const frames = JSON.parse(fs.readFileSync(new URL('../data/sample-match.json', import.meta.url), 'utf8'))

test('接收器只收 Dota 的 POST，坏报文回 400', async (t) => {
  const state = new DotaState()
  const receiver = new DotaReceiver({ port: 0, onPayload: (payload) => state.ingest(payload) })
  await receiver.start()
  t.after(() => receiver.stop())

  const base = `http://127.0.0.1:${receiver.address.port}/`
  const post = (body) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body })

  let response = await post(JSON.stringify(frames[0]))
  assert.equal(response.status, 200)
  assert.equal(state.received, 1)

  response = await post('{ broken')
  assert.equal(response.status, 400)

  response = await post(JSON.stringify({ provider: { appid: 730 }, map: {} }))
  assert.equal(response.status, 400)
  assert.equal(state.received, 1)

  response = await fetch(base)
  assert.equal(response.status, 405)
})

test('处理报文抛错时回 500，服务还活着', async (t) => {
  const receiver = new DotaReceiver({
    port: 0,
    onPayload: () => {
      throw new Error('boom')
    },
  })
  await receiver.start()
  t.after(() => receiver.stop())

  const base = `http://127.0.0.1:${receiver.address.port}/`
  const response = await fetch(base, { method: 'POST', body: JSON.stringify(frames[0]) })
  assert.equal(response.status, 500)
  assert.equal(receiver.listening, true)
})
