/** 内存里的状态：最新快照、最近事件、本局和上一局的记录。不落盘。 */
import { normalize, isDotaPayload } from './snapshot.js'
import { diff } from './diff.js'
import { renderMatchCard, renderMatchRecord } from './card.js'
import { clock, span } from './util.js'
import { PHASE_LABEL } from './data.js'

export const STALE_MS = 45_000
/** 掉出对局后至少等这么久才报「回到菜单」，躲开开局载入的空白帧。 */
export const LEAVE_GRACE_MS = 6_000
const MAX_EVENTS = 300
const MAX_EVENT_AGE_MS = 60 * 60 * 1000
const CARD_TTL_MS = 1000

export class DotaState {
  constructor({ names = null, rawKeys = false, now = () => Date.now() } = {}) {
    this.names = names
    this.rawKeys = rawKeys
    this.now = now
    this.snapshot = null
    this.prev = null
    this.received = 0
    this.accepted = 0
    this.firstSeen = null
    this.lastSeen = null
    this.lastPayload = null
    this.events = []
    this.match = null
    this.lastMatch = null
    this.stale = false
    this.cardCache = null
    this.cardAt = 0
    /** 掉出对局后先等一会儿再报，开局载入那一下会短暂没有 map 段。 */
    this.pendingLeave = null
    /** 处理一帧花多少毫秒，面板上给个数，方便判断是不是扩展拖慢了游戏。 */
    this.ingestMs = 0
    this.ingestCount = 0
  }

  /** 收一帧。返回要投递的事件数组；重复帧返回空。 */
  ingest(payload, at = this.now()) {
    const startedAt = performance.now()
    if (!isDotaPayload(payload)) return { accepted: false, events: [] }

    this.received += 1
    this.accepted += 1
    const gap = this.lastSeen === null ? null : at - this.lastSeen
    const wasStale = this.stale || (gap !== null && gap > STALE_MS)

    this.firstSeen ??= at
    this.lastSeen = at
    this.stale = false
    this.lastPayload = payload

    const next = normalize(payload)
    next.at = at

    const events = []
    let keepPrev = false
    if (wasStale) {
      // 断线期间的变化不补发，只报「数据回来了」，避免一次涌入一串过期事件。
      events.push({
        type: 'dota.match.reconnected',
        text: `[刀塔] 数据恢复了，断线 ${span((gap ?? 0) / 1000)}。`,
        meta: { gapMs: gap },
      })
      this.prev = null
      this.pendingLeave = null
    } else {
      const outcome = this.diffFrame(next, at)
      events.push(...outcome.events)
      keepPrev = outcome.keepPrev === true
    }

    if (!keepPrev) {
      this.prev = next
      this.snapshot = next
    }
    this.cardCache = null
    this.trackMatch(next, events, at)
    this.record(events, at)
    this.ingestMs += performance.now() - startedAt
    this.ingestCount += 1
    return { accepted: true, events }
  }

  /** 比对前后帧，顺手处理「掉出对局」的延迟确认。 */
  diffFrame(next, at) {
    const prev = this.prev
    const nowInMatch = next.inMatch

    if (this.pendingLeave) {
      const pending = this.pendingLeave
      if (nowInMatch) {
        const wasEmitted = pending.emitted === true
        this.pendingLeave = null
        if (wasEmitted) return { events: diff(prev, next, { names: this.names, rawKeys: this.rawKeys }) }
        // 开局载入那一下的空白，不当成退出，也不重复报开局；这一帧只当新基线。
        return { events: [], keepPrev: false }
      }
      if (!pending.emitted && at - pending.at >= LEAVE_GRACE_MS) {
        pending.emitted = true
        const last = pending.clock !== null ? `（最后 ${clock(pending.clock)}）` : ''
        return {
          events: [{ type: 'dota.match.left', text: `[刀塔] 回到菜单，这一局没打完${last}。`, meta: { graceMs: at - pending.at } }],
          keepPrev: false,
        }
      }
      return { events: [], keepPrev: true }
    }

    const beforeInMatch = prev?.inMatch === true && prev.phase !== 'postgame'
    if (beforeInMatch && !nowInMatch) {
      this.pendingLeave = { at, clock: prev.clock }
      return { events: [], keepPrev: true }
    }

    return { events: diff(prev, next, { names: this.names, rawKeys: this.rawKeys }), keepPrev: false }
  }

  /** 心跳检查：超时返回一条断线事件，只报一次。 */
  checkStale(at = this.now()) {
    if (this.lastSeen === null || this.stale) return null
    const age = at - this.lastSeen
    if (age <= STALE_MS) return null
    this.stale = true
    const phase = this.snapshot?.phase ?? 'unknown'
    // 菜单和已结束的局里没数据是正常的，只有局内断流才值得叫她。
    if (phase === 'menu' || phase === 'postgame' || phase === 'unknown') return null
    const last = this.snapshot?.clock !== null && this.snapshot?.clock !== undefined ? `，最后一条是 ${clock(this.snapshot.clock)}` : ''
    const event = {
      type: 'dota.match.disconnected',
      text: `[刀塔] 已经 ${span(age / 1000)}没收到数据了${last}（当时在${PHASE_LABEL[phase]}）。`,
      meta: { ageMs: age },
    }
    this.record([event], at)
    return event
  }

