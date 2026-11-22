/** 把 GSI 的一次 POST 压成一张结构固定的快照。字段一律宽容：缺了就是 null，不拿 0 冒充。 */
import { num, bool } from './util.js'
import { PHASES, MATCH_PHASES } from './data.js'

/** 报文是不是 Dota 推的。appid 可能给数字也可能给字符串。 */
export function isDotaPayload(payload) {
  return num(payload?.provider?.appid) === 570
}

export function phaseOf(payload) {
  const state = payload?.map?.game_state
  if (typeof state === 'string' && state !== '') return PHASES[state] ?? 'unknown'
  return payload?.map ? 'unknown' : 'menu'
}

export function isMatchPhase(phase) {
  return MATCH_PHASES.has(phase)
}

/** 空格子也占一个键，名字叫 empty，不能当装备。 */
const EMPTY_ITEM = 'empty'

/**
 * 物品栏的键分布（2026-11-13 对着真机报文核的）：
 * slot0-5 身上、slot6-8 背包、neutral0 中立装备、teleport0 回城卷轴；
 * stash0-5 是基地储藏处，preserved_neutral* 是备用槽，都不展示。
 */
function itemSlotOf(key) {
  const match = /^slot(\d+)$/.exec(key)
  if (match) {
    const slot = Number(match[1])
    return { area: slot <= 5 ? 'inv' : 'bag', slot }
  }
  if (key === 'neutral0') return { area: 'neutral', slot: 0 }
  if (key === 'teleport0') return { area: 'tp', slot: 0 }
  return null
}

function parseItems(items) {
  if (!items || typeof items !== 'object') return []
  const out = []
  for (const [key, value] of Object.entries(items)) {
    const place = itemSlotOf(key)
    if (!place) continue
    if (!value || typeof value !== 'object') continue
    const name = typeof value.name === 'string' ? value.name : ''
    if (!name || name === EMPTY_ITEM) continue
    out.push({
      area: place.area,
      slot: place.slot,
      key: name,
      cooldown: num(value.cooldown),
      charges: num(value.charges) ?? num(value.item_charges),
    })
  }
  return out.sort((a, b) => (a.area === b.area ? a.slot - b.slot : a.area.localeCompare(b.area)))
}

function parseAbilities(abilities) {
  if (!abilities || typeof abilities !== 'object') return []
  const out = []
  for (const [key, value] of Object.entries(abilities)) {
    const match = /^ability(\d+)$/.exec(key)
    if (!match || !value || typeof value !== 'object') continue
    const name = typeof value.name === 'string' && value.name !== '' ? value.name : null
    if (!name) continue
    out.push({
      slot: Number(match[1]),
      key: name,
      level: num(value.level),
      canCast: bool(value.can_cast),
      passive: bool(value.passive),
      cooldown: num(value.cooldown),
      ultimate: bool(value.ultimate),
    })
  }
  return out.sort((a, b) => a.slot - b.slot)
}

function parseBuildings(buildings) {
  const out = { radiant: {}, dire: {} }
  if (!buildings || typeof buildings !== 'object') return out
  for (const side of ['radiant', 'dire']) {
    const group = buildings[side]
    if (!group || typeof group !== 'object') continue
    for (const [key, value] of Object.entries(group)) {
      if (!value || typeof value !== 'object') continue
      const health = num(value.health)
      const maxHealth = num(value.max_health)
      if (health === null && maxHealth === null) continue
      out[side][key] = { health, maxHealth }
    }
  }
  return out
}

export function normalize(payload) {
  const map = payload?.map ?? null
  const hero = payload?.hero ?? null
  const player = payload?.player ?? null
  const phase = phaseOf(payload)
  // 选人阶段 hero 段会先出现、id 是 0、名字是空的，这时候还没有英雄。
  const heroName = typeof hero?.name === 'string' ? hero.name : ''
  const heroId = num(hero?.id)
  const hasHero = !!hero && (heroName !== '' || (heroId !== null && heroId > 0))

  let alive = bool(hero?.alive)
  if (alive === null && hero) {
    const respawn = num(hero.respawn_seconds)
    const health = num(hero.health)
    if (respawn !== null && respawn > 0) alive = false
    else if (health !== null) alive = health > 0
  }

  return {
    phase,
    inMatch: isMatchPhase(phase),
    matchId: map?.matchid !== undefined ? String(map.matchid) : null,
    clock: num(map?.clock_time) ?? num(map?.game_time),
    gameTime: num(map?.game_time),
    day: bool(map?.daytime),
    paused: bool(map?.paused),
    radiant: num(map?.radiant_score),
    dire: num(map?.dire_score),
    winTeam: map?.win_team ?? null,
    // 这一版 GSI 不发 roshan_respawn_timer（真机报文里没有），留着字段，读到才用。
    roshan: num(map?.roshan_respawn_timer),
    gameMode: typeof map?.game_mode === 'string' ? map.game_mode : null,
    // Turbo 判定用的原始数值（OpenDota 枚举 23=Turbo，真机第一局在面板核对）。
    gameModeNum: num(map?.game_mode),
    hero: hasHero
      ? {
          key: heroName !== '' ? heroName : null,
          id: heroId,
          level: num(hero.level),
          // 自己的世界坐标，位置库在 self 圈缺席（阵亡）时兜底用。
          x: num(hero.xpos),
          y: num(hero.ypos),
          health: num(hero.health),
          maxHealth: num(hero.max_health),
          mana: num(hero.mana),
          maxMana: num(hero.max_mana),
          alive,
          respawn: num(hero.respawn_seconds),
          buybackCost: num(hero.buyback_cost),
          buybackCooldown: num(hero.buyback_cooldown),
          scepter: bool(hero.aghanims_scepter),
          shard: bool(hero.aghanims_shard),
          moonshard: bool(hero.moonshard),
          silenced: bool(hero.silenced),
          stunned: bool(hero.stunned),
          hexed: bool(hero.hexed),
          muted: bool(hero.muted),
          disarmed: bool(hero.disarmed),
          magicImmune: bool(hero.magicimmune),
          smoked: bool(hero.smoked),
        }
      : null,
    player: player
      ? {
          team: player.team_name ?? player.team ?? null,
          // 队内序号：chat playerid 映射的锚点（D16）。GSI 的 player_slot 是房间序号，另一回事。
          teamSlot: num(player.team_slot),
          kills: num(player.kills),
          deaths: num(player.deaths),
          assists: num(player.assists),
          gold: num(player.gold),
          reliable: num(player.gold_reliable),
          unreliable: num(player.gold_unreliable),
          gpm: num(player.gpm),
          xpm: num(player.xpm),
          netWorth: num(player.net_worth),
          lastHits: num(player.last_hits),
          denies: num(player.denies),
          // 被动金钱累计：推断常规/Turbo 用的信号（GSI 不发 game_mode，见 mode.js）。
          goldFromIncome: num(player.gold_from_income),
          goldFromCreepKills: num(player.gold_from_creep_kills),
        }
      : null,
    items: parseItems(payload?.items),
    abilities: parseAbilities(payload?.abilities),
    buildings: parseBuildings(payload?.buildings),
    sections: {
      map: !!payload?.map,
      player: !!payload?.player,
      hero: !!payload?.hero,
      abilities: !!payload?.abilities,
      items: !!payload?.items,
      buildings: !!payload?.buildings,
      draft: !!payload?.draft,
    },
    payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload) : [],
  }
}
