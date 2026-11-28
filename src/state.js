/** 内存里的状态：最新快照、最近事件、本局和上一局的记录。不落盘。 */
import { normalize, isDotaPayload } from './snapshot.js'
import { diff } from './diff.js'
import { renderMatchCard, renderMatchRecord } from './card.js'
import { clock, span } from './util.js'
import { PHASE_LABEL } from './data.js'
import { MinimapTracker, regionOf } from './minimap.js'
import { EventStream } from './eventstream.js'
import { IdMap } from './idmap.js'
import { FightEngine } from './fights.js'
import { ROSH_FIRST_SPAWN } from './fights.js'
import { PromptEngine } from './prompts.js'
import { ModeInference } from './mode.js'
import { heroName } from './names.js'

export const STALE_MS = 45_000
/** 掉出对局后至少等这么久才报「回到菜单」，躲开开局载入的空白帧。 */
export const LEAVE_GRACE_MS = 6_000
const MAX_EVENTS = 300
const MAX_EVENT_AGE_MS = 60 * 60 * 1000
const CARD_TTL_MS = 1000
/** 名单事件的稳定窗：这套阵容连续 10 秒没变才发（躲开选人期队色翻转和晚进的英雄）。 */
const LINEUP_STABLE_SECS = 10
/** 3:00 还没凑齐就发手上有的（真机局视野慢、敌人陆续可见），缺总比没有强。 */
const LINEUP_TIMEOUT_CLOCK = 180

/** 昼夜切换确认时长（秒）：实测常规局 daytime 会假翻 ~10 秒，连续这么久才播报。 */
const DAY_CHANGE_CONFIRM = 20

export class DotaState {
  constructor({ names = null, rawKeys = false, now = () => Date.now(), cfg = null } = {}) {
    this.names = names
    this.rawKeys = rawKeys
    this.now = now
    /** 宿主配置的活引用（worlds.dota2-gsi），timings/mode 的设置覆盖都从这里读。 */
    this.cfg = cfg
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

    // ---- v0.2 管线（PLAN 第 15 章）：位置库 + 事件流收集器 + id 映射 + 规则机 ----
    this.tracker = new MinimapTracker()
    this.stream = new EventStream()
    this.idmap = new IdMap()
    this.fights = new FightEngine()
    this.prompts = new PromptEngine()
    /** 常规/Turbo 推断（GSI 不发 game_mode，见 mode.js）。 */
    this.mode = new ModeInference()
    /** 模式刚判出来时的那句话，由 ingest 带给 World 记一条日志（一局一条）。 */
    this.modeNote = null
    this.matchKey = null
    this.lineupEmitted = false
    /** 名单稳定窗观察：{ key, since }，同一套阵容连续 10 秒才发 lineup。 */
    this.lineupWatch = null
    /** 已发出名单的敌方键集，变了就要补更正。 */
    this.lineupEmittedKey = null
    /** 进 playing 后做过一次幻影清扫（bot 局选人残留，见 minimap.sweepPreGamePhantoms）。 */
    this.preGameSwept = false
    /** 自己阵亡后等击杀事件来对账的钩子：{ at }，对不上就给 idmap 记一次 mismatch。 */
    this.pendingSelfDeath = null
    /** 昼夜防抖：{ stable, candidate, since }，候选值连续 20 秒才认（见 trackDay）。 */
    this.dayState = { stable: null, candidate: null, since: null }
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

    // v0.2 管线要用「上一帧」做终局收口和自机死亡对账，先存下来，下一行就把它覆盖了。
    const prevSnap = this.prev
    if (!keepPrev) {
      this.prev = next
      this.snapshot = next
    }
    this.cardCache = null
    this.trackMatch(next, events, at)
    // v0.2 管线：位置库、事件流、团战和情报。产出的事件和 diff 事件走同一条投递路。
    events.push(...this.ingestAux(payload, next, at, prevSnap))
    this.record(events, at)
    this.ingestMs += performance.now() - startedAt
    this.ingestCount += 1
    const modeNote = this.modeNote
    this.modeNote = null
    return { accepted: true, events, modeNote }
  }

