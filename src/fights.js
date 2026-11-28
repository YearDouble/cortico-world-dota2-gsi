/**
 * 团战检测收口 + intel 四规则 + 肉山状态机 + 敌方建筑播报。
 * 全部是位置库和事件流水上的本地推算（D18）：只推预写规则命中的文字结论，位置原始数据永不出门。
 *
 * 所有时刻都用 clock 基准（map.clock_time，出兵前为负），和 minimap、事件 time 字段同一条时间轴，
 * 暂停时不走表，回放帧也是确定的。
 */
import { clock, span } from './util.js'
import { heroName } from './names.js'
import { regionOf, distance, teamOf } from './minimap.js'

/** 击杀间隔 ≤20 秒算同一场团战。 */
const FIGHT_GAP = 20
/** ≥2 杀才算团战，单杀走原有的击杀事件。 */
const FIGHT_MIN_KILLS = 2
/** 连续 15 秒无新击杀就收口。 */
const FIGHT_QUIET = 15
/** 每条 intel 规则独立冷却 30 秒。 */
const INTEL_COOLDOWN = 30
/** 敌方全员消失 ≥10 秒。 */
const MISS_ALL_SECS = 10
/** 敌方 ≥3 人同区域 ≥10 秒。 */
const GROUP_MIN = 3
const GROUP_SECS = 10
/** 消失 ≥20 秒的敌人重新露头。 */
const NEARBY_ABSENT = 20
/** 露头位置离你这么近算「绕后」。 */
const NEARBY_DIST = 1400
/** 敌方 ≥2 人在肉山坑且肉山存活。 */
const ROSH_THREAT_MIN = 2
/**
 * 肉山时刻（7.42，来源=知识库「时间点速查」2026-11-22）：
 * 20:00 首刷；复活基础 11 分钟，每次被打败减 1 分钟，最低 5 分钟。
 * Turbo 首刷比常规早（真机归档里 3:11 已在小地图上看到本体），按 0:00 起算。
 * 两个数都能在设置组 timings.* 里救急改（D21 的两段式维护）。
 */
export const ROSH_FIRST_SPAWN = { regular: 1200, turbo: 0 }
const ROSH_RESPAWN_BASE = 660
const ROSH_RESPAWN_STEP = 60
const ROSH_RESPAWN_MIN = 300
/** 击杀肉山后等几秒拿盾的归属，再发事件。 */
const ROSH_WAIT_AEGIS = 8
/** TOWER_KILL 兜底配对窗口（秒）。 */
const TOWER_MATCH_SECS = 8
/** 位置库认识这座塔（小地图见过）时多等这么久：2026-11-25 实测塔倒后小地图还画 ~11 秒，
 *  位置库判死比 TOWER_KILL 晚 ~14 秒，旧窗口 10 秒让每座敌塔都重复报一次。 */
const TOWER_MATCH_WAIT_LONG = 25

const TEAM_LABEL = { radiant: '天辉', dire: '夜魇' }

function stamp(clockSec) {
  const text = clock(clockSec)
  return text === null ? '[刀塔]' : `[刀塔 ${text}]`
}

