/**
 * 小地图位置库：谁在哪、什么时候最后露头，敌方名单自动发现。
 * 报文=玩家小地图所见（2026-11-15 真机实验实证），所以这里的「消失」就是 miss，「出现」就是露头。
 * 只存位置和时刻，所有结论（区域、消失多久、抱团）由 fights.js 和工具回执来推。
 */
import { num } from './util.js'

/**
 * 肉山坑实测坐标（两个）。
 * 下路坑来自三次肉山击杀时刻的英雄聚类；上路坑来自真机帧里 `npc_dota_roshan` 的实测坐标 (-3182,2382)。
 * 7.33 起肉山在两个坑之间轮换，只认一个坑会把另一半的「进坑」漏掉。
 */
const ROSH_PITS = [
  { x: 2500, y: -2250, r: 900 },
  { x: -3200, y: 2400, r: 900 },
]

/** 路的通道线（世界坐标，端点取自真机塔位）。上路=左边缘+上边缘，下路=下边缘+右边缘。 */
const LANE_SEGMENTS = {
  top: [
    [-6800, -3700, -6800, 5500],
    [-6800, 5500, 4400, 6000],
  ],
  bot: [
    [-4800, -6100, 5600, -5800],
    [6600, -4600, 6600, 5400],
  ],
}

const TEAM_RADIANT = 2
const TEAM_DIRE = 3

/** 敌方建筑常驻报文，但连续这么多帧不见才判死（2Hz ≈ 2 秒），躲开探针崩过那种全空黑窗。 */
const DEATH_FRAMES = 4
/** 一帧里元素少于这个数不算有效帧（全空黑窗不能用来判塔死）。 */
const MIN_SUBSTANTIVE = 8
/** 英雄多久没露头算「现在不在视野里」，回执里说「阵亡/消失」。 */
const FRESH_SECS = 4
/** 距离多远算「就在眼前」。 */
const NEAR_DIST = 1400

const TOWER_RE = /^npc_dota_(goodguys|badguys)_tower(\d)(?:_(top|mid|bot))?$/
const RACK_RE = /^npc_dota_(goodguys|badguys)_(melee|range)_rax_(top|mid|bot)$/

/** minimap 的 team 值 → 天辉/夜魇。2=goodguys、3=badguys，其余（4/5）是中立物件。 */
export function teamOf(minimapTeam) {
  if (minimapTeam === TEAM_RADIANT) return 'radiant'
  if (minimapTeam === TEAM_DIRE) return 'dire'
  return null
}

export function stripHeroKey(unitname) {
  return typeof unitname === 'string' && unitname.startsWith('npc_dota_hero_')
    ? unitname.slice('npc_dota_hero_'.length)
    : unitname
}

/** minimap 建筑单位名 → buildings 段那套键（npc_dota_goodguys_tower1_top → dota_goodguys_tower1_top），好复用现成的中文名表。 */
export function buildingKeyOf(unitname) {
  return typeof unitname === 'string' && unitname.startsWith('npc_') ? unitname.slice(4) : unitname
}

