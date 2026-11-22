/**
 * 对局模式推断：常规 / Turbo。
 *
 * **GSI 不发游戏模式**——2026-11-15 真机 4337 帧实证，map 段没有 game_mode，也没有 turbo 字样。
 * 只能从玩法数据反推。2026-11-22 真机校准（加速 bot 局）后定稿的证据表：
 *
 * **Turbo 证据（任一命中就改判，可推翻先前误判的常规）**
 * 1. `map.game_mode`（万一将来 GSI 补了）——23=Turbo。
 * 2. 肉山本体 20:00 前露头（fights 回填；最强但偏晚）。
 * 3. **XPM ≥ 1000**（clock ≥ 3:00）：加速局实测 1494–2256，常规局实测 381–613，隔着一条鸿沟。
 *    这是主信号，约 2–3 分钟就能判出来。
 * 4. 补刀单价 ≥ 70 金/刀（`gold_from_creep_kills / last_hits`）：加速兵线金钱翻倍时才命中，
 *    实测加速局约 40——这条是给「哪天加速改了经济」留的备份，平时不指望。
 * 5. 被动金钱 ≥ 4.5 金/秒：同上，实测加速和常规都是 3.0 金/秒，**这条现在永远不该命中**。
 * 6. 等级 ≥ 8（clock ≥ 4:00）：弱信号。
 *
 * **常规证据（只在还没定论时用；之后仍可被上面的 Turbo 证据推翻）**
 * - XPM ≤ 600（clock ≥ 7:00）：常规局实测 613@10 分。太早不用——低分段/劣势局会和加速局重叠。
 *
 * 判不出来就按常规表走（兜底），但**卡片上不标「常规模式」**——只有真的判出来才标，
 * 判错了比不标更糟（2026-11-22 Coo 反馈：加速局被标成常规）。
 */
const TURBO_GAME_MODE = 23
const XPM_MIN_CLOCK = 180
const TURBO_XPM = 1000
const REGULAR_XPM = 600
const REGULAR_XPM_CLOCK = 420
/** 被动金钱（金/秒）与补刀单价（金/刀）：实测加速=常规（3.0 与 ~41），只保留 Turbo 方向的阈值当备份。 */
const INCOME_MIN_CLOCK = 30
const TURBO_INCOME_RATE = 4.5
const CREEP_MIN_LAST_HITS = 5
const TURBO_CREEP_BOUNTY = 70
const LEVEL_MIN_CLOCK = 240
const TURBO_LEVEL = 8

export class ModeInference {
  constructor() {
    this.reset()
  }

  reset() {
    /** unknown | regular | turbo */
    this.mode = 'unknown'
    /** 判定依据：game_mode / xpm / creep / income / level / roshan，面板上看。 */
    this.basis = null
    /** 实测值，面板核对用。 */
    this.xpm = null
    this.incomeRate = null
    this.creepBounty = null
  }

  /** 强信号：看到 Turbo 特征就直接改判（可推翻先前误判的常规；模式一局不变，改判只在纠错）。 */
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

    // 主信号：XPM。加速局 2-3 分钟就上 1000，常规局十分钟都在 600 上下。
    if (Number.isFinite(clock) && clock >= XPM_MIN_CLOCK) {
      const xpm = snap?.player?.xpm
      if (Number.isFinite(xpm) && xpm > 0) {
        this.xpm = xpm
        if (xpm >= TURBO_XPM) {
          this.noteTurbo('xpm')
          return this.mode
        }
        if (xpm <= REGULAR_XPM && clock >= REGULAR_XPM_CLOCK && this.mode === 'unknown') {
          this.mode = 'regular'
          this.basis = 'xpm'
        }
      }
    }

    // 备份信号：只保留 Turbo 方向，不再用它们判常规（实测加速和常规没差别，判了就是错的）。
    if (Number.isFinite(clock) && clock >= INCOME_MIN_CLOCK) {
      const income = snap?.player?.goldFromIncome
      if (Number.isFinite(income) && income > 0) {
        const rate = Math.round((income / clock) * 100) / 100
        this.incomeRate = rate
        if (rate >= TURBO_INCOME_RATE) {
          this.noteTurbo('income')
          return this.mode
        }
      }
    }
    const lastHits = snap?.player?.lastHits
    const creepGold = snap?.player?.goldFromCreepKills
    if (Number.isFinite(lastHits) && lastHits >= CREEP_MIN_LAST_HITS && Number.isFinite(creepGold) && creepGold > 0) {
      const bounty = Math.round((creepGold / lastHits) * 10) / 10
      this.creepBounty = bounty
      if (bounty >= TURBO_CREEP_BOUNTY) {
        this.noteTurbo('creep')
        return this.mode
      }
    }
    if (this.mode === 'unknown' && Number.isFinite(clock) && clock >= LEVEL_MIN_CLOCK) {
      const level = snap?.hero?.level
      if (Number.isFinite(level) && level >= TURBO_LEVEL) {
        this.noteTurbo('level')
      }
    }
    return this.mode
  }

  get isTurbo() {
    return this.mode === 'turbo'
  }

  debugText() {
    // 不带「模式」两个字：状态灯和调试行都会自己加前缀，别重复。
    const xpm = this.xpm === null ? '?' : `${this.xpm}`
    const rate = this.incomeRate === null ? '?' : `${this.incomeRate} 金/秒`
    const bounty = this.creepBounty === null ? '?' : `${this.creepBounty} 金/刀`
    const label = this.mode === 'turbo' ? '加速' : this.mode === 'regular' ? '常规' : '判断中'
    return `${label}${this.basis ? `（${this.basis}）` : ''} · XPM ${xpm} · 被动金钱 ${rate} · 补刀单价 ${bounty}`
  }
}