function joinZh(names) {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join('、')} 和 ${names.at(-1)}`
}

/** 设置覆盖里的整数；空、非数字、超范围都回退默认值。 */
function intOr(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export class FightEngine {
  constructor() {
    this.reset()
  }

  reset() {
    this.window = []
    this.lastKillTime = null
    this.cooldownUntil = { missing_all: null, grouped: null, nearby: null, roshan_threat: null }
    this.groupStreak = null
    this.missingAllArmed = true
    this.roshan = this.freshRoshan()
    this.pendingRoshan = false
    this.reportedDeaths = []
    this.pendingTowerRecords = []
    this.towerRecordSeen = new Set()
  }

  freshRoshan() {
    return {
      alive: false,
      /** pending=首刷前，alive=在场，dead=已死等复活。 */
      phase: 'pending',
      deaths: 0,
      killAt: null,
      killedBy: null,
      respawnAt: null,
      carrierId: null,
      carrierName: null,
      /** 复活是按时间估出来的（没看到本体），卡片和回执上要标出来。 */
      estimated: false,
      /** 小地图上最后一次看到本体的时刻（clock 基准）。 */
      seenAt: null,
      firstSpawn: null,
    }
  }

  /** 首刷门槛：没到点之前肉山不在场，「进坑」也不该当作打盾。 */
  tickRoshanSpawn(now, mode, cfgTimings) {
    const r = this.roshan
    const fallbackFirst = mode === 'turbo' ? ROSH_FIRST_SPAWN.turbo : ROSH_FIRST_SPAWN.regular
    const first = intOr(cfgTimings?.roshanFirst, fallbackFirst)
    r.firstSpawn = Math.max(0, first)
    if (r.phase === 'pending' && now >= r.firstSpawn) {
      r.alive = true
      r.phase = 'alive'
    }
  }

  /**
   * 小地图看到肉山本体 → 直接信眼睛。
   * 视野是门控的：看不到不代表死了，所以只处理「看到了」。
   * 击杀那一帧可能还带着旧画面，只有露头时刻晚于击杀时刻才算复活。
   */
  noteRoshanSighting(seen, push, now) {
    const r = this.roshan
    if (!seen || seen.clock === null || seen.clock === undefined) return
    if (r.seenAt !== null && seen.clock <= r.seenAt) return
    if (r.phase === 'dead' && r.killAt !== null && seen.clock <= r.killAt) return
    r.seenAt = seen.clock
    if (r.phase === 'dead') {
      this.reviveRoshan(false)
      push('dota.map.roshan', `${stamp(now)} 肉山刷新了。`)
    } else if (r.phase === 'pending') {
      r.alive = true
      r.phase = 'alive'
    } else if (r.estimated) {
      // 之前是按时间估的，现在看到本体了，把「估」字去掉，不再发一条。
      r.estimated = false
    }
  }

  reviveRoshan(estimated) {
    const r = this.roshan
    r.alive = true
    r.phase = 'alive'
    r.estimated = estimated === true
    r.respawnAt = null
    r.killedBy = null
    r.carrierId = null
    r.carrierName = null
    // killAt 保留：卡片用它区分「首刷后一直活着」和「被打死过又刷了」。
  }

  cooled(rule, clockSec) {
    const until = this.cooldownUntil[rule]
    return until === null || clockSec >= until
  }

  arm(rule, clockSec) {
    this.cooldownUntil[rule] = clockSec + INTEL_COOLDOWN
  }

  /**
   * 每帧调用。records 是收集器这一帧吐出的新记录，tracker 是位置库。
   * 返回这一帧要投递的事件。
   */
  update({
    clock: now,
    snap,
    records,
    tracker,
    idmap,
    names = null,
    rawKeys = false,
    mode = 'regular',
    cfgTimings = null,
  }) {
    const events = []
    const push = (type, text) => events.push({ type, text, meta: { clock: now, phase: snap?.phase } })
    const selfTeam = tracker.selfTeam ?? (snap?.player?.team === 'dire' ? 'dire' : 'radiant')
    const showName = (key) => heroName(key, names, rawKeys) ?? key

    if (now === null || now === undefined) return events

    // 首刷：20:00（Turbo 起手就在），没到点之前肉山不在场。
    this.tickRoshanSpawn(now, mode, cfgTimings)

    for (const record of records) {
      if (record.kind === 'kill') {
        idmap?.associateVictim(record, tracker)
        this.admitKill(record, now)
        if (record.fb && record.killerId !== null && record.killerId === idmap?.selfId) {
          // 一血归属也要过 kill_list 的地面真值：报错了她会在队友面前说错话。
          if (this.selfKillConfirmed(record.victimId, snap)) {
            push('dota.player.killed', `${stamp(now)} 你拿了一血。`)
          }
        }
      } else if (record.kind === 'buyback') {
        if (idmap && record.playerId === idmap.selfId) {
          const gold = snap?.player?.gold
          push('dota.player.buyback', `${stamp(now)} 你买活了${gold !== null && gold !== undefined ? `，剩 ${gold} 金` : ''}。`)
        }
      } else if (record.kind === 'roshanKilled') {
        this.onRoshanKilled(record, now, cfgTimings)
      } else if (record.kind === 'aegis') {
        if (this.roshan.phase === 'dead') {
          this.roshan.carrierId = record.playerId
        }
      } else if (record.kind === 'towerKill') {
        // 己方塔（拆塔方是敌人）由 buildings 段血量直接播报（一对一、带路别），兜底只会重复。
        if (record.killerTeam !== null && record.killerTeam !== selfTeam) continue
        if (!this.towerRecordSeen.has(record.key)) {
          this.towerRecordSeen.add(record.key)
          this.pendingTowerRecords.push(record)
        }
      }
    }

    // 小地图上看到本体：比任何估算都准（复活、首刷都认眼睛）。
    this.noteRoshanSighting(tracker.roshanLastSeen, push, now)

    // 敌方建筑：位置库的死亡记录是主信号（带路别），TOWER_KILL 兜底补漏。
    for (const death of tracker.takeBuildingDeaths(selfTeam)) {
      this.reportedDeaths.push(death)
      push('dota.map.building', `${stamp(now)} ${death.text ?? this.buildingText(death)}`)
    }
    this.flushTowerFallbacks(push, now, tracker)

    // 肉山状态机。
    this.tickRoshan(push, now, idmap, showName)

    // intel 四规则。
    this.checkMissingAll(push, now, tracker, snap)
    this.checkGrouped(push, now, tracker, snap)
    this.checkNearby(push, now, tracker, idmap, showName)
    this.checkRoshanThreat(push, now, tracker, snap)

    // 团战收口。
    if (this.window.length >= FIGHT_MIN_KILLS && this.lastKillTime !== null && now - this.lastKillTime >= FIGHT_QUIET) {
      this.emitFight(push, now, idmap, showName, selfTeam, snap)
    }

    return events
  }

  /**
   * 「你击杀了 X」的地面真值：GSI player.kill_list（victimid_<id> → 次数）。
   * kill_list 没到（字段缺失）就不拦，到了但对不上就拦——宁可少说一句，不说错的。
   * （2026-11-22 Coo 反馈：「你击杀了混沌骑士」年说没动过手，id 映射的归属不可全信。）
   */
  selfKillConfirmed(victimId, snap) {
    const killList = snap?.player?.killList
    if (!killList) return true
    const count = killList[victimId]
    return Number.isFinite(count) && count >= 1
  }

  admitKill(record, now) {
    // 一血会同时发 FIRSTBLOOD 和 HERO_KILL 两条记录（同一次死亡，实测实锤）。
    // 同一个受害者 2 秒内的第二条不算新死亡，只把一血标记带过去。
    const twin = this.window.find(
      (kill) => kill.victimId === record.victimId && Math.abs((kill.time ?? 0) - (record.time ?? 0)) < 2,
    )
    if (twin) {
      if (record.fb) twin.fb = true
      return
    }
    const gap = this.lastKillTime === null ? Infinity : record.time - this.lastKillTime
    if (this.window.length > 0 && gap > FIGHT_GAP) this.window = []
    this.window.push(record)
    this.lastKillTime = record.time ?? now
  }

  emitFight(push, now, idmap, showName, selfTeam, snap = null) {
    const kills = this.window
    this.window = []
    this.lastKillTime = null
    if (kills.length < FIGHT_MIN_KILLS) return

    const idmapOrNull = idmap
    const selfId = idmapOrNull?.selfId
    const ourDead = []
    const theirDead = []
    for (const kill of kills) {
      const victimTeam = kill.victimId !== null && kill.victimId <= 4 ? 'radiant' : 'dire'
      if (victimTeam === selfTeam) ourDead.push(kill)
      else theirDead.push(kill)
    }

    const selfDied = ourDead.some((kill) => kill.victimId === selfId)
    // 方向写死在句子里（2026-11-22 Coo 反馈：「3 换 0」她读反了）——不说 X 换 Y，说谁倒了。
    const parts = [`团战收口：敌方倒下 ${theirDead.length} 人，我方阵亡 ${ourDead.length} 人${selfDied ? '，你也倒了' : '，你没死'}。`]

    const killList = snap?.player?.killList ?? null
    const selfKills = kills
      .filter((kill) => kill.killerId !== null && kill.killerId === selfId)
      .filter((kill) => this.selfKillConfirmed(kill.victimId, snap))
      .map((kill) => {
        const victimKey = idmapOrNull?.name(kill.victimId)
        return victimKey ? showName(victimKey) : null
      })
      .filter(Boolean)
    if (selfKills.length > 0) parts.push(`你击杀了${glueName(joinZh(selfKills))}。`)

    // 己方阵亡的细节（最多说两个），文案学 CONFIRM 样本：「luna 和 venomancer 助攻围殴你方 drow_ranger」。
    for (const kill of ourDead.slice(0, 2)) {
      const isSelf = kill.victimId === selfId
      const victimKey = idmapOrNull?.name(kill.victimId)
      const victim = isSelf ? '你' : victimKey ? showName(victimKey) : null
      if (!victim) continue
      const killerKey = idmapOrNull?.name(kill.killerId)
      const killer = killerKey ? showName(killerKey) : '敌方'
      const assistNames = (kill.assists ?? [])
        .map((id) => {
          const key = idmapOrNull?.name(id)
          return key ? showName(key) : null
        })
        .filter(Boolean)
      const subject = assistNames.length > 0 ? joinZh([killer, ...assistNames]) : killer
      parts.push(`${subject}围殴${isSelf ? '你' : `你方${glueName(victim)}`}。`)
    }

    push('dota.fight.ended', `${stamp(now)} ${parts.join('')}`)
  }

  buildingText(death) {
    const side = TEAM_LABEL[death.side] ?? ''
    if (death.tier === null) {
      const melee = death.melee === true ? '近战' : '远程'
      return `${side}${laneLabel(death.lane)}${melee}兵营被摧毁。`
    }
    const tier = death.tier >= 4 ? '基地塔' : death.tier === 3 ? '三塔' : death.tier === 2 ? '二塔' : '一塔'
    return `${side}${laneLabel(death.lane)}${tier}被摧毁。`
  }

  flushTowerFallbacks(push, now, tracker = null) {
    if (this.pendingTowerRecords.length === 0) return
    const still = []
    for (const record of this.pendingTowerRecords) {
      const fallenSide = record.killerTeam === 'radiant' ? 'dire' : 'radiant'
      // 位置库在表里认识这座塔（小地图见过同侧同级的）就多等一会儿——它判死晚 ~14 秒，等它带路别报。
      const known = tracker
        ? [...tracker.buildings.values(), ...tracker.deadBuildings.values()].some(
            (building) => building.tier === record.tier && building.side === fallenSide,
          )
        : false
      const waitSecs = known ? TOWER_MATCH_WAIT_LONG : TOWER_MATCH_SECS
      const matched = this.reportedDeaths.some(
        (death) =>
          death.tier !== null &&
          record.tier !== null &&
          death.tier === record.tier &&
          death.side === fallenSide &&
          record.time !== null &&
          Math.abs((death.at ?? now) - (record.time + 0)) <= Math.max(TOWER_MATCH_WAIT_LONG, TOWER_MATCH_SECS + 2),
      )
      if (matched) continue
      if (record.time === null || now - record.time < waitSecs) {
        still.push(record)
        continue
      }
      // 位置库没看到这次塔倒（罕见），用 TOWER_KILL 的字段兜底：value=击杀方，倒的是对面。
      const fallen = record.killerTeam === 'radiant' ? '夜魇' : '天辉'
      const tier = record.tier >= 4 ? '基地塔' : record.tier === 3 ? '三塔' : record.tier === 2 ? '二塔' : '一塔'
      push('dota.map.building', `${stamp(record.time)} ${fallen}${tier}被摧毁。`)
    }
    this.pendingTowerRecords = still
  }

  onRoshanKilled(record, now, cfgTimings = null) {
    const r = this.roshan
    // 同一次击杀可能来两条记录（原生事件 + 备份路径），已经死了就不重复计数。
    if (r.phase === 'dead') return
    const killAt = record.time ?? now
    r.deaths += 1
    const base = Math.max(ROSH_RESPAWN_MIN, intOr(cfgTimings?.roshanRespawn, ROSH_RESPAWN_BASE))
    const interval = Math.max(ROSH_RESPAWN_MIN, base - (r.deaths - 1) * ROSH_RESPAWN_STEP)
    r.alive = false
    r.phase = 'dead'
    r.killedBy = record.team ?? null
    r.killAt = killAt
    r.respawnAt = killAt + interval
    r.estimated = false
    r.carrierId = null
    r.carrierName = null
    this.pendingRoshan = true
  }

  tickRoshan(push, now, idmap, showName) {
    const r = this.roshan
    if (r.phase !== 'dead') return
    if (r.carrierId !== null && r.carrierName === null) {
      const key = idmap?.name(r.carrierId)
      r.carrierName = key ? showName(key) : null
    }
    if (this.pendingRoshan) {
      const waited = now - r.killAt
      if (r.carrierId !== null || waited >= ROSH_WAIT_AEGIS) {
        this.pendingRoshan = false
        const who = r.killedBy ? TEAM_LABEL[r.killedBy] ?? '' : ''
        const carrier = r.carrierName ? `，盾在 ${r.carrierName} 手里` : ''
        const minutes = Math.max(1, Math.round((r.respawnAt - r.killAt) / 60))
        push(
          'dota.map.roshan',
          `${stamp(now)} 肉山被${glueName(who)}拿了${carrier}；约 ${minutes} 分钟后刷新（估，实际以看到本体为准）。`,
        )
      }
    } else if (r.respawnAt !== null && now >= r.respawnAt) {
      // 没在小地图上看到本体，只能按时间估。措辞必须带「估」，别让这句话被当成事实转告。
      this.reviveRoshan(true)
      push('dota.map.roshan', `${stamp(now)} 肉山应该刷新了（按时间估，没看到本体）。`)
    }
  }

  checkMissingAll(push, now, tracker, snap) {
    if (snap?.phase !== 'playing' || now <= 0) return
    const enemies = tracker.visibleEnemies(now, 1)
    if (enemies.length < 5) return
    const allGone = enemies.every((item) => item.age >= MISS_ALL_SECS)
    if (allGone && this.missingAllArmed && this.cooled('missing_all', now)) {
      this.missingAllArmed = false
      this.arm('missing_all', now)
      push('dota.intel.missing_all', `${stamp(now)} 敌方全员消失，警惕绕后或开盾。`)
    } else if (enemies.some((item) => item.visible)) {
      this.missingAllArmed = true
    }
  }

  checkGrouped(push, now, tracker, snap) {
    if (snap?.phase !== 'playing' || now <= 0) return
    if (!this.cooled('grouped', now)) return
    const visible = tracker.visibleEnemies(now).filter((item) => item.visible && item.region)
    const byRegion = new Map()
    for (const item of visible) {
      const list = byRegion.get(item.region) ?? []
      list.push(item)
      byRegion.set(item.region, list)
    }
    let hit = null
    for (const [region, list] of byRegion) {
      if (list.length >= GROUP_MIN) hit = { region, count: list.length }
    }
    if (!hit) {
      this.groupStreak = null
      return
    }
    if (!this.groupStreak || this.groupStreak.region !== hit.region) {
      this.groupStreak = { region: hit.region, since: now }
      return
    }
    if (now - this.groupStreak.since >= GROUP_SECS) {
      this.arm('grouped', now)
      push('dota.intel.grouped', `${stamp(now)} 敌方 ${hit.count} 人在${hit.region}，抱团了。`)
    }
  }

  checkNearby(push, now, tracker, idmap, showName) {
    const appearances = tracker.takeAppearances()
    if (appearances.length === 0) return
    if (!this.cooled('nearby', now)) return
    const self = tracker.self()
    if (!self) return
    const names = []
    for (const appearance of appearances) {
      if (appearance.team === tracker.selfTeam) continue
      const dist = distance(appearance, self)
      if (dist !== null && dist <= NEARBY_DIST) {
        names.push(`${showName(appearance.key)}（消失了 ${span(Math.max(0, appearance.away ?? 0))}）`)
      }
    }
    if (names.length === 0) return
    this.arm('nearby', now)
    push('dota.intel.nearby', `${stamp(now)} ${joinZh(names)}绕后出现在你附近！`)
  }

  checkRoshanThreat(push, now, tracker, snap) {
    if (snap?.phase !== 'playing' || now <= 0) return
    if (!this.roshan.alive) return
    if (!this.cooled('roshan_threat', now)) return
    const inPit = tracker
      .visibleEnemies(now)
      .filter((item) => item.visible && item.region === '肉山坑')
    if (inPit.length < ROSH_THREAT_MIN) return
    this.arm('roshan_threat', now)
    push('dota.intel.roshan_threat', `${stamp(now)} 敌方 ${inPit.length} 人在肉山坑。`)
  }

  /** 对局收尾时把还开着口的团战窗口收掉。 */
  flush(now, idmap, showName, selfTeam, snap = null) {
    const events = []
    if (this.window.length >= FIGHT_MIN_KILLS) {
      // 注意：emitFight 的 push 是 (type, text) 两个参数——这里必须收齐两个再组对象。
      // 2026-11-22 金丝雀实锤：写成 (event) => events.push(event) 会把裸字符串 'dota.fight.ended'
      // 推进投递数组（字符串没有 type/text，宿主读 text.length 就炸）——这正是 2026-11-15
      // 连崩 30 次那颗毒事件的产生分支，终局收口这一条路。
      this.emitFight(
        (type, text) => events.push({ type, text, meta: { clock: now } }),
        now,
        idmap,
        showName,
        selfTeam,
        snap,
      )
    }
    return events
  }
}

function laneLabel(lane) {
  if (lane === 'top') return '上路'
  if (lane === 'mid') return '中路'
  if (lane === 'bot') return '下路'
  return ''
}

function glueName(name) {
  return /^[A-Za-z0-9_]/.test(name ?? '') ? ` ${name}` : (name ?? '')
}

/** 暴露给回执用的团队换算。 */
export { teamOf, regionOf }
