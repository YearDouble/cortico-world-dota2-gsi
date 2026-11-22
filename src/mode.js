/**
 * 对局模式推断：常规 / Turbo。
 *
 * **GSI 不发游戏模式**——真机实证 map 段没有 game_mode，也没有 turbo 字样。
 * 打钱快慢因人而异（year 2026-11-22 定调：XPM 这类数值不能当判据），所以主信号用**结构性的节奏**：
 *
 * **Turbo 证据（任一命中就改判，可推翻先前误判的常规）**
 * 1. `map.game_mode`（万一将来 GSI 补了）——23=Turbo。
 * 2. 肉山本体 20:00 前露头（fights 回填；最强但偏晚）。
 * 3. **赏金符节奏（year 提议，主信号）**：常规局 4 分钟一波、每波河道两侧各 1 个——
 *    240 秒内最多 2 次拾取；加速局 2 分钟一波，240 秒内能到 4 次。
 *    **240 秒内 ≥3 次、或 480 秒内 ≥5 次拾取 = Turbo**，只看节奏不看金额，谁打都一样。
 *    双方的拾取都在 events 块里（bounty_rune_pickup，真机归档 337 条实锤）。
 * 4. 补刀单价 ≥ 70 金/刀（加速兵线金钱翻倍才命中；实测加速局约 40，平时不指望）。
 * 5. 被动金钱 ≥ 4.5 金/秒（实测加速=常规 3.0，同上，留个备份）。
 *
 * **常规证据（只在还没定论时用；之后仍可被上面的 Turbo 证据推翻）**
 * - XPM ≤ 600（clock ≥ 7:00）：常规局实测 613@10 分。太早不用——劣势局和加速局重叠。
 *   （XPM 不再判 Turbo：打钱快慢因人而异，雪崩局会误判。）
 *
 * 判不出来就按常规表走（兜底），但**卡片上不标「常规模式」**——只有真的判出来才标，
 * 判错了比不标更糟（2026-11-22 Coo 反馈：加速局被标成常规）。
 */
const TURBO_GAME_MODE = 23
/** 赏金符：首波金额（常规实测 ~40，加速若双倍约 80——阈值等一局真机校准）与节奏（常规 240 秒一波、每波 2 个）。 */
const BOUNTY_FIRST_WAVE_END = 90
const REGULAR_FIRST_WAVE_VALUE = 50
const TURBO_FIRST_WAVE_VALUE = 70
const BOUNTY_WINDOW_SHORT = 240
const BOUNTY_SHORT_PICKS = 3
const BOUNTY_WINDOW_LONG = 480
const BOUNTY_LONG_PICKS = 5
/** 补刀单价（金/刀）与被动金钱（金/秒）：实测加速=常规（~41 与 3.0），只保留 Turbo 方向的阈值当备份。 */
const INCOME_MIN_CLOCK = 30
const TURBO_INCOME_RATE = 4.5
const CREEP_MIN_LAST_HITS = 5
const TURBO_CREEP_BOUNTY = 70
const REGULAR_XPM = 600
const REGULAR_XPM_CLOCK = 420

export class ModeInference {
  constructor() {
    this.reset()
  }

  reset() {
    /** unknown | regular | turbo */
    this.mode = 'unknown'
    /** 判定依据：game_mode / bounty / roshan / creep / income / xpm / manual，面板上看。 */
    this.basis = null
    /** 实测值，面板核对用。 */
    this.xpm = null
    this.incomeRate = null
    this.creepBounty = null
    /** 赏金符拾取（game_time 基准）+ 金额，节奏/金额两条推断的原始数据。 */
    this.bountyPickups = []
    // 换局重置只清推断；手动指定是设置里存着的，继续有效。
    if (this.forced) {
      this.mode = this.forced
      this.basis = 'manual'
    }
  }

  /**
   * 手动指定（year 2026-11-22 定的兜底：用户在面板设置里选，Coo 用 dota_mode 工具改）。
   * 手动优先于一切推断，写进设置保留，设回 auto 恢复推断。同一局内重复设同一值是无害的。
   */
  setForced(value) {
    const next = value === 'turbo' || value === 'regular' ? value : null
    if (this.forced === next) return
    this.forced = next
    if (next) {
      this.mode = next
      this.basis = 'manual'
    } else {
      this.mode = 'unknown'
      this.basis = null
    }
  }