  /**
   * v0.2 管线（PLAN 15.4 提炼层）。只在局内、有 map 时钟时走；
   * 换 matchid 就整体重置（一局一套名单和位置库）。
   */
  ingestAux(payload, next, at, prevSnap = null) {
    const events = []
    const showName = (key) => heroName(key, this.names, this.rawKeys) ?? key

    if (next.matchId && next.matchId !== this.matchKey) {
      this.matchKey = next.matchId
      this.tracker.reset()
      this.stream.reset()
      this.idmap.reset()
      this.fights.reset()
      this.prompts.reset()
      this.mode.reset()
      this.modeNote = null
      this.lineupEmitted = false
      this.lineupWatch = null
      this.lineupEmittedKey = null
      this.preGameSwept = false
      this.pendingSelfDeath = null
      this.dayState = { stable: null, candidate: null, since: null }
    }

    // 终局：把还开着口的团战先收掉，让 fight.ended 和 match.ended 一起走。
    if (next.phase === 'postgame' && prevSnap?.phase !== 'postgame' && this.fights.window.length >= 2) {
      const selfTeam = this.tracker.selfTeam ?? (next.player?.team === 'dire' ? 'dire' : 'radiant')
      events.push(...this.fights.flush(next.clock ?? 0, this.idmap, showName, selfTeam, next))
    }

    const clockSec = next.clock
    if (!next.inMatch || next.phase === 'postgame' || clockSec === null || clockSec === undefined) return events

    this.tracker.ingest(payload, clockSec, next)
    // 常规/Turbo 推断：XPM 为主证据（2026-11-22 校准：加速局 XPM 1500+，常规局 600 上下），
    // 肉山本体在 20:00 前露头是 Turbo 的铁证。判定结果（含改判）每局写一条日志。
    const modeBefore = this.mode.mode
    const basisBefore = this.mode.basis
    // 手动模式（面板设置 / dota_mode 工具）优先于一切推断；每帧同步，改了立即生效。
    this.applyModeConfig()
    this.mode.observe(next, clockSec)
    // 肉山强信号（2026-11-25 两局翻案）：旧判据「20:00 前小地图看到肉山本体」被常规局打脸——
    // minimap 里肉山本体本来就会提前出现（第一局 15:10 起 137 帧、第二局开局前 9 秒就有，
    // 坐标显示它在地图上往两个坑走）。真铁证只有一个：20:00 前肉山真的被打死（加速首刷 0:00）。
    // 放在 fights.update 之后判，killAt 是事件 time（clock 基准）。
    // 幻影清扫要在名单确认（lineup）之前做，免得选人残留写进阵容事件。
    if (next.phase === 'playing' && !this.preGameSwept) {
      this.preGameSwept = true
      this.tracker.sweepPreGamePhantoms(clockSec)
    }
    this.idmap.updateSelf(next)
    // 原生事件只带 game_time，换到 clock 基准才能和 minimap 对齐（一局内这个差恒定）。
    const offset = next.gameTime !== null ? clockSec - next.gameTime : 0
    const records = this.stream.ingest(payload?.events, offset)

    // 名单事件（2026-11-22 两局翻案后重写）：加速局选人时钟是正的、bot 局选人期全场标天辉色，
    // 旧触发「敌方凑够 5 个就发」会发出发育不全的名单——多报 7 个、漏宙斯都是它。
    // 新规矩：进游戏（幻影清扫已做）+ 敌我两边都正好 5 个 + 这套名单稳定 10 秒才发；
    // 3:00 还没凑齐就发手上有的，缺总比没有强。真机局敌人靠视野陆续进名单，稳定条件天然满足。
    if (!this.lineupEmitted && this.preGameSwept && clockSec >= 0) {
      const enemies = this.tracker.enemyRoster()
      const allies = this.tracker.teamRoster(this.tracker.selfTeam ?? 'radiant', 5)
      const key = `${allies.length}|${enemies.map((hero) => hero.key).sort().join(',')}`
      if (this.lineupWatch?.key !== key) this.lineupWatch = { key, since: clockSec }
      const stableFor = clockSec - this.lineupWatch.since
      if (
        (enemies.length === 5 && allies.length === 5 && stableFor >= LINEUP_STABLE_SECS) ||
        clockSec >= LINEUP_TIMEOUT_CLOCK
      ) {
        this.lineupEmitted = true
        this.lineupEmittedKey = enemies.map((hero) => hero.key).sort().join(',')
        events.push(this.lineupEvent(next, clockSec))
      }
    } else if (
      this.lineupEmitted &&
      this.preGameSwept &&
      next.phase === 'playing' &&
      clockSec >= 0 &&
      this.tracker.selfTeam
    ) {
      // 名单更正（2026-11-22 宙斯案）：发出后名单又变了——漏的人晚进视野、残留被清掉——
      // 稳定 10 秒后补一条更正，别让她拿着错名单说下去。
      const enemies = this.tracker.enemyRoster()
      const key = enemies.map((hero) => hero.key).sort().join(',')
      if (key !== this.lineupEmittedKey) {
        if (this.lineupWatch?.key !== key) this.lineupWatch = { key, since: clockSec }
        if (clockSec - this.lineupWatch.since >= LINEUP_STABLE_SECS) {
          this.lineupEmittedKey = key
          const names = enemies.map((hero) => heroName(hero.key, this.names, this.rawKeys) ?? hero.short)
          events.push({
            type: 'dota.match.lineup',
            text: `[刀塔 ${clock(clockSec)}] 名单更正：敌方 ${names.join('/')}。`,
            meta: { clock: clockSec, phase: next.phase, correction: true },
          })
        }
      }
    }

    // D16 的自校验：自己阵亡后 6 个游戏秒内应该有一条 victimId=自己 id 的击杀记录。
    const selfId = this.idmap.selfId
    if (next.hero && prevSnap?.hero && prevSnap.hero.alive !== false && next.hero.alive === false) {
      this.pendingSelfDeath = { at: clockSec }
      this.idmap.noteSelfDeath()
    }
    if (this.pendingSelfDeath) {
      const killSeen = records.some((record) => record.kind === 'kill' && record.victimId === selfId)
      if (killSeen) this.pendingSelfDeath = null
      else if (clockSec - this.pendingSelfDeath.at > 6) {
        this.idmap.selfIdMismatches += 1
        this.pendingSelfDeath = null
      }
    }

    // 赏金符拾取喂给模式推断（金额+节奏，见 mode.js）。放在 records 出来之后。
    for (const record of records) {
      if (record.kind === 'bountyPickup') this.mode.noteBountyPickup(record.gameTime, record.bountyValue)
    }

    events.push(
      ...this.fights.update({
        clock: clockSec,
        snap: next,
        records,
        tracker: this.tracker,
        idmap: this.idmap,
        names: this.names,
        rawKeys: this.rawKeys,
        mode: this.mode.mode,
        cfgTimings: this.timingsConfig(),
      }),
    )
    // 加速铁证：常规首刷（20:00）之前肉山就被打死了。minimap 露头只喂状态机，不参与判模式。
    const roshState = this.fights.roshan
    if (roshState.deaths > 0 && roshState.killAt !== null && roshState.killAt < ROSH_FIRST_SPAWN.regular) {
      this.mode.noteTurbo('roshan')
    }
    // 昼夜防抖（diff 里不再直接发）：候选值连续 20 秒才认，假翻转直接丢。
    const dayEvent = this.trackDay(next)
    if (dayEvent) events.push(dayEvent)
    // 时刻表提醒（莲花/圣水符/经验符）：纯时刻 + 中单条件，见 prompts.js。
    events.push(
      ...this.prompts.tick({
        clock: clockSec,
        snap: next,
        tracker: this.tracker,
        cfgTimings: this.timingsConfig(),
        mode: this.mode.mode,
      }),
    )
    // 模式判定/改判都要落一条日志——赏金符拾取在 records 之后才进来，所以这条放帧末。
    if (modeBefore !== this.mode.mode || basisBefore !== this.mode.basis) {
      const label = this.mode.mode === 'turbo' ? '加速' : this.mode.mode === 'regular' ? '常规' : '判断中'
      const basisLabel = this.mode.basis === 'manual' ? '手动指定' : this.mode.basis
      const evidence =
        this.mode.basis === 'bounty' && this.mode.bountyPickups.length > 0
          ? `赏金符 ${this.mode.bountyPickups.map((p) => `${p.t}s/${p.v}金`).join('、')}`
          : this.mode.basis === 'roshan' && this.fights.roshan.killAt !== null
            ? `肉山 ${clock(this.fights.roshan.killAt)} 就被打了（常规 20:00 才首刷）`
            : this.mode.basis === 'xpm' && this.mode.xpm !== null
            ? `XPM ${this.mode.xpm}`
            : this.mode.basis === 'creep' && this.mode.creepBounty !== null
              ? `补刀单价 ${this.mode.creepBounty} 金/刀`
              : this.mode.basis === 'income' && this.mode.incomeRate !== null
                ? `被动金钱 ${this.mode.incomeRate} 金/秒`
                : basisLabel
      this.modeNote = `对局模式判定：${label}（${evidence}）`
    }
    return events
  }

