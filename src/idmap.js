/**
 * chat playerid ↔ 英雄名字的映射（DECISIONS D16）。
 *
 * 规则来自 2026-11-15 真机实验：
 * - chat playerid = 队内序号：天辉 0-4（两局交叉验证），夜魇推测 = team_slot+5，实现时顺手验
 * - 自己的 id 从 player.team_slot 直接算；名字从 hero 段直连
 * - 其他人的 id 靠「死亡瞬间从 minimap 消失」关联：受害者这一侧是稳的；
 *   击杀者/助攻的 id 只有在他（她）以前死过、被关联过的情况下才解得出名字，解不出就返回 null，
 *   文案层面降级，不猜。
 */

/** 判定受害者关联时，英雄「最后露头」离击杀时刻允许的偏差（事件 time 和 minimap 帧各有毛刺）。 */
const ASSOC_TOLERANCE = 4

export function teamOfChatId(id) {
  if (id === null || id === undefined || id < 0) return null
  return id <= 4 ? 'radiant' : 'dire'
}

export class IdMap {
  constructor() {
    this.reset()
  }

  reset() {
    this.selfId = null
    this.selfTeam = null
    this.selfKey = null
    /** chatId → npc_dota_hero_xxx。一旦绑定不解除（一个 id 一局只有一个人）。 */
    this.byId = new Map()
    /** 自校验计数：自己阵亡时却没有 victimId=selfId 的击杀事件，说明 +5 规则在这个方向不成立。 */
    this.selfIdMismatches = 0
    this.selfDeathsSeen = 0
  }

  /** 每帧喂一次快照，维护自己的 id 和名字。 */
  updateSelf(snap) {
    if (!snap?.player) return
    const team = snap.player.team === 'dire' ? 'dire' : snap.player.team === 'radiant' ? 'radiant' : null
    const slot = snap.player.teamSlot
    if (team && slot !== null) {
      this.selfTeam = team
      // 夜魇侧 +5 是推测（D16），真机验证后更新 DECISIONS。
      this.selfId = team === 'dire' ? slot + 5 : slot
    }
    if (snap.hero?.key && this.selfId !== null) {
      this.selfKey = snap.hero.key
      this.bind(this.selfId, snap.hero.key)
    }
  }

  bind(id, heroKey) {
    if (id === null || id === undefined || id < 0 || !heroKey) return
    const existing = this.byId.get(id)
    if (existing && existing !== heroKey) return
    this.byId.set(id, heroKey)
  }

  /** 击杀事件进来时调用：拿受害者的 id 和时刻，去位置库里找「这一刻消失」的英雄绑定。 */
  associateVictim(kill, tracker) {
    if (!tracker || kill.victimId === null || kill.victimId === undefined) return
    if (this.byId.has(kill.victimId)) return
    const team = teamOfChatId(kill.victimId)
    if (!team) return
    const when = kill.time
    if (when === null || when === undefined) return

    const candidates = []
    for (const hero of tracker.heroesOf(team)) {
      if ([...this.byId.values()].includes(hero.key)) continue
      const age = when - hero.lastSeen
      // 受害者死亡瞬间从 minimap 消失：最后露头在击杀时刻之前一点（击杀之后还露头的肯定是活人）。
      if (age >= 0 && age <= ASSOC_TOLERANCE) candidates.push({ hero, age })
    }
    if (candidates.length === 1) {
      this.bind(kill.victimId, candidates[0].hero.key)
    } else if (candidates.length > 1) {
      // 同一时刻死俩（罕见）：拿最贴近击杀时刻的那个，尽力而为。
      candidates.sort((a, b) => a.age - b.age)
      this.bind(kill.victimId, candidates[0].hero.key)
    }
  }

  /** 自己阵亡时校验 id 规则（夜魇 +5 那条）。面板调试里看计数。 */
  noteSelfDeath() {
    this.selfDeathsSeen += 1
  }

  name(id) {
    if (id === null || id === undefined) return null
    return this.byId.get(id) ?? null
  }

  debugInfo() {
    return {
      selfId: this.selfId,
      selfTeam: this.selfTeam,
      selfKey: this.selfKey,
      bound: this.byId.size,
      selfIdMismatches: this.selfIdMismatches,
      selfDeathsSeen: this.selfDeathsSeen,
    }
  }
}
