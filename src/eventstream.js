/**
 * events 段收集器。GSI 的事件是滚动窗口（约 30-40 秒过期），同一事件会在几十帧里反复出现，
 * 所以必须进帧就收、按内容去重，之后才谈得上团战和情报。噪声类型直接丢弃。
 *
 * 字段语义全部来自 2026-11-15 真机实验（约 4300 帧，见 CONFIRM-0.2.md 第 2 节）：
 * - CHAT_MESSAGE_HERO_KILL：p1=受害者、p2=击杀者、p3+=助攻
 * - CHAT_MESSAGE_FIRSTBLOOD：语义相反，p1=击杀者、p2=受害者
 * - CHAT_MESSAGE_TOWER_KILL：value=击杀方队伍（2=天辉/3=夜魇，跟 minimap 的 team 编码一致；
 *   实验里 12 起塔倒与 minimap 消失逐一配对实锤，CONFIRM 原稿写「归属方」是笔误）、
 *   value2=赏金、value3=塔级 1-4、p1=击杀者（-1=兵线）
 * - roshan_killed / aegis_picked_up 是原生事件，player_id 同样按 chat id 解释
 */
import { num } from './util.js'

/** 观察过但不用的事件类型。加进这里是为了在 debug 计数里留个名，不是漏处理。 */
const NOISE = new Set([
  'CHAT_MESSAGE_RANDOM',
  'CHAT_MESSAGE_NO_BATTLE_POINTS',
  'CHAT_MESSAGE_HERO_CHOICE_INVALID',
  'CHAT_MESSAGE_INTHEBAG',
  'CHAT_MESSAGE_NEW_PLAYER_REMINDER',
  'CHAT_MESSAGE_VICTORY_PREDICTION_STREAK',
  'CHAT_MESSAGE_BANNER_PLANTED',
  'CHAT_MESSAGE_SCAN_USED',
  'CHAT_MESSAGE_OBSERVER_WARD_KILLED',
  'CHAT_MESSAGE_SENTRY_WARD_KILLED',
  'CHAT_MESSAGE_DISCONNECT',
  'bounty_rune_pickup',
  'chat_message',
])

function playerIds(inner, from, to) {
  const out = []
  for (let i = from; i <= to; i++) {
    const id = num(inner[`playerid${i}`])
    if (id !== null && id >= 0) out.push(id)
  }
  return out
}

export class EventStream {
  constructor() {
    this.reset()
  }

  reset() {
    /** 去重键。同一事件会在滚动窗口里反复出现几十次，内容原样相同，字符串比对最稳。 */
    this.seen = new Set()
    /** 每类记录收了几条，面板调试用。 */
    this.counts = {}
    this.duplicates = 0
    /** 出装流水（value 是游戏报的成本或 id，不解读，原样留）。收集了但 v1 没有查询入口（D 系备查）。 */
    this.purchases = []
  }

  /**
   * 喂一帧的 events 数组，返回这一帧里新出现的干净记录。
   * offset = 本帧 clock_time - game_time（选人+策略时长，一局内恒定）：原生事件只带
   * game_time，要换到 clock 基准才能和 minimap、事件 time 字段对齐。generic_event
   * 的 time 本来就是 clock 基准，不动。
   */
  ingest(rawEvents, offset = 0) {
    this.offset = Number.isFinite(offset) ? offset : 0
    const out = []
    if (!Array.isArray(rawEvents)) return out
    for (const raw of rawEvents) {
      const record = this.parse(raw)
      if (!record) continue
      if (this.seen.has(record.key)) {
        this.duplicates += 1
        continue
      }
      if (record.time === null && record.gameTime !== null) record.time = record.gameTime + this.offset
      this.seen.add(record.key)
      this.counts[record.kind] = (this.counts[record.kind] ?? 0) + 1
      if (record.kind === 'purchase') {
        this.purchases.push({ time: record.time, playerId: record.playerId, value: record.value })
        if (this.purchases.length > 400) this.purchases.splice(0, this.purchases.length - 400)
      }
      out.push(record)
    }
    return out
  }

  parse(raw) {
    if (!raw || typeof raw !== 'object') return null

    if (raw.event_type === 'generic_event') {
      let inner
      try {
        inner = JSON.parse(raw.data)
      } catch {
        return null
      }
      if (!inner || typeof inner.type !== 'string') return null
      const type = inner.type
      const time = num(inner.time)
      const base = { kind: null, key: `g|${raw.data}`, time, gameTime: num(raw.game_time) }

      switch (type) {
        case 'CHAT_MESSAGE_HERO_KILL':
          return {
            ...base,
            kind: 'kill',
            victimId: num(inner.playerid1),
            killerId: num(inner.playerid2),
            assists: playerIds(inner, 3, 6),
            bounty: num(inner.value),
            fb: false,
          }
        case 'CHAT_MESSAGE_FIRSTBLOOD':
          return {
            ...base,
            kind: 'kill',
            // 一血的字段语义和普通击杀相反（实测实锤）。
            killerId: num(inner.playerid1),
            victimId: num(inner.playerid2),
            assists: [],
            bounty: num(inner.value),
            fb: true,
          }
        case 'CHAT_MESSAGE_ITEM_PURCHASE':
          return { ...base, kind: 'purchase', playerId: num(inner.playerid1), value: num(inner.value) }
        case 'CHAT_MESSAGE_BUYBACK':
          return { ...base, kind: 'buyback', playerId: num(inner.playerid1) }
        case 'CHAT_MESSAGE_TOWER_KILL':
          return {
            ...base,
            kind: 'towerKill',
            killerId: num(inner.playerid1),
            killerTeam: num(inner.value) === 2 ? 'radiant' : num(inner.value) === 3 ? 'dire' : null,
            tier: num(inner.value3),
            bounty: num(inner.value2),
          }
        case 'CHAT_MESSAGE_BARRACKS_KILL':
          return {
            ...base,
            kind: 'barracksKill',
            killerId: num(inner.playerid1),
            killerTeam: num(inner.value) === 2 ? 'radiant' : num(inner.value) === 3 ? 'dire' : null,
            code: num(inner.value3),
          }
        case 'CHAT_MESSAGE_GLYPH_USED':
          return { ...base, kind: 'glyph', playerId: num(inner.playerid1) }
        case 'CHAT_MESSAGE_STREAK_KILL':
          // value2 疑似连杀类型，字段没解透；先只留赏金和人头名单，不阻塞。
          return {
            ...base,
            kind: 'streak',
            bounty: num(inner.value),
            playerIds: playerIds(inner, 1, 6),
          }
        case 'Courier_killed':
          // D20：预留不解析，撞见真样本再写。
          return null
        default:
          if (NOISE.has(type)) return null
          return null
      }
    }

    // 原生事件（非 generic_event）。
    if (raw.event_type === 'roshan_killed') {
      return {
        kind: 'roshanKilled',
        key: `n|roshan|${num(raw.game_time)}|${raw.killed_by_team}|${num(raw.killer_player_id)}`,
        time: null,
        gameTime: num(raw.game_time),
        team: raw.killed_by_team === 'radiant' ? 'radiant' : raw.killed_by_team === 'dire' ? 'dire' : null,
        killerId: num(raw.killer_player_id),
      }
    }
    if (raw.event_type === 'aegis_picked_up') {
      return {
        kind: 'aegis',
        key: `n|aegis|${num(raw.game_time)}|${num(raw.player_id)}`,
        time: null,
        gameTime: num(raw.game_time),
        playerId: num(raw.player_id),
        snatched: raw.snatched === true,
      }
    }
    return null
  }
}