  /** 设置组 timings.*：逐条覆盖默认时刻（秒，0=关）。缺了就用源码默认表，合法性 prompts.tick 里验。 */
  /**
   * 昼夜防抖：daytime 在过渡期会假翻（实测常规局 10:37 天黑、10:47 天亮），
   * 候选值连续 DAY_CHANGE_CONFIRM 秒没翻回来才算真的，返回要播报的事件或 null。
   */
  trackDay(snap) {
    const day = snap?.day
    const at = snap?.clock
    if (typeof day !== 'boolean' || at === null || at === undefined || at <= 0) return null
    const state = this.dayState
    if (state.stable === null) {
      state.stable = day
      return null
    }
    if (day === state.stable) {
      state.candidate = null
      state.since = null
      return null
    }
    if (state.candidate !== day) {
      state.candidate = day
      state.since = at
      return null
    }
    if (at - state.since < DAY_CHANGE_CONFIRM) return null
    state.stable = day
    state.candidate = null
    state.since = null
    // 开局头一分钟只更新基线不播报：载入过渡的白天/黑夜会假翻一次（实测 0:21 报过「天亮了」）。
    if (at < 60) return null
    return {
      type: 'dota.map.daynight',
      text: day ? '天亮了。' : '天黑了。',
      meta: { clock: at, phase: snap.phase },
    }
  }