function segDist(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

/** 世界坐标 → 人话区域。顺序就是优先级：坑 > 基地 > 边路 > 中路 > 河道 > 野区。 */
export function regionOf(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  for (const pit of ROSH_PITS) {
    if (Math.abs(x - pit.x) <= pit.r && Math.abs(y - pit.y) <= pit.r) return '肉山坑'
  }
  if (x < -4900 && y < -4300) return '天辉基地'
  if (x > 4800 && y > 3200) return '夜魇基地'
  for (const seg of LANE_SEGMENTS.top) if (segDist(x, y, seg) < 1000) return '上路'
  for (const seg of LANE_SEGMENTS.bot) if (segDist(x, y, seg) < 1000) return '下路'
  if (Math.abs(x - y) < 1100 && x + y > -9000 && x + y < 9000) return '中路'
  if (Math.abs(x + y) < 1100) return '河道'
  return x + y < 0 ? '天辉野区' : '夜魇野区'
}

export function distance(a, b) {
  if (!a || !b) return null
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export class MinimapTracker {
  constructor() {
    this.reset()
  }

  reset() {
    /** unitname → { team, x, y, lastSeen, prevSeen }，英雄只进不出（名单一旦见过就记住）。 */
    this.heroes = new Map()
    /** unitname → { side, tier, lane, missing, deathAt }，还立着的塔和兵营。 */
    this.buildings = new Map()
    /** unitname → 死亡记录 { side, tier, lane, key, at }。粘性：死了不再翻活。 */
    this.deadBuildings = new Map()
    /** 这一帧刚冒头的英雄（消失 ≥20 秒后现身），给 fights 的 nearby 规则用。 */
    this.appearances = []
    /** 莲花池：两个实例共用 unitname，按位置去重（常驻报文，版本挪池自动跟上）。 */
    this.pools = []
    /**
     * 肉山本体最近一次出现在小地图上的时刻（{ clock, x, y }）。
     * 只在「看得到」时更新：没看到不等于死了（坑里没视野），所以 absence 不参与判死。
     */
    this.roshanLastSeen = null
    /** 首个 playing 帧的时钟。幻影清扫的分界线：进游戏后没再露头的都是选人残留。 */
    this.playingStartClock = null
    this.selfKey = null
    this.selfTeam = null
    this.lastClock = null
    this.lastElementCount = 0
  }

  /** 每帧喂一次。snap 是 normalize 过的快照，用来补自己的位置和英雄名。 */
  ingest(payload, clock, snap = null) {
    this.appearances = []
    if (clock === null || clock === undefined) return
    // 选人阶段的时钟可能是正的（2026-11-22 加速 bot 局：选人时 0:24 起）——
    // 幻影清扫不能用「负时钟」当分界，改用「进游戏那一刻」。
    if (this.playingStartClock === null && snap?.phase === 'playing' && Number.isFinite(clock)) {
      this.playingStartClock = clock
    }
    const map = payload?.minimap
    if (!map || typeof map !== 'object') return

    const entries = Object.values(map).filter((item) => item && typeof item === 'object')
    this.lastElementCount = entries.length
    const substantive = entries.length >= MIN_SUBSTANTIVE
    const seenThisFrame = new Set()

    for (const item of entries) {
      const unitname = typeof item.unitname === 'string' ? item.unitname : ''
      const x = num(item.xpos)
      const y = num(item.ypos)
      if (!unitname || x === null || y === null) continue

      if (TOWER_RE.test(unitname) || RACK_RE.test(unitname)) {
        this.trackBuilding(unitname)
        seenThisFrame.add(unitname)
        continue
      }
      if (unitname === 'npc_dota_lotus_pool') {
        if (!this.pools.some((pool) => Math.abs(pool.x - x) < 100 && Math.abs(pool.y - y) < 100)) {
          this.pools.push({ x, y })
        }
        seenThisFrame.add(unitname)
        continue
      }
      if (unitname === 'npc_dota_roshan') {
        // (0,0) 是报文占位（真机归档里出现过），不是真坐标。
        if (!(x === 0 && y === 0)) this.roshanLastSeen = { clock, x, y }
        continue
      }
      if (!unitname.startsWith('npc_dota_hero_')) continue

      const team = teamOf(item.team)
      if (!team) continue
      const self = item.image === 'minimap_herocircle_self'
      if (self) {
        this.selfKey = unitname
        this.selfTeam = team
      }

      const hero = this.heroes.get(unitname)
      if (hero) {
        // 消失 ≥20 秒后重新露头，记一次「现身」事件给 nearby 规则。
        if (hero.lastSeen !== null && clock - hero.lastSeen >= 20) {
          this.appearances.push({ key: unitname, x, y, team, away: clock - hero.lastSeen })
        }
        hero.x = x
        hero.y = y
        hero.lastSeen = clock
        hero.team = team
      } else {
        this.heroes.set(unitname, { key: unitname, short: stripHeroKey(unitname), x, y, lastSeen: clock, team })
      }
      seenThisFrame.add(unitname)
    }

    // 自己的位置兜底：self 圈没进报文（比如阵亡）时用 hero 段的坐标。
    if (snap?.hero && snap.hero.x !== null && this.selfKey) {
      const self = this.heroes.get(this.selfKey)
      if (!self) {
        this.heroes.set(this.selfKey, {
          key: this.selfKey,
          short: stripHeroKey(this.selfKey),
          x: snap.hero.x,
          y: snap.hero.y,
          lastSeen: clock,
          team: this.selfTeam ?? (snap.player?.team === 'dire' ? 'dire' : 'radiant'),
        })
      }
    }

    // 塔和兵营的「缺席计数」：只数有效帧，防黑窗误判。
    for (const [unitname, building] of this.buildings) {
      if (building.deathAt !== null) continue
      if (!substantive) continue
      if (seenThisFrame.has(unitname)) building.missing = 0
      else building.missing += 1
      if (building.missing >= DEATH_FRAMES) {
        building.deathAt = clock
        this.deadBuildings.set(unitname, {
          key: buildingKeyOf(unitname),
          unitname,
          side: building.side,
          tier: building.tier,
          lane: building.lane,
          at: clock,
        })
        // 死了就从「还立着」的表里除名；deadBuildings 粘性，复活不了。
        this.buildings.delete(unitname)
      }
    }

    this.lastClock = clock
  }

  trackBuilding(unitname) {
    if (this.buildings.has(unitname) || this.deadBuildings.has(unitname)) return
    const tower = TOWER_RE.exec(unitname)
    if (tower) {
      this.buildings.set(unitname, {
        side: tower[1] === 'goodguys' ? 'radiant' : 'dire',
        tier: Number(tower[2]),
        lane: tower[3] ?? null,
        missing: 0,
        deathAt: null,
      })
      return
    }
    const rack = RACK_RE.exec(unitname)
    if (rack) {
      this.buildings.set(unitname, {
        side: rack[1] === 'goodguys' ? 'radiant' : 'dire',
        tier: null,
        lane: rack[3],
        melee: rack[2] === 'melee',
        missing: 0,
        deathAt: null,
      })
    }
  }

  self() {
    return this.selfKey ? this.heroes.get(this.selfKey) ?? null : null
  }

  /**
   * 开局清扫幻影（2026-11-15 真机 bot 局发现；2026-11-22 加强）：选人阶段 bot 换英雄、
   * 敌我队色未定，会留下「再也没出现过」的幻影。分界线用「进游戏那一刻的时钟」——
   * 加速局选人时钟是正的（0:24 起），旧的「只清负时钟」扫不到（2026-11-22 加速局敌方
   * 名单出了 7 个）。进游戏后没再露头的都是残留，真人本来就在这帧的报文里。返回扫掉几个。
   */
  sweepPreGamePhantoms(clockSec) {
    let removed = 0
    const cutoff = this.playingStartClock ?? 0
    for (const [unitname, hero] of this.heroes) {
      if (hero.lastSeen < cutoff) {
        this.heroes.delete(unitname)
        removed += 1
      }
    }
    return removed
  }

  /** 队伍名单最多 max 个：多出来的按「最久没露头」当幻影剔掉（一边不可能超过 5 个人）。 */
  teamRoster(team, max) {
    const list = this.heroesOf(team)
    if (list.length <= max) return list
    return [...list].sort((a, b) => b.lastSeen - a.lastSeen).slice(0, max)
  }

  /** 敌方名单（封顶 5 个，最新的优先）。 */
  enemyRoster() {
    const enemy = this.enemyTeam()
    return enemy ? this.teamRoster(enemy, 5) : []
  }

  /** 某个队的英雄名单（按发现顺序）。 */
  heroesOf(team) {
    const out = []
    for (const hero of this.heroes.values()) {
      if (hero.team === team) out.push(hero)
    }
    return out
  }

  enemyTeam() {
    if (this.selfTeam === 'radiant') return 'dire'
    if (this.selfTeam === 'dire') return 'radiant'
    return null
  }

  /** 敌方名单确认到几个。strategy 阶段就陆续进报文，落线 30 秒内应该齐 5 个。 */
  enemyRosterCount() {
    return this.enemyRoster().length
  }

  rosterComplete() {
    return this.enemyRoster().length >= 5
  }

  /** 敌方当前可见的（lastSeen 在 fresh 窗口内），带区域。 */
  visibleEnemies(clock, freshSecs = FRESH_SECS) {
    const enemy = this.enemyTeam()
    if (!enemy) return []
    const out = []
    for (const hero of this.heroesOf(enemy)) {
      const age = clock - hero.lastSeen
      out.push({
        hero,
        age,
        visible: age <= freshSecs,
        region: regionOf(hero.x, hero.y),
      })
    }
    return out
  }

  /** 这一帧的「现身」列表（消失 ≥20 秒后重新露头的敌人）。 */
  takeAppearances() {
    const out = this.appearances
    this.appearances = []
    return out
  }

  /** 最近 deadAfter 窗口内死掉的敌方建筑（己方的走 buildings 段血量 diff，这里只管敌方的）。 */
  takeBuildingDeaths(selfTeam) {
    const out = []
    for (const record of this.deadBuildings.values()) {
      if (record.reported) continue
      if (record.side === selfTeam) {
        record.reported = true
        continue
      }
      record.reported = true
      out.push(record)
    }
    return out
  }

  /** 回执用：全部建筑死亡记录（含己方，调试看）。 */
  allBuildingDeaths() {
    return [...this.deadBuildings.values()]
  }
}
