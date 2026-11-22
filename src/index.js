import fs from 'node:fs'
import path from 'node:path'

import { DotaReceiver } from './receiver.js'
import { DotaState } from './state.js'
import { createTools } from './tools.js'
import { loadNames } from './namefile.js'
import { triggerOf } from './diff.js'
import { EVENT_DECLS, TOOL_DECLS } from './declarations.js'
import { PHASE_LABEL } from './data.js'
import { clock, span } from './util.js'
import * as gsi from './gsi.js'

const WORLD_ID = 'dota2-gsi'
const CFG = `worlds.${WORLD_ID}`
const PACKAGE_DIR = path.join(import.meta.dirname, '..')
const ENV_PROMPT_FILE = path.join(PACKAGE_DIR, 'ENV_PROMPT.md')
const SAMPLE_FILE = path.join(PACKAGE_DIR, 'data', 'sample-match.json')

const DEFAULT_NET = { port: 35123, throttle: 0.5, heartbeat: 10 }
const DEFAULT_DISPLAY = { rawKeys: false }

function num(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function isoLocal(date = new Date()) {
  const pad = (value) => String(Math.abs(value)).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
}

function hhmmss(ms) {
  const date = new Date(ms)
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}


class DotaWorld {
  constructor(ctx) {
    this.id = WORLD_ID
    this.ctx = ctx
    this.host = null
    this.names = null
    this.state = new DotaState()
    this.receiver = null
    this.receiverError = null
    this.staleTimer = null
    this.dotaCache = null
  }

  netConfig() {
    const cfg = this.ctx.cfg ?? {}
    return {
      port: Math.max(1024, Math.min(65535, num(cfg.net?.port, DEFAULT_NET.port))),
      throttle: Math.max(0.1, Math.min(5, num(cfg.net?.throttle, DEFAULT_NET.throttle))),
      heartbeat: Math.max(1, Math.min(60, num(cfg.net?.heartbeat, DEFAULT_NET.heartbeat))),
    }
  }

  fillDefaults() {
    const cfg = this.ctx.cfg ?? {}
    const patch = {}
    const net = {}
    for (const [key, value] of Object.entries(DEFAULT_NET)) {
      if (cfg.net?.[key] === undefined) net[key] = value
    }
    if (Object.keys(net).length > 0) patch.net = net
    const display = {}
    for (const [key, value] of Object.entries(DEFAULT_DISPLAY)) {
      if (cfg.display?.[key] === undefined) display[key] = value
    }
    if (Object.keys(display).length > 0) patch.display = display
    if (Object.keys(patch).length > 0 && typeof this.ctx.persist === 'function') this.ctx.persist(patch)
  }

  async start(host) {
    this.host = host
    this.fillDefaults()
    this.names = loadNames({ dataDir: this.ctx.dataDir, packageDir: PACKAGE_DIR })
    this.state = new DotaState({
      names: this.names,
      rawKeys: this.ctx.cfg?.display?.rawKeys === true,
    })
    await this.startReceiver()
    this.staleTimer = setInterval(() => {
      const event = this.state.checkStale()
      if (event) this.deliver(event)
    }, 5000)
    this.staleTimer.unref?.()
    this.log('info', `刀塔战况启动，监听 127.0.0.1:${this.netConfig().port}`)
  }

  async stop() {
    if (this.staleTimer) clearInterval(this.staleTimer)
    this.staleTimer = null
    this.host = null
    const receiver = this.receiver
    this.receiver = null
    try {
      await receiver?.stop()
    } catch {
      // 关闭失败不影响卸载。
    }
  }

  async startReceiver() {
    const previous = this.receiver
    this.receiver = null
    try {
      await previous?.stop()
    } catch {
      // 忽略旧服务的关闭错误。
    }

    const { port } = this.netConfig()
    const receiver = new DotaReceiver({ port, onPayload: (payload) => this.handlePayload(payload) })
    this.receiver = receiver
    this.receiverError = null
    try {
      await receiver.start()
    } catch (error) {
      this.receiverError = `端口 ${port} 监听失败：${error?.code === 'EADDRINUSE' ? '端口被别的程序占了' : error?.message ?? error}`
      this.log('warn', this.receiverError)
    }
  }

  handlePayload(payload) {
    try {
      const { accepted, events } = this.state.ingest(payload)
      if (accepted) {
        for (const event of events) this.deliver(event)
      }
      return { accepted }
    } catch (error) {
      this.log('warn', `处理报文失败：${error?.message ?? error}`)
      return { accepted: false, reason: 'internal error' }
    }
  }

  deliver(event) {
    const host = this.host
    if (!host?.pushEvent) return
    // 防御（2026-11-15 事故）：type/text 缺失的事件会让宿主主循环在 appendEventFrame
    // 崩溃（frameEventRefs 读 text.length），且毒事件入库后每次启动补投重放、循环崩溃
    // （当晚连崩约 30 次）。宁丢一条，不炸循环；告警带事件形状+堆栈，再冒出来直接定位产生分支。
    if (!event || typeof event.type !== 'string' || typeof event.text !== 'string') {
      this.log(
        'warn',
        `丢弃畸形事件（type/text 缺失）：${JSON.stringify(event)?.slice(0, 200)}\n${new Error().stack}`,
      )
      return
    }
    const envelope = {
      type: event.type,
      ts: isoLocal(),
      source: WORLD_ID,
      text: event.text,
      meta: event.meta,
    }
    Promise.resolve()
      .then(() => host.pushEvent(envelope, { trigger: triggerOf(event.type) }))
      .catch((error) => this.log('warn', `投递 ${event.type} 失败：${error?.message ?? error}`))
  }

  log(level, message) {
    try {
      const logger = this.host?.log ?? this.ctx?.log
      if (logger?.[level]) logger[level](message)
      else logger?.info?.(message)
    } catch {
      // 日志失败不影响主流程。
    }
  }

  tools() {
    return createTools(this.state, { timezone: this.ctx.timezone })
  }

  envPromptVars() {
    return {}
  }

  webUi(language) {
    const en = language === 'en'
    const cfg = this.ctx.cfg ?? {}
    const connection = this.state.connection()
    const inMatch = this.state.snapshot?.inMatch === true
    const phase = this.state.snapshot?.phase
    const { port } = this.netConfig()

    return {
      label: en ? 'Dota 2 Live' : '刀塔战况',
      lamps: [
        {
          label: en ? 'Connection' : '连接',
          state: connection.state === 'online' ? 'online' : 'offline',
          hint: this.receiverError
            ? this.receiverError
            : connection.state === 'online'
              ? `${en ? 'port' : '端口'} ${port}，${en ? 'last data' : '最后一条'} ${span(connection.ageMs / 1000)}${en ? ' ago' : '前'}`
              : en
                ? `port ${port}, nothing received yet`
                : `端口 ${port}，还没收到数据`,
        },
        {
          label: en ? 'Match' : '对局',
          state: inMatch ? 'online' : 'offline',
          hint: inMatch
            ? `${PHASE_LABEL[phase] ?? ''}${this.state.snapshot?.clock !== null ? ` ${clock(this.state.snapshot.clock)}` : ''}`
            : en
              ? 'not in a match'
              : '不在对局中',
        },
      ],
      panels: [
        {
          id: 'live',
          title: en ? 'Live' : '实况',
          description: en
            ? 'Connection state, the current card, recent events, and a button to write the game-side config file.'
            : '连接状态、这一刻的卡片、最近的事件，以及把配置文件写进游戏目录的按钮。',
          getMethods: ['status'],
        },
      ],
      config: [
        {
          id: 'dota2-gsi.net',
          owner: `world:${WORLD_ID}`,
          schema: {
            type: 'object',
            title: en ? 'Listener' : '监听',
            description: en
              ? 'Where the game sends data. Changing these needs a Coopanion restart and a rewritten config file.'
              : '游戏往哪里送数据。改完要重启 Coopanion，并重新点一次「写入 Dota 配置」。',
            properties: {
              [`${CFG}.net.port`]: {
                type: 'integer',
                title: en ? 'Local port' : '本机端口',
                description: en ? 'Only 127.0.0.1 is bound.' : '只监听 127.0.0.1，不对外。',
                minimum: 1024,
                maximum: 65535,
                default: DEFAULT_NET.port,
                'x-hot': false,
              },
              [`${CFG}.net.throttle`]: {
                type: 'number',
                title: en ? 'Send interval (seconds)' : '发送间隔（秒）',
                description: en
                  ? 'Written into the game config as throttle. Smaller is more real-time.'
                  : '写进游戏配置的 throttle，越小越实时，也越费 CPU。',
                minimum: 0.1,
                maximum: 5,
                default: DEFAULT_NET.throttle,
                'x-hot': false,
              },
              [`${CFG}.net.heartbeat`]: {
                type: 'number',
                title: en ? 'Heartbeat (seconds)' : '心跳间隔（秒）',
                description: en ? 'Written into the game config.' : '写进游戏配置的 heartbeat。',
                minimum: 1,
                maximum: 60,
                default: DEFAULT_NET.heartbeat,
                'x-hot': false,
              },
            },
          },
        },
        {
          id: 'dota2-gsi.display',
          owner: `world:${WORLD_ID}`,
          schema: {
            type: 'object',
            title: en ? 'Display' : '显示',
            description: en ? 'Takes effect on the next read.' : '改完下一次读取就生效。',
            properties: {
              [`${CFG}.display.rawKeys`]: {
                type: 'boolean',
                title: en ? 'Show raw keys' : '显示原始键名',
                description: en
                  ? 'Shows npc_dota_hero_nevermore instead of nevermore.'
                  : '显示 npc_dota_hero_nevermore 这种原始键，排查用。',
                default: DEFAULT_DISPLAY.rawKeys,
              },
            },
          },
        },
        {
          id: 'dota2-gsi.timings',
          owner: `world:${WORLD_ID}`,
          schema: {
            type: 'object',
            title: en ? 'Reminder / Roshan times' : '提醒与肉山时刻',
            description: en
              ? 'Spawn times in seconds for lotus / water rune / wisdom rune reminders, plus Roshan first spawn and respawn base. Empty = built-in default (regular vs Turbo auto). 0 turns the pickups off; Roshan first spawn 0 means "up from the start". Takes effect next match. Tune here when a Dota patch changes timings.'
              : '莲花/圣水符/经验符文提醒、肉山首刷和复活基准的刷新时刻（秒）。留空=用内置默认（自动分常规/Turbo）；拾取提醒填 0=关掉那条，肉山首刷填 0=开局就在。改完下一局生效。Dota 更新改了时间，先在这里救急改。',
            properties: {
              [`${CFG}.timings.water1`]: {
                type: 'integer',
                title: en ? 'Water rune #1' : '圣水符 · 第一次',
                minimum: 0,
                maximum: 3600,
                'x-hot': true,
              },
              [`${CFG}.timings.water2`]: {
                type: 'integer',
                title: en ? 'Water rune #2' : '圣水符 · 第二次',
                minimum: 0,
                maximum: 3600,
                'x-hot': true,
              },
              [`${CFG}.timings.lotus1`]: {
                type: 'integer',
                title: en ? 'Lotus #1' : '莲花 · 第一次',
                minimum: 0,
                maximum: 3600,
                'x-hot': true,
              },
              [`${CFG}.timings.lotus2`]: {
                type: 'integer',
                title: en ? 'Lotus #2' : '莲花 · 第二次',
                minimum: 0,
                maximum: 3600,
                'x-hot': true,
              },
              [`${CFG}.timings.wisdom1`]: {
                type: 'integer',
                title: en ? 'Wisdom rune #1' : '经验符文 · 第一次',
                minimum: 0,
                maximum: 3600,
                'x-hot': true,
              },
              [`${CFG}.timings.roshanFirst`]: {
                type: 'integer',
                title: en ? 'Roshan first spawn' : '肉山 · 首刷',
                description: en
                  ? 'Default 1200 (20:00) regular, 0 in Turbo.'
                  : '默认常规 1200（20:00）、Turbo 0。填 0 = 开局就在。',
                minimum: 0,
                maximum: 3600,
                'x-hot': true,
              },
              [`${CFG}.timings.roshanRespawn`]: {
                type: 'integer',
                title: en ? 'Roshan respawn base' : '肉山 · 复活基准',
                description: en
                  ? 'Base respawn in seconds; each kill shortens it by 60s, floor 300s. Default 660 (11 min).'
                  : '复活基准秒数；每次被打败减 60 秒，最低 300 秒。默认 660（11 分钟）。',
                minimum: 300,
                maximum: 3600,
                'x-hot': true,
              },
            },
          },
        },
      ],
      promptDocs: [
        {
          key: `worlds.${WORLD_ID}.envPrompt`,
          title: en ? 'Dota 2 Live · environment prompt' : '刀塔战况 · 环境提示词',
          description: en
            ? 'What this extension can see during a match, and what it cannot.'
            : '告诉她这一局能看到什么、看不到什么。',
          path: ENV_PROMPT_FILE,
          role: 'envPrompt',
          vars: [],
        },
      ],
      invoke: async (panel, method, args) => this.invokePanel(panel, method, args),
    }
  }

  detectDota(force = false) {
    const now = Date.now()
    if (!force && this.dotaCache && now - this.dotaCache.at < 60_000) return this.dotaCache.value
    const found = gsi.findDotaCfgDir()
    const launch = gsi.launchOptionState()
    const value = {
      cfgDir: found?.cfgDir ?? null,
      library: found?.library ?? null,
      launchOption: launch.state,
      launchValue: launch.value ?? null,
    }
    this.dotaCache = { at: now, value }
    return value
  }

  panelStatus() {
    const connection = this.state.connection()
    const detected = this.detectDota()
    const snap = this.state.snapshot
    const cfgFile = detected.cfgDir ? gsi.gsiFilePath(detected.cfgDir) : null
    const card = snap?.inMatch ? this.state.cardText() : this.state.statusText().replace(/^\[ok\]\s*/, '')
    const events = this.state.events.slice(-20).map((event) => ({ time: hhmmss(event.at), text: event.text }))

    return {
      ok: true,
      connection: connection.state,
      connectionAge: connection.ageMs,
      port: this.netConfig().port,
      listening: this.receiver?.listening === true,
      receiverError: this.receiverError,
      phase: snap?.phase ?? null,
      phaseLabel: snap?.phase ? PHASE_LABEL[snap.phase] : null,
      inMatch: snap?.inMatch === true,
      card,
      events,
      auxDebug: this.state.auxDebugText(),
      stats: this.state.debugInfo(),
      dota: {
        cfgDir: detected.cfgDir,
        cfgFile,
        cfgExists: cfgFile ? fs.existsSync(cfgFile) : false,
        launchOption: detected.launchOption,
        launchValue: detected.launchValue,
        library: detected.library,
      },
      configText: gsi.gsiConfigText(this.netConfig()),
    }
  }

  async invokePanel(panel, method, args) {
    if (panel !== 'live') return { error: '没有这个面板' }
    const a = Array.isArray(args) ? args : []

    if (method === 'status') return this.panelStatus()
    if (method === 'configText') return { text: gsi.gsiConfigText(this.netConfig()) }

    if (method === 'raw') {
      if (!this.state.lastPayload) return { error: '还没有收到过报文' }
      return { text: JSON.stringify(this.state.lastPayload, null, 2) }
    }

    if (method === 'writeConfig') {
      const detected = this.detectDota(true)
      if (!detected.cfgDir) {
        return {
          error: '没找到 Dota 2 的配置目录',
          hint: '可以在面板里复制配置内容，手动放到 <Steam 库>\\steamapps\\common\\dota 2 beta\\game\\dota\\cfg\\gamestate_integration\\ 下面。',
          text: gsi.gsiConfigText(this.netConfig()),
        }
      }
      try {
        const file = gsi.writeGsiConfig(detected.cfgDir, gsi.gsiConfigText(this.netConfig()))
        this.log('info', `写入 GSI 配置：${file}`)
        return { ok: true, path: file, dir: detected.cfgDir }
      } catch (error) {
        return { error: `写入失败：${error?.message ?? error}` }
      }
    }

    if (method === 'simulate') {
      const kind = a[0] === 'frame' ? 'frame' : 'sequence'
      try {
        const text = fs.readFileSync(SAMPLE_FILE, 'utf8')
        const frames = JSON.parse(text)
        const list = Array.isArray(frames) ? frames : [frames]
        const chosen = kind === 'frame' ? list.slice(-1) : list
        const events = []
        for (const payload of chosen) {
          const result = this.state.ingest(payload)
          for (const event of result.events ?? []) events.push(event.text)
        }
        return { ok: true, frames: chosen.length, events }
      } catch (error) {
        return { error: `喂测试数据失败：${error?.message ?? error}` }
      }
    }

    if (method === 'retry') {
      this.dotaCache = null
      await this.startReceiver()
      return { ok: this.receiverError === null, error: this.receiverError }
    }

    if (method === 'detect') return { ok: true, ...this.detectDota(true) }

    return { error: '没有这个方法' }
  }
}

export default {
  id: WORLD_ID,
  label: '刀塔战况',
  defaults: () => ({
    enabled: false,
    net: { ...DEFAULT_NET },
    display: { ...DEFAULT_DISPLAY },
  }),
  describe: { tools: TOOL_DECLS, events: EVENT_DECLS },
  create(ctx) {
    return new DotaWorld(ctx)
  },
}
