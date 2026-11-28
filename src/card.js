/** 渲染对局中的卡片。只拼事实，不写判断。 */
import { clock, span, percent } from './util.js'
import { teamName } from './data.js'
import { heroName, itemName, abilityName } from './names.js'

function scoreLine(snap) {
  if (snap.radiant === null && snap.dire === null) return null
  return `天辉 ${snap.radiant ?? '?'}–${snap.dire ?? '?'} 夜魇`
}

function itemText(item, names, rawKeys) {
  let text = itemName(item.key, names, rawKeys) ?? item.key
  if (item.charges !== null && item.charges > 1) text += ` ×${item.charges}`
  if (item.cooldown !== null && item.cooldown > 0) text += `（冷却 ${Math.ceil(item.cooldown)} 秒）`
  return text
}

function statusWords(hero) {
  const words = []
  if (hero.silenced) words.push('沉默')
  if (hero.stunned) words.push('眩晕')
  if (hero.hexed) words.push('变羊')
  if (hero.muted) words.push('物品禁用')
  if (hero.disarmed) words.push('缴械')
  if (hero.magicImmune) words.push('魔法免疫')
  if (hero.smoked) words.push('诡计之雾')
  return words
}

export function renderMatchCard(snap, options = {}) {
  const { names = null, rawKeys = false, mode = null, modeBasis = null } = options
  const lines = []
  const phase = snap.phase === 'playing' ? '对局中' : snap.phase === 'pregame' ? '开局准备' : snap.phase === 'draft' ? '选人' : snap.phase === 'strategy' ? '策略时间' : snap.phase === 'postgame' ? '已结束' : '对局中'

  const header = [phase]
  if (snap.clock !== null) header.push(clock(snap.clock))
  const score = scoreLine(snap)
  if (score) header.push(score)
  if (snap.day === true) header.push('白天')
  if (snap.day === false) header.push('黑夜')
  // 模式是推断出来的（GSI 不发），标着「推断」让她转告时留个心眼；手动指定的标「手动」。
  const modeTag = modeBasis === 'manual' ? '（手动）' : '（推断）'
  if (mode === 'turbo') header.push(`加速模式${modeTag}`)
  if (mode === 'regular') header.push(`常规模式${modeTag}`)
  if (snap.paused) header.push('暂停中')
  lines.push(`[刀塔战况] ${header.join(' · ')}`)

  const hero = snap.hero
  const player = snap.player

  if (hero) {
    const name = heroName(hero.key, names, rawKeys) ?? (hero.id !== null ? `英雄 ${hero.id}` : '未知英雄')
    const level = hero.level !== null ? ` Lv.${hero.level}` : ''
    const team = teamName(player?.team)
    lines.push(`英雄：${name}${level}${team ? `（${team}）` : ''}`)
  }

  if (hero && (hero.health !== null || hero.maxHealth !== null)) {
    const pct = percent(hero.health, hero.maxHealth)
    lines.push(`生命 ${hero.health ?? '?'}/${hero.maxHealth ?? '?'}${pct !== null ? `（${pct}%）` : ''}`)
  }

  if (hero && (hero.mana !== null || hero.maxMana !== null)) {
    const pct = percent(hero.mana, hero.maxMana)
    if (hero.maxMana !== null && hero.maxMana > 0) {
      lines.push(`魔法 ${hero.mana ?? '?'}/${hero.maxMana}${pct !== null ? `（${pct}%）` : ''}`)
    }
  }

  if (player) {
    const money = []
    if (player.gold !== null) {
      let gold = `金钱 ${player.gold}`
      if (player.reliable !== null || player.unreliable !== null) {
        gold += `（可靠 ${player.reliable ?? '?'} / 不可靠 ${player.unreliable ?? '?'}）`
      }
      money.push(gold)
    }
    if (player.netWorth !== null) money.push(`净价值 ${player.netWorth}`)
    if (player.gpm !== null) money.push(`GPM ${player.gpm}`)
    if (player.xpm !== null) money.push(`XPM ${player.xpm}`)
    if (money.length > 0) lines.push(money.join(' · '))

    const combat = []
    if (player.kills !== null || player.deaths !== null || player.assists !== null) {
      combat.push(`战绩 ${player.kills ?? '?'}/${player.deaths ?? '?'}/${player.assists ?? '?'}`)
    }
    if (player.lastHits !== null) {
      combat.push(`补刀 ${player.lastHits}${player.denies !== null ? ` / 反补 ${player.denies}` : ''}`)
    }
    if (combat.length > 0) lines.push(combat.join(' · '))
  }

  const main = snap.items.filter((item) => item.area === 'inv')
  const backpack = snap.items.filter((item) => item.area === 'bag')
  const neutral = snap.items.filter((item) => item.area === 'neutral')

  if (main.length > 0) lines.push(`装备：${main.map((item) => itemText(item, names, rawKeys)).join('、')}`)
  if (backpack.length > 0) lines.push(`背包：${backpack.map((item) => itemText(item, names, rawKeys)).join('、')}`)
  if (neutral.length > 0) lines.push(`中立：${neutral.map((item) => itemText(item, names, rawKeys)).join('、')}`)

  if (hero) {
    const words = []
    if (hero.alive === false) {
      words.push(hero.respawn !== null && hero.respawn > 0 ? `阵亡，还有 ${span(hero.respawn)}复活` : '阵亡')
    } else if (hero.alive === true) {
      words.push('存活')
    }
    const flags = statusWords(hero)
    if (flags.length > 0) words.push(`状态：${flags.join('、')}`)
    if (hero.buybackCooldown !== null && hero.buybackCooldown > 0) {
      words.push(`买活冷却 ${span(hero.buybackCooldown)}`)
    } else if (hero.buybackCost !== null && hero.buybackCost > 0) {
      words.push(`买活 ${hero.buybackCost} 金（可买）`)
    }
    if (words.length > 0) lines.push(`状态：${words.join(' · ')}`)
  }

  const ultimate = snap.abilities.find((ability) => ability.ultimate === true)
  if (ultimate) {
    const label = abilityName(ultimate.key, names, rawKeys)
    let state = '就绪'
    if (ultimate.level !== null && ultimate.level <= 0) state = '未学会'
    else if (ultimate.cooldown !== null && ultimate.cooldown > 0) state = `冷却 ${Math.ceil(ultimate.cooldown)} 秒`
    else if (ultimate.canCast === false) state = '不可施放'
    lines.push(`大招：${label}（${state}）`)
  }

  // 肉山行：本地状态机（首刷 20:00 / 原生击杀事件 + 本地续算）+ 小地图看到本体时直接纠正。
  // roshan_respawn_timer 哪天真进了报文也能兜底。
  const roshan = options.roshan
  if (roshan && roshan.phase === 'pending') {
    const first = roshan.firstSpawn !== null && roshan.firstSpawn > 0 ? `${clock(roshan.firstSpawn)} 首刷，` : ''
    lines.push(`肉山：${first}还没出来`)
  } else if (roshan && roshan.alive === true && roshan.estimated === true) {
    lines.push('肉山：估计已刷新（按时间估，没看到本体）')
  } else if (roshan && roshan.alive === true && roshan.killAt !== null) {
    lines.push('肉山：已刷新')
  } else if (roshan && roshan.alive === true) {
    lines.push('肉山：存活')
  } else if (roshan && roshan.alive === false && roshan.respawnAt !== null && roshan.now !== null && roshan.now !== undefined) {
    const remaining = Math.max(0, roshan.respawnAt - roshan.now)
    const carrier = roshan.carrierName ? `，盾在${roshan.carrierName}手里` : ''
    lines.push(`肉山：已死，约 ${span(remaining)}后刷新（估）${carrier}`)
  } else if (snap.roshan !== null && snap.roshan > 0) {
    lines.push(`肉山：还有 ${span(snap.roshan)}刷新`)
  }

  return lines.join('\n')
}

export function renderMatchRecord(record, options = {}) {
  const { names = null, rawKeys = false } = options
  if (!record) return null
  const parts = []
  if (record.clock !== null) parts.push(clock(record.clock))
  if (record.radiant !== null || record.dire !== null) {
    parts.push(`天辉 ${record.radiant ?? '?'}–${record.dire ?? '?'} 夜魇`)
  }
  const winner = teamName(record.winTeam)
  if (winner) parts.push(`${winner}胜`)

  const hero = record.heroKey ? `${heroName(record.heroKey, names, rawKeys)}` : record.heroId ? `英雄 ${record.heroId}` : null
  const tail = []
  if (hero) tail.push(hero)
  if (record.kills !== null || record.deaths !== null || record.assists !== null) {
    tail.push(`${record.kills ?? '?'}/${record.deaths ?? '?'}/${record.assists ?? '?'}`)
  }
  if (record.lastHits !== null) tail.push(`补刀 ${record.lastHits}`)
  if (record.gold !== null) tail.push(`金钱 ${record.gold}`)
  if (tail.length > 0) parts.push(tail.join('，'))
  return parts.join('，')
}
