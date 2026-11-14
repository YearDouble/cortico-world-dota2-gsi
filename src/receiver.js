/** 本机小 HTTP 服务：只接 POST、只认 Dota、只监听回环地址。 */
import http from 'node:http'

const MAX_BODY_BYTES = 2 * 1024 * 1024

export class DotaReceiver {
  constructor({ port = 35123, host = '127.0.0.1', onPayload } = {}) {
    this.port = port
    this.host = host
    this.onPayload = onPayload
    this.server = null
    this.error = null
    this.requests = 0
    this.rejected = 0
  }

  get listening() {
    return this.server?.listening === true
  }

  get address() {
    return this.server?.address() ?? null
  }

  async start() {
    if (this.server) return
    this.error = null
    const server = http.createServer((req, res) => this.handle(req, res))
    this.server = server

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off('listening', onListening)
        this.error = error
        this.server = null
        reject(error)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(this.port, this.host)
    })
  }

  async stop() {
    const server = this.server
    this.server = null
    if (!server) return
    await new Promise((resolve) => {
      try {
        server.close(() => resolve())
        server.closeAllConnections?.()
      } catch {
        resolve()
      }
    })
  }

  handle(req, res) {
    this.requests += 1
    const reply = (status, body) => {
      const text = JSON.stringify(body)
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
      res.end(text)
    }

    if (req.method !== 'POST') {
      this.rejected += 1
      reply(405, { ok: false, error: 'only POST' })
      return
    }

    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        this.rejected += 1
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', () => {
      this.rejected += 1
    })
    req.on('end', () => {
      let payload
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        this.rejected += 1
        reply(400, { ok: false, error: 'bad json' })
        return
      }

      Promise.resolve()
        .then(() => this.onPayload?.(payload))
        .then((result) => {
          if (result && result.accepted === false) {
            this.rejected += 1
            reply(400, { ok: false, error: result.reason ?? 'not dota' })
            return
          }
          reply(200, { ok: true })
        })
        .catch((error) => {
          this.rejected += 1
          reply(500, { ok: false, error: String(error?.message ?? error) })
        })
    })
  }
}