  record(events, at) {
    for (const event of events) {
      this.events.push({ at, type: event.type, text: event.text })
    }
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS)
  }

  trackMatch(snap, events, at) {
    const started = events.find((event) => event.type === 'dota.match.started')
    if (started || (snap.inMatch && !this.match)) {
      this.match = {
        startedAt: started ? at : null,
        matchId: snap.matchId,
        heroKey: snap.hero?.key ?? null,
        phase: snap.phase,
      }
    }

    if (this.match) {
      this.match.phase = snap.phase
      this.match.heroKey = snap.hero?.key ?? this.match.heroKey
    }

    const ended = events.find((event) => event.type === 'dota.match.ended')
    if (ended) {
      const player = snap.player ?? {}
      this.lastMatch = {
        endedAt: at,
        clock: snap.clock,
        radiant: snap.radiant,
        dire: snap.dire,
        winTeam: snap.winTeam,
        heroKey: snap.hero?.key ?? null,
        heroId: snap.hero?.id ?? null,
        kills: player.kills ?? null,
        deaths: player.deaths ?? null,
        assists: player.assists ?? null,
        lastHits: player.lastHits ?? null,
        gold: player.gold ?? null,
      }
      this.match = null
    }

    const left = events.find((event) => event.type === 'dota.match.left')
    if (left) this.match = null
  }

  /** 卡片文本；一秒内复用同一份渲染。 */
  cardText(at = this.now()) {
    if (!this.snapshot) return null
    if (this.cardCache && at - this.cardAt < CARD_TTL_MS) return this.cardCache
    this.cardCache = renderMatchCard(this.snapshot, { names: this.names, rawKeys: this.rawKeys })
    this.cardAt = at
    return this.cardCache
  }

  connection(at = this.now()) {
    if (this.lastSeen === null) return { state: 'none', lastSeen: null, ageMs: null }
    const ageMs = at - this.lastSeen
    return { state: ageMs > STALE_MS ? 'stale' : 'online', lastSeen: this.lastSeen, ageMs }
  }

  statusText(at = this.now()) {
    const connection = this.connection(at)
    if (connection.state === 'none') {
      return [
        '[ok] 还没有收到 Dota 2 的数据。',
        '可能的原因：游戏没开、Steam 启动项没加 -gamestateintegration、配置文件没写进游戏目录，或者端口被占用。',
        '这些在 Coopanion 的「刀塔战况」面板里能看到具体是哪一条。',
      ].join('\n')
    }

    const snap = this.snapshot
    if (!snap || !snap.inMatch) {
      const age = `客户端${connection.state === 'stale' ? `已经 ${span(connection.ageMs / 1000)}没有数据` : ` ${span(connection.ageMs / 1000)}前有数据`}`
      const phase = snap ? `，当前在${PHASE_LABEL[snap.phase] ?? '未知状态'}` : ''
      const lines = [`[ok] 没有对局。${age}${phase}。`]
      if (this.lastMatch) lines.push(`上一局：${renderMatchRecord(this.lastMatch, { names: this.names, rawKeys: this.rawKeys })}。`)
      else lines.push('还没有打完的对局记录。')
      return lines.join('\n')
    }

    const lines = [this.cardText(at)]
    if (connection.state === 'stale') {
      lines.push(`（注意：已经 ${span(connection.ageMs / 1000)}没有新数据，这张卡可能停在 ${span((at - snap.at) / 1000)}前。）`)
    }
    return `[ok] ${lines.join('\n')}`
  }

  eventsSince(minutes = 15, limit = 20, at = this.now()) {
    const cutoff = at - minutes * 60_000
    const recent = this.events.filter((event) => event.at >= cutoff && at - event.at <= MAX_EVENT_AGE_MS)
    return {
      total: recent.length,
      items: recent.slice(-limit),
      from: recent.length > 0 ? recent[0].at : null,
      to: recent.length > 0 ? recent[recent.length - 1].at : null,
    }
  }

  matchSummary() {
    if (this.match && this.snapshot?.inMatch) {
      const snap = this.snapshot
      return {
        scope: 'current',
        startedAt: this.match.startedAt,
        clock: snap.clock,
        radiant: snap.radiant,
        dire: snap.dire,
        winTeam: null,
        heroKey: snap.hero?.key ?? null,
        kills: snap.player?.kills ?? null,
        deaths: snap.player?.deaths ?? null,
        assists: snap.player?.assists ?? null,
        lastHits: snap.player?.lastHits ?? null,
        gold: snap.player?.gold ?? null,
      }
    }
    if (this.lastMatch) return { scope: 'last', ...this.lastMatch }
    return null
  }

  debugInfo(at = this.now()) {
    const snap = this.snapshot
    return {
      received: this.received,
      events: this.events.length,
      lastSeen: this.lastSeen,
      connection: this.connection(at),
      phase: snap?.phase ?? null,
      inMatch: snap?.inMatch ?? false,
      clock: snap?.clock ?? null,
      sections: snap?.sections ?? null,
      payloadKeys: snap?.payloadKeys ?? null,
      avgIngestMs: this.ingestCount > 0 ? Math.round((this.ingestMs / this.ingestCount) * 100) / 100 : null,
    }
  }
}
