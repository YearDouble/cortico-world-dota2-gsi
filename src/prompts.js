/**
 * 固定时刻的「去抢」提醒：莲花、圣水符、经验符文（year 2026-11-15 提出）。
 *
 * 实测依据：符文和莲花果实在 minimap 报文里没有实体（4300 帧归档零命中），所以是纯时刻提醒；
 * 莲花池本身常驻报文（两个实例共用 unitname、按位置区分），现读现算哪朵离你近，版本挪池自动跟上。
 *
 * 时间维护（D21，year 定的两段式）：源码放常规/Turbo 两套默认值，设置组 timings.* 可逐条覆盖
 * （单位秒，0=关掉这条），改完下一局生效；Dota 版本改了机制，先改设置救急，默认值随版本跟进。
 */
import { clock } from './util.js'
import { regionOf } from './minimap.js'

/**
 * 提前量：从线上走到河道的时间，再算上模型的响应延迟（year 实测七八秒，2026-11-15 定 30 秒）。
 */
const LEAD = 30

/** 常规局默认时刻（秒）：水符 2:00/4:00、莲花 3:00/6:00、第一颗经验符 7:00（wiki 实锤）。 */
const REGULAR = { water1: 120, water2: 240, lotus1: 180, lotus2: 360, wisdom1: 420 }
/**
 * Turbo：莲花间隔实锤降为 90 秒（2023 Turbo 更新），首刷按间隔推 1:30、第二次 3:00；
 * 水符和经验符的 Turbo 数值没查到实锤，先照常规，真机一局就能对出来。
 */
const TURBO = { water1: 120, water2: 240, lotus1: 90, lotus2: 180, wisdom1: 420 }

/** 谁该收到（year 拍板）：莲花中单不发，圣水符只发中单，经验符都发。 */
const AUDIENCE = {
  water: 'midOnly',
  lotus: 'notMid',
  wisdom: 'all',
}

/**
 * 文案池（year 2026-11-15 定调）：不写精确秒数——模型生成和投递都有延迟（七八秒起），
 * 「还有 30 秒」到她嘴里时多半不准；只说「快到了、准备去」。同一类每次措辞不一样，
 * 在源侧轮换，不指望模型自己变着说。
 */
const VARIANTS = {
  water: ['圣水符马上出，河道两朵任选，顺路拿一个。', '圣水符要刷了，路过河道别错过。'],
  lotus: [
    '莲花快熟了，准备去拿，{side}那朵离你近。',
    '下一朵莲花马上就有了，{side}那朵顺路。',
    '河道莲花了，去晚了就被人拿走，{side}那朵最近。',
  ],
  wisdom: ['第一颗经验符文快刷了，看好时间。', '经验符文马上出，这颗经验不少。'],
}

function kindOf(key) {
  return key.replace(/[12]$/, '')
}

function textOf(kind, side, index) {
  const list = VARIANTS[kind]
  return list[index % list.length].replace('{side}', side)
}

/** 中单判定阈值（year 批准 0.5）；样本太少宁可当非中单。 */
const MID_THRESHOLD = 0.5
const MIN_SAMPLES = 20

export class PromptEngine {
  constructor() {
    this.reset()
  }

  reset() {
    this.fired = new Set()
    /** 中单判定样本：出兵起持续数自机所在区域。 */
    this.samples = { mid: 0, total: 0 }
    /** 每类文案轮换计数：同一场里莲花两次、水符两次说得不一样。 */
    this.rotate = { water: 0, lotus: 0, wisdom: 0 }
  }

  isMid() {
    if (this.samples.total < MIN_SAMPLES) return false
    return this.samples.mid / this.samples.total >= MID_THRESHOLD
  }

  /** 莲花池哪朵离你近，报「上路/下路那朵」；池子没见过或不在路上就说河道。 */
  lotusSide(tracker, self) {
    const pools = tracker?.pools ?? []
    if (!self || pools.length === 0) return '河道'
    let nearest = null
    let best = Infinity
    for (const pool of pools) {
      const dist = Math.hypot(pool.x - self.x, pool.y - self.y)
      if (dist < best) {
        best = dist
        nearest = pool
      }
    }
    const region = nearest ? regionOf(nearest.x, nearest.y) : null
    return region === '上路' || region === '下路' ? region : '河道'
  }

  /**
   * 每帧调用。mode 是 mode.js 推断出来的对局模式（unknown 按常规兜底——常规是多数，
   * 文案又是通用的，晚一点不会说错话；判出 Turbo 就换表）。
   * cfgTimings 是设置覆盖（缺=用默认表）。
   */
  tick({ clock: now, snap, tracker, cfgTimings = null, mode = 'unknown' }) {
    const events = []
    if (now === null || now === undefined || now <= 0) return events
    if (snap?.phase !== 'playing' && snap?.phase !== 'pregame') return events

    const table = mode === 'turbo' ? TURBO : REGULAR

    // 中单样本：对局时间内持续采集，便宜且稳。
    const self = tracker?.self()
    if (self) {
      const region = regionOf(self.x, self.y)
      if (region) {
        this.samples.total += 1
        if (region === '中路') this.samples.mid += 1
      }
    }

    for (const [key, at] of Object.entries(table)) {
      if (this.fired.has(key)) continue
      const override = cfgTimings?.[key]
      const when = Number.isFinite(override) ? Number(override) : at
      if (!Number.isFinite(when) || when <= 0) continue // 0=关掉这条
      if (now < when - LEAD) continue
      // 先记「时机已过」，再按对象筛：中单没收到莲花提醒也不该在后面补发。
      this.fired.add(key)
      const kind = kindOf(key)
      const audience = AUDIENCE[kind]
      const isMid = this.isMid()
      if (audience === 'notMid' && isMid) continue
      if (audience === 'midOnly' && !isMid) continue
      const index = this.rotate[kind] ?? 0
      this.rotate[kind] = index + 1
      events.push({
        type: 'dota.map.pickup',
        text: `[刀塔 ${clock(now)}] ${textOf(kind, this.lotusSide(tracker, self), index)}`,
        meta: { clock: now, phase: snap?.phase, kind },
      })
    }
    return events
  }

  debugInfo(mode = 'unknown') {
    return {
      mode,
      samples: this.samples,
      isMid: this.isMid(),
      fired: [...this.fired],
    }
  }
}