  /** 设置组 timings.*：逐条覆盖默认时刻（秒，0=关）。缺了就用源码默认表，合法性 prompts.tick 里验。 */
  timingsConfig() {
    const timings = this.cfg?.timings
    return timings && typeof timings === 'object' ? timings : null
  }

  /** 设置组 mode.force：auto（默认，走推断）/ regular / turbo（手动指定，Coo 也能用 dota_mode 改）。 */
  modeConfig() {
    const mode = this.cfg?.mode
    return mode && typeof mode === 'object' ? mode : null
  }

  /** 把设置里的手动模式同步进推断器（幂等，每帧调都安全）。 */
  applyModeConfig() {
    this.mode.setForced(this.modeConfig()?.force ?? null)
  }

  lineupEvent(snap, clockSec) {
    const tracker = this.tracker
    const selfTeam = tracker.selfTeam ?? (snap.player?.team === 'dire' ? 'dire' : 'radiant')
    const teamLabel = selfTeam === 'radiant' ? '天辉' : '夜魇'
    const selfKey = tracker.selfKey ?? snap.hero?.key
    // 名单封顶：敌方最多 5、己方除你之外最多 4——多出来的是选人幻影（2026-11-22 加速局出过 7 个）。
    const selfShort = selfKey ? heroName(selfKey, this.names, this.rawKeys) ?? tracker.self()?.short : null
    const allies = tracker
      .teamRoster(selfTeam, 5)
      .filter((hero) => hero.key !== tracker.selfKey)
      .map((hero) => heroName(hero.key, this.names, this.rawKeys) ?? hero.short)
    const enemies = tracker
      .enemyRoster()
      .map((hero) => heroName(hero.key, this.names, this.rawKeys) ?? hero.short)
    const parts = [`[刀塔 ${clock(clockSec)}] 双方阵容就位。`]
    if (selfShort) parts.push(`你=${selfShort}（${teamLabel}），`)
    if (allies.length > 0) parts.push(`队友 ${allies.join('/')}。`)
    if (enemies.length > 0) parts.push(`敌方 ${enemies.join('/')}。`)
    return { type: 'dota.match.lineup', text: parts.join(''), meta: { clock: clockSec, phase: snap.phase } }
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
      // 裸字符串这类畸形事件不入库（2026-11-22 金丝雀实锤过 flush 的裸字符串）：
      // 库里只收对象，dota_events 工具才不会念出 undefined。
      if (!event || typeof event !== 'object') continue
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
    this.cardCache = renderMatchCard(this.snapshot, {
      names: this.names,
      rawKeys: this.rawKeys,
      mode: this.mode.mode,
      modeBasis: this.mode.basis,
      roshan: { ...this.fights.roshan, now: this.snapshot.clock },
    })
    this.cardAt = at
    return this.cardCache
  }

