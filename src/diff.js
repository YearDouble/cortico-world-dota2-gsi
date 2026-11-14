/** 前后两帧比对，产出事件。只写事实和数字，不写判断。 */
import { clock, span, glue } from './util.js'
import { teamName, PHASE_LABEL, CONSUMABLE_ITEMS, buildingName } from './data.js'
import { heroName, itemName } from './names.js'

/** 阶段变化时的说法，比卡片里的短标签更顺口。 */
const PHASE_EVENT_LABEL = {
  draft: '选人',
  strategy: '策略时间',
  showcase: '登场展示',
  pregame: '开局准备',
  playing: '对线开始',
  menu: '菜单',
  disconnect: '掉线',
  unknown: '未知状态',
}

/** 每条事件的投递级别。只按「等久了还有没有用」定。 */
export const TRIGGERS = {
  'dota.match.started': 'flush',
  'dota.match.ended': 'flush',
  'dota.match.left': 'debounce',
  'dota.match.phase': 'debounce',
  'dota.match.paused': 'debounce',
  'dota.match.disconnected': 'flush',
  'dota.match.reconnected': 'debounce',
  'dota.player.died': 'flush',
  'dota.player.respawned': 'debounce',
  'dota.player.leveled': 'debounce',
  'dota.player.killed': 'debounce',
  'dota.player.assisted': 'debounce',
  'dota.player.item': 'debounce',
  'dota.player.upgrade': 'debounce',
  'dota.map.score': 'piggyback',
  'dota.map.roshan': 'debounce',
  'dota.map.building': 'debounce',
  'dota.map.daynight': 'piggyback',
}

export function triggerOf(type) {
  return TRIGGERS[type] ?? 'debounce'
}

function grow(before, after) {
  if (before === null || before === undefined) return 0
  if (after === null || after === undefined) return 0
  return after > before ? after - before : 0
}

function stamp(snap) {
  return snap.clock !== null ? `[刀塔 ${clock(snap.clock)}]` : '[刀塔]'
}

function kda(snap) {
  const p = snap.player
  if (!p || (p.kills === null && p.deaths === null && p.assists === null)) return null
  return `${p.kills ?? '?'}/${p.deaths ?? '?'}/${p.assists ?? '?'}`
}

function heroLabel(snap, names, rawKeys) {
  if (!snap.hero) return null
  return heroName(snap.hero.key, names, rawKeys) ?? (snap.hero.id !== null ? `英雄 ${snap.hero.id}` : null)
}

function scoreTail(snap) {
  if (snap.radiant === null && snap.dire === null) return null
  return `比分 天辉 ${snap.radiant ?? '?'}–${snap.dire ?? '?'} 夜魇`
}

function withTail(snap, core, names, rawKeys) {
  const parts = [core]
  const line = kda(snap)
  if (line) parts.push(line)
  const score = scoreTail(snap)
  if (score) parts.push(score)
  if (snap.player?.gold !== null && snap.player?.gold !== undefined) parts.push(`金钱 ${snap.player.gold}`)
  return parts.join(' · ')
}

function matchResultText(snap, names, rawKeys) {
  const parts = []
  const score = `天辉 ${snap.radiant ?? '?'}–${snap.dire ?? '?'} 夜魇`
  parts.push(score)
  const winner = teamName(snap.winTeam)
  if (winner) parts.push(`${winner}胜`)
  if (snap.clock !== null) parts.push(`用时 ${clock(snap.clock)}`)
  const head = `打完：${parts.join('，')}`
  const hero = heroLabel(snap, names, rawKeys)
  const tail = []
  if (hero) tail.push(`你用${glue(hero)}`)
  const line = kda(snap)
  if (line) tail.push(line)
  if (snap.player?.lastHits !== null && snap.player?.lastHits !== undefined) tail.push(`补刀 ${snap.player.lastHits}`)
  if (snap.player?.gold !== null && snap.player?.gold !== undefined) tail.push(`金钱 ${snap.player.gold}`)
  return tail.length > 0 ? `${head}。${tail.join('，')}。` : `${head}。`
}