  /** 强信号：看到 Turbo 特征就直接改判（可推翻先前误判的常规；模式一局不变，改判只在纠错）。 */
  noteTurbo(basis = 'manual') {
    if (this.forced) return
    this.mode = 'turbo'
    this.basis = basis
  }

  /**
   * 赏金符拾取（year 2026-11-22 提议，主信号）——两条路：
   *
   * 1. **首波金额**：常规局首波 ≈40 金（真机归档：172 秒时 40，10 分钟才 46，涨得慢）；
   *    首波（game_time ≤ 90 秒）捡到的符 ≥70 金 = 加速给双倍（year 的预期，待一局校准），
   *    ≤50 金 = 常规。**0 秒就刷、几十秒内被吃，赶得上 1:00 的莲花提醒。**
   * 2. **节奏**（第二确认，偏晚）：常规 4 分钟一波、每波 2 个符，240 秒内最多 2 次拾取；
   *    240 秒内 ≥3 次（或 480 秒内 ≥5 次）只能是「2 分钟一波」的加速局。
   *    结构性信号，不吃打钱快慢。双方的拾取都在 events 块里（bounty_rune_pickup，归档 337 条实锤）。
   */
  noteBountyPickup(gameTime, bountyValue = null) {
    if (!Number.isFinite(gameTime) || gameTime < 0) return
    this.bountyPickups.push({ t: gameTime, v: Number.isFinite(bountyValue) ? bountyValue : null })
    if (this.bountyPickups.length > 40) this.bountyPickups.splice(0, this.bountyPickups.length - 40)
    if (this.forced) return // 手动指定时只记账不判，尊重人的选择。

    if (gameTime <= BOUNTY_FIRST_WAVE_END && Number.isFinite(bountyValue)) {
      if (bountyValue >= TURBO_FIRST_WAVE_VALUE) {
        this.noteTurbo('bounty')
        return
      }
      if (bountyValue <= REGULAR_FIRST_WAVE_VALUE && this.mode === 'unknown') {
        this.mode = 'regular'
        this.basis = 'bounty'
        return
      }
    }

    const inShort = this.bountyPickups.filter((p) => p.t <= BOUNTY_WINDOW_SHORT).length
    const inLong = this.bountyPickups.filter((p) => p.t <= BOUNTY_WINDOW_LONG).length
    if (inShort >= BOUNTY_SHORT_PICKS || inLong >= BOUNTY_LONG_PICKS) {
      this.noteTurbo('bounty')
    }
  }

  /** 每帧喂一次。返回当前判断（unknown 也让调用方决定怎么兜底）。手动指定时推断整个让路。 */
  observe(snap, clock) {
    if (this.forced) {
      this.mode = this.forced
      this.basis = 'manual'
      return this.mode
    }
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

    // XPM 只判常规（低速确认），不判 Turbo——打钱快慢因人而异（year 定调）。
    if (Number.isFinite(clock) && clock >= REGULAR_XPM_CLOCK) {
      const xpm = snap?.player?.xpm
      if (Number.isFinite(xpm) && xpm > 0) {
        this.xpm = xpm
        if (xpm <= REGULAR_XPM && this.mode === 'unknown') {
          this.mode = 'regular'
          this.basis = 'xpm'
        }
      }
    }

    // 备份信号：只保留 Turbo 方向，且实测加速=常规，平时不指望它们命中。
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
    const firstWave = this.bountyPickups.filter((p) => p.t <= BOUNTY_FIRST_WAVE_END).map((p) => `${p.v ?? '?'}金`).join('/')
    const label = this.mode === 'turbo' ? '加速' : this.mode === 'regular' ? '常规' : '判断中'
    const basisLabel = this.basis === 'manual' ? '手动' : this.basis
    const parts = [
      `${label}${basisLabel ? `（${basisLabel}）` : ''}`,
      `符文 ${this.bountyPickups.length} 次${firstWave ? `（首波 ${firstWave}）` : ''}`,
      `XPM ${xpm}`,
      `被动金钱 ${rate}`,
      `补刀单价 ${bounty}`,
    ]
    return parts.join(' · ')
  }
}
