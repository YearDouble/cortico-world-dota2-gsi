/**
 * 对局模式推断：常规 / Turbo。
 *
 * **GSI 不发游戏模式**——2026-11-15 真机 4337 帧实证，map 段只有 name / matchid /
 * game_time / clock_time / daytime / nightstalker_night / 比分 / game_state / paused /
 * win_team / customgamename，没有 game_mode，也没有 turbo 字样。所以只能从玩法数据反推：
 *
 * 1. 被动金钱（`player.gold_from_income`）：常规局实测 **3.0 金/秒**（300 秒 898 金，线性）。
 *    Turbo 的金钱和英雄经验翻倍，若被动也在内就是 ≈6/秒。取 4.5 做分界，30 秒起就能判。
 * 2. 补刀单价（year 2026-11-22 提议）：`gold_from_creep_kills / last_hits`——常规一刀约
 *    40 金，Turbo 兵线金钱翻倍约 80。这个比例**不吃补刀数多少**（谁打都一样），出兵一两条
 *    线（≥5 刀）就能量，是被动金钱不翻倍时的兜底信号。
 * 3. 英雄等级（弱信号，兜底）：Turbo 经验翻倍，4 分钟后常规 ≤5 级、Turbo ≥7 级。
 * 4. 肉山本体 20:00 前出现在小地图 → 一定是 Turbo（fights 回填；最强信号但偏晚）。
 *
 * 判不出来就按常规走：普通局是多数，而且提醒文案是通用的（「莲花熟了，去拿」），
 * 晚一点不会说错话；一旦判出 Turbo 立刻换表。Turbo 信号可以推翻已判的常规——
 * 万一哪天 Turbo 的被动金钱不翻倍，先判成常规的还能被补刀单价救回来。
 */
const TURBO_GAME_MODE = 23
const INCOME_MIN_CLOCK = 30
const TURBO_INCOME_RATE = 4.5
const REGULAR_INCOME_RATE = 3.8
/** 补刀单价分界（金/刀）：常规兵线一刀 ~40，Turbo ~80，中间带不硬判。 */
const CREEP_MIN_LAST_HITS = 5
const TURBO_CREEP_BOUNTY = 70
const REGULAR_CREEP_BOUNTY = 50
const LEVEL_MIN_CLOCK = 240
const TURBO_LEVEL = 8
const REGULAR_LEVEL = 5

export class ModeInference {
  constructor() {
    this.reset()
  }

  reset() {
    /** unknown | regular | turbo */
    this.mode = 'unknown'
    /** 判定依据：game_mode / income / creep / level / roshan，面板上看。 */
    this.basis = null
    /** 实测被动金钱速率（金/秒），面板核对用。 */
    this.incomeRate = null
    /** 实测补刀单价（金/刀），面板核对用。 */
    this.creepBounty = null
  }

  /** 强信号：看到 Turbo 特征就直接改判（模式一局不变，但弱信号可能先误判成常规）。 */
  noteTurbo(basis = 'manual') {
    this.mode = 'turbo'
    this.basis = basis
  }

  /** 每帧喂一次。返回当前判断（unknown 也让调用方决定怎么兜底）。 */
  observe(snap, clock) {
    // 万一将来 GSI 补了 game_mode，这一条优先。
    const explicit = snap?.gameModeNum
    if (explicit === TURBO_GAME_MODE) {
      this.noteTurbo('game_mode')
      return this.mode
    }
    if (Number.isFinite(explicit) && explicit > 0) {
      this.mode = 'regular'
      this.basis = 'game_mode'
      return this.mode
    }

    if (this.mode === 'turbo') return this.mode

    if (Number.isFinite(clock) && clock >= INCOME_MIN_CLOCK) {
      const income = snap?.player?.goldFromIncome
      if (Number.isFinite(income) && income > 0) {
        const rate = Math.round((income / clock) * 100) / 100
        this.incomeRate = rate
        if (rate >= TURBO_INCOME_RATE) {
          this.noteTurbo('income')
          return this.mode
        }
        if (rate <= REGULAR_INCOME_RATE && this.mode === 'unknown') {
          this.mode = 'regular'
          this.basis = 'income'
        }
      }
    }

    // 补刀单价：不吃补刀数（分母就是刀数），出兵一两条线就能量；
    // Turbo 判定可以推翻前面误判的常规（被动金钱没翻倍的情形）。
    const lastHits = snap?.player?.lastHits
    const creepGold = snap?.player?.goldFromCreepKills
    if (Number.isFinite(lastHits) && lastHits >= CREEP_MIN_LAST_HITS && Number.isFinite(creepGold) && creepGold > 0) {
      const bounty = Math.round((creepGold / lastHits) * 10) / 10
      this.creepBounty = bounty
      if (bounty >= TURBO_CREEP_BOUNTY) {
        this.noteTurbo('creep')
        return this.mode
      }
      if (bounty <= REGULAR_CREEP_BOUNTY && this.mode === 'unknown') {
        this.mode = 'regular'
        this.basis = 'creep'
      }
    }

    // 弱信号：只在还没定论时用，且不覆盖已有的判定。
    if (this.mode === 'unknown' && Number.isFinite(clock) && clock >= LEVEL_MIN_CLOCK) {
      const level = snap?.hero?.level
      if (Number.isFinite(level)) {
        if (level >= TURBO_LEVEL) {
          this.noteTurbo('level')
        } else if (level <= REGULAR_LEVEL) {
          this.mode = 'regular'
          this.basis = 'level'
        }
      }
    }
    return this.mode
  }

  get isTurbo() {
    return this.mode === 'turbo'
  }

  debugText() {
    const rate = this.incomeRate === null ? '?' : `${this.incomeRate} 金/秒`
    const bounty = this.creepBounty === null ? '?' : `${this.creepBounty} 金/刀`
    const label = this.mode === 'turbo' ? '加速' : this.mode === 'regular' ? '常规' : '判断中'
    return `模式 ${label}${this.basis ? `（${this.basis}）` : ''} · 被动金钱 ${rate} · 补刀单价 ${bounty}`
  }
}