function dealDetail(snap, names, rawKeys) {
  const parts = []
  const hero = snap.hero
  if (hero?.respawn !== null && hero?.respawn !== undefined && hero.respawn > 0) {
    parts.push(`${span(hero.respawn)}后复活`)
  }
  if (hero?.buybackCost !== null && hero?.buybackCost !== undefined && hero.buybackCost > 0) {
    const cooling = hero.buybackCooldown !== null && hero.buybackCooldown > 0
    parts.push(cooling ? `买活冷却 ${span(hero.buybackCooldown)}` : `买活 ${hero.buybackCost} 金（可买）`)
  }
  if (snap.radiant !== null || snap.dire !== null) {
    parts.push(`比分 天辉 ${snap.radiant ?? '?'}–${snap.dire ?? '?'} 夜魇`)
  }
  const line = kda(snap)
  if (line) parts.push(line)
  return parts.length > 0 ? `你阵亡了，${parts.join('；')}。` : '你阵亡了。'
}

export function diff(prev, next, options = {}) {
  const { names = null, rawKeys = false, suppressStart = false } = options
  const events = []
  const push = (type, text) => {
    events.push({ type, text: `${stamp(next)} ${text}`, meta: { clock: next.clock, phase: next.phase } })
  }

  if (!prev) return events

  // 终局帧只发一条汇总。结束帧里的数字是终局快照，现在才补发升级、装备、比分没有意义。
  if (next.phase === 'postgame' && prev.phase !== 'postgame') {
    push('dota.match.ended', matchResultText(next, names, rawKeys))
    return events
  }

  const wasIn = prev.inMatch
  const isIn = next.inMatch

  if (!wasIn && isIn && !suppressStart) {
    const hero = heroLabel(next, names, rawKeys)
    const team = teamName(next.player?.team)
    const tail = hero ? `：${hero}${team ? `（${team}）` : ''}` : ''
    push('dota.match.started', `对局开始（${PHASE_EVENT_LABEL[next.phase] ?? PHASE_LABEL[next.phase]}）${tail}。`)
  } else if (wasIn && isIn && prev.phase !== next.phase) {
    if (next.phase === 'disconnect') {
      push('dota.match.left', '客户端掉线了，这一局暂时没有新数据。')
    } else if (next.phase === 'playing' && prev.phase === 'disconnect') {
      push('dota.match.phase', '客户端回到对局了。')
    } else {
      const beforeHero = heroLabel(prev, names, rawKeys)
      const nowHero = heroLabel(next, names, rawKeys)
      const tail = !beforeHero && nowHero ? `，你拿的是${glue(nowHero)}` : ''
      push('dota.match.phase', `进入${PHASE_EVENT_LABEL[next.phase] ?? PHASE_LABEL[next.phase]}${tail}。`)
    }
  } else if (wasIn && !isIn && prev.phase !== 'postgame') {
    push('dota.match.left', `回到菜单，这一局没打完${prev.clock !== null ? `（最后 ${clock(prev.clock)}）` : ''}。`)
  }

  // 同一帧里已经有击杀、助攻或阵亡时，比分变化由那条事件带着走，不重复发。
  let combat = false
  const hero = next.hero
  const before = prev.hero

  if (hero && before) {
    const died = before.alive !== false && hero.alive === false
    if (died) {
      combat = true
      push('dota.player.died', dealDetail(next, names, rawKeys))
    } else if (before.alive === false && hero.alive === true) {
      const parts = ['你复活了']
      if (hero.health !== null && hero.maxHealth !== null) parts[0] += `，血 ${hero.health}/${hero.maxHealth}`
      if (next.player?.gold !== null && next.player?.gold !== undefined) parts.push(`金钱 ${next.player.gold}`)
      const line = kda(next)
      if (line) parts.push(line)
      push('dota.player.respawned', `${parts.join('，')}。`)
    }

    const levels = grow(before.level, hero.level)
    if (levels > 0) {
      const jump = levels > 1 ? `（一次涨了 ${levels} 级）` : ''
      push('dota.player.leveled', `你升到 ${hero.level} 级${jump}。`)
    }

    for (const [flag, label] of [
      ['scepter', '阿哈利姆神杖'],
      ['shard', '阿哈利姆魔晶'],
      ['moonshard', '月之精华碎片'],
    ]) {
      if (before[flag] === false && hero[flag] === true) push('dota.player.upgrade', `你拿到${label}。`)
    }
  }
  const kills = grow(prev.player?.kills, next.player?.kills)
  if (kills > 0) {
    combat = true
    push('dota.player.killed', withTail(next, `击杀 +${kills}`, names, rawKeys) + '。')
  }

  const assists = grow(prev.player?.assists, next.player?.assists)
  if (assists > 0) {
    combat = true
    push('dota.player.assisted', withTail(next, `助攻 +${assists}`, names, rawKeys) + '。')
  }

  if (prev.sections.items && next.sections.items) {
    const slotKey = (item) => `${item.area}:${item.slot}`
    const beforeSlots = new Map(prev.items.map((item) => [slotKey(item), item.key]))
    for (const item of next.items) {
      if (beforeSlots.get(slotKey(item)) === item.key) continue
      if (CONSUMABLE_ITEMS.has(item.key) || item.key.startsWith('item_recipe_')) continue
      const label = itemName(item.key, names, rawKeys) ?? item.key
      const gold = next.player?.gold !== null && next.player?.gold !== undefined ? `，剩 ${next.player.gold} 金` : ''
      if (item.area === 'neutral') push('dota.player.item', `拿到中立装备${glue(label)}${gold}。`)
      else if (item.area === 'bag') push('dota.player.item', `背包里多了${glue(label)}${gold}。`)
      else if (item.area === 'tp') continue
      else push('dota.player.item', `买到${glue(label)}（第 ${item.slot + 1} 格）${gold}。`)
    }
  }

  if (!combat && prev.radiant !== null && next.radiant !== null && prev.dire !== null && next.dire !== null) {
    const r = next.radiant - prev.radiant
    const d = next.dire - prev.dire
    if (r !== 0 || d !== 0) {
      const who = r > 0 ? `天辉 +${r}` : `夜魇 +${d}`
      push('dota.map.score', `比分 ${next.radiant}–${next.dire}（${who}）。`)
    }
  }

  if (prev.roshan !== null && next.roshan !== null) {
    if (prev.roshan > 0 && next.roshan <= 0) push('dota.map.roshan', '肉山刷新了。')
    else if (prev.roshan <= 0 && next.roshan > 0) push('dota.map.roshan', `肉山被打了，${span(next.roshan)}后刷新。`)
  }

  if (prev.sections.buildings && next.sections.buildings) {
    for (const side of ['radiant', 'dire']) {
      for (const [key, beforeBuilding] of Object.entries(prev.buildings[side])) {
        const after = next.buildings[side][key]
        if (!after) continue
        if (beforeBuilding.health !== null && beforeBuilding.health > 0 && after.health !== null && after.health <= 0) {
          push('dota.map.building', `${buildingName(key)}被摧毁。`)
        }
      }
    }
  }

  if (prev.day !== null && next.day !== null && prev.day !== next.day) {
    // 出兵前 daytime 会从 false 翻成 true，那不是「天亮」，别报。
    const preGame = (prev.clock !== null && prev.clock < 0) || (next.clock !== null && next.clock <= 0)
    if (!preGame) push('dota.map.daynight', next.day ? '天亮了。' : '天黑了。')
  }

  if (prev.paused !== null && next.paused !== null && prev.paused !== next.paused) {
    push('dota.match.paused', next.paused ? '游戏暂停。' : '游戏继续。')
  }

  return events
}