  /** dota_minimap 的回执：位置库现读，只报区域和时长，不报坐标（PLAN 15.6）。 */
  minimapReceipt() {
    const connection = this.connection()
    if (connection.state === 'none') return '[ok] 还没有收到 Dota 2 的数据，谈不上视野。'
    const snap = this.snapshot
    if (!snap || !snap.inMatch || snap.clock === null) {
      return '[ok] 没有对局，没有视野可读。'
    }
    const tracker = this.tracker
    if (tracker.heroes.size === 0 || tracker.selfTeam === null) {
      return '[ok] 位置库还是空的：这一局刚开始还没带 minimap，或者还没认出队伍。稍等几秒再试。'
    }
    const show = (key) => heroName(key, this.names, this.rawKeys) ?? key
    const clockSec = snap.clock
    const self = tracker.self()
    const enemyTeam = tracker.enemyTeam()

    const header = [`[ok] [刀塔视野] ${clock(clockSec)}`]
    if (snap.radiant !== null && snap.dire !== null) header.push(`天辉 ${snap.radiant}–${snap.dire} 夜魇`)
    if (snap.day === true) header.push('白天')
    if (snap.day === false) header.push('黑夜')
    if (this.mode.mode === 'turbo') header.push('加速模式（推断）')
    if (this.mode.mode === 'regular') header.push('常规模式（推断）')
    if (snap.paused) header.push('暂停中')
    if (self) {
      const selfShort = show(self.key)
      const region = regionOf(self.x, self.y)
      header.push(`你=${selfShort}${region ? `(${region})` : ''}`)
    }
    const lines = [header.join(' · ')]

    lines.push('己方（实时位置）:')
    for (const hero of tracker.teamRoster(tracker.selfTeam, 5)) {
      if (hero.key === tracker.selfKey) continue
      const age = clockSec - hero.lastSeen
      const label = show(hero.key)
      if (age <= 4) {
        const region = regionOf(hero.x, hero.y)
        lines.push(`  ${label}：${region ?? '位置未知'}`)
      } else {
        // 己方活着就一直在小地图上，不在=阵亡。
        lines.push(`  ${label}：阵亡`)
      }
    }

    lines.push('敌方（最后露头）:')
    const regions = new Map()
    for (const item of tracker.visibleEnemies(clockSec)) {
      const label = show(item.hero.key)
      if (item.visible) {
        const dist = self ? Math.hypot(item.hero.x - self.x, item.hero.y - self.y) : null
        if (dist !== null && dist <= 1400) {
          lines.push(`  ${label}：就在眼前`)
        } else {
          lines.push(`  ${label}：${item.region ?? '位置未知'}`)
          if (item.region) {
            regions.set(item.region, (regions.get(item.region) ?? 0) + 1)
          }
        }
      } else {
        lines.push(`  ${label}：${span(item.age)}前·${item.region ?? '位置未知'}`)
      }
    }
    for (const [region, count] of regions) {
      if (count >= 3) lines.push(`敌方 ${count} 人·${region}`)
    }

    const roster = tracker.enemyRosterCount()
    lines.push(`敌方名单: ${roster}/5 已确认`)

    const roshan = this.fights.roshan
    if (roshan.phase === 'pending') {
      const first = roshan.firstSpawn !== null && roshan.firstSpawn > 0 ? `${clock(roshan.firstSpawn)} 首刷，` : ''
      lines.push(`肉山: ${first}还没出来`)
    } else if (roshan.alive && roshan.estimated) {
      lines.push('肉山: 估计已刷新（按时间估，没看到本体）')
    } else if (roshan.alive && roshan.killAt === null) {
      lines.push('肉山: 存活，无击杀记录')
    } else if (roshan.alive) {
      lines.push('肉山: 已刷新')
    } else {
      const remaining = Math.max(0, (roshan.respawnAt ?? clockSec) - clockSec)
      const carrier = roshan.carrierName ? `，盾在 ${roshan.carrierName} 手里` : ''
      lines.push(`肉山: 已死，约 ${span(remaining)}后刷新（估）${carrier}`)
    }

    return lines.join('\n')
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
      aux: {
        matchKey: this.matchKey,
        roster: {
          allies: this.tracker.selfTeam ? this.tracker.heroesOf(this.tracker.selfTeam).length : 0,
          enemies: this.tracker.enemyRosterCount(),
          selfTeam: this.tracker.selfTeam,
        },
        stream: { counts: this.stream.counts, duplicates: this.stream.duplicates, total: this.stream.seen.size },
        idmap: this.idmap.debugInfo(),
        fightWindow: this.fights.window.length,
        roshan: { ...this.fights.roshan },
        buildingDeaths: this.tracker.deadBuildings.size,
        mode: { value: this.mode.mode, basis: this.mode.basis, incomeRate: this.mode.incomeRate },
        prompts: this.prompts.debugInfo(this.mode.mode),
      },
    }
  }

  /** 面板调试视图用的一屏文字：名单、敌我位置、事件流计数、id 校验。 */
  auxDebugText(at = this.now()) {
    const aux = this.debugInfo(at).aux
    const lines = []
    const roster = aux.roster
    lines.push(
      `名单: 你=${this.idmap.selfKey ? heroName(this.idmap.selfKey, this.names, this.rawKeys) ?? this.idmap.selfKey : '未知'}（${roster.selfTeam ?? '?'}） · 队友 ${Math.max(0, roster.allies - 1)} · 敌方 ${roster.enemies}/5`,
    )
    const clockSec = this.snapshot?.clock
    if (clockSec !== null && clockSec !== undefined && this.tracker.selfTeam) {
      const allies = this.tracker
        .heroesOf(this.tracker.selfTeam)
        .filter((hero) => hero.key !== this.tracker.selfKey)
        .map((hero) => `${heroName(hero.key, this.names, this.rawKeys) ?? hero.short}${clockSec - hero.lastSeen <= 4 ? '' : '(阵亡)'}`)
      const enemies = this.tracker
        .visibleEnemies(clockSec)
        .map((item) => `${heroName(item.hero.key, this.names, this.rawKeys) ?? item.hero.short} ${item.visible ? '可见' : `${Math.round(item.age)}秒前`}`)
      lines.push(`己方: ${allies.join(' · ') || '—'}`)
      lines.push(`敌方: ${enemies.join(' · ') || '—'}`)
    }
    const streamBits = Object.entries(aux.stream.counts)
      .map(([kind, count]) => `${kind}×${count}`)
      .join(' ')
    lines.push(`事件流: ${streamBits || '无'} · 去重 ${aux.stream.duplicates}`)
    lines.push(
      `id 映射: selfId=${aux.idmap.selfId ?? '?'} 绑定 ${aux.idmap.bound} · 自亡 ${aux.idmap.selfDeathsSeen} 对不上 ${aux.idmap.selfIdMismatches}`,
    )
    lines.push(
      `提醒: ${this.mode.debugText()} · 中单样本 ${aux.prompts.samples.mid}/${aux.prompts.samples.total}（判中单=${aux.prompts.isMid ? '是' : '否'}） · 已发 ${aux.prompts.fired.length ? aux.prompts.fired.join(',') : '无'}`,
    )
    const roshanPhase = aux.roshan.phase === 'pending' ? '未出' : aux.roshan.alive ? (aux.roshan.estimated ? '估计已刷' : '存活') : '已死'
    lines.push(`团战窗口: ${aux.fightWindow} 杀 · 建筑死亡 ${aux.buildingDeaths} · 肉山 ${roshanPhase}`)
    return lines.join('\n')
  }
}
