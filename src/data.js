/** 静态对照表：建筑、消耗品、阶段。手写，不依赖外部数据。 */

export const PHASES = {
  DOTA_GAMERULES_STATE_INIT: 'menu',
  DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD: 'loading',
  DOTA_GAMERULES_STATE_HERO_SELECTION: 'draft',
  DOTA_GAMERULES_STATE_STRATEGY_TIME: 'strategy',
  DOTA_GAMERULES_STATE_TEAM_SHOWCASE: 'showcase',
  DOTA_GAMERULES_STATE_PRE_GAME: 'pregame',
  DOTA_GAMERULES_STATE_GAME_IN_PROGRESS: 'playing',
  DOTA_GAMERULES_STATE_POST_GAME: 'postgame',
  DOTA_GAMERULES_STATE_DISCONNECT: 'disconnect',
}

export const PHASE_LABEL = {
  menu: '菜单',
  loading: '载入中',
  draft: '选人',
  strategy: '策略时间',
  showcase: '登场',
  pregame: '开局准备',
  playing: '对局中',
  postgame: '已结束',
  disconnect: '掉线',
  unknown: '未知',
}

/** 这些阶段算「在局里」。掉线算在局里：它说明这一局还没结束，只是客户端断了。 */
export const MATCH_PHASES = new Set(['draft', 'strategy', 'showcase', 'pregame', 'playing', 'postgame', 'disconnect'])

/** 刚买的消耗品不当成装备事件，免得每买一张 TP 就推一条。 */
export const CONSUMABLE_ITEMS = new Set([
  'item_tango',
  'item_tango_single',
  'item_flask',
  'item_clarity',
  'item_faerie_fire',
  'item_enchanted_mango',
  'item_tpscroll',
  'item_ward_observer',
  'item_ward_sentry',
  'item_ward_dispenser',
  'item_dust',
  'item_smoke_of_deceit',
  'item_bottle',
  'item_cheese',
  'item_aegis',
])

/** 建筑键 → 中文名。键来自 GSI 的 buildings 段。 */
export const BUILDING_NAMES = {
  dota_goodguys_tower1_top: '天辉上路一塔',
  dota_goodguys_tower1_mid: '天辉中路一塔',
  dota_goodguys_tower1_bot: '天辉下路一塔',
  dota_goodguys_tower2_top: '天辉上路二塔',
  dota_goodguys_tower2_mid: '天辉中路二塔',
  dota_goodguys_tower2_bot: '天辉下路二塔',
  dota_goodguys_tower3_top: '天辉上路三塔',
  dota_goodguys_tower3_mid: '天辉中路三塔',
  dota_goodguys_tower3_bot: '天辉下路三塔',
  dota_goodguys_tower4_top: '天辉上路基地塔',
  dota_goodguys_tower4_bot: '天辉下路基地塔',
  dota_goodguys_tower4: '天辉基地塔',
  dota_goodguys_barracks_top_melee: '天辉上路近战兵营',
  dota_goodguys_barracks_top_ranged: '天辉上路远程兵营',
  dota_goodguys_barracks_mid_melee: '天辉中路近战兵营',
  dota_goodguys_barracks_mid_ranged: '天辉中路远程兵营',
  dota_goodguys_barracks_bot_melee: '天辉下路近战兵营',
  dota_goodguys_barracks_bot_ranged: '天辉下路远程兵营',
  // buildings 段里兵营的实际键名是 good_rax_*/bad_rax_*（2026-11-25 真机实测：good_rax_range_mid）。
  good_rax_melee_top: '天辉上路近战兵营',
  good_rax_range_top: '天辉上路远程兵营',
  good_rax_melee_mid: '天辉中路近战兵营',
  good_rax_range_mid: '天辉中路远程兵营',
  good_rax_melee_bot: '天辉下路近战兵营',
  good_rax_range_bot: '天辉下路远程兵营',
  bad_rax_melee_top: '夜魇上路近战兵营',
  bad_rax_range_top: '夜魇上路远程兵营',
  bad_rax_melee_mid: '夜魇中路近战兵营',
  bad_rax_range_mid: '夜魇中路远程兵营',
  bad_rax_melee_bot: '夜魇下路近战兵营',
  bad_rax_range_bot: '夜魇下路远程兵营',
  dota_goodguys_fort: '天辉遗迹',
  dota_badguys_tower1_top: '夜魇上路一塔',
  dota_badguys_tower1_mid: '夜魇中路一塔',
  dota_badguys_tower1_bot: '夜魇下路一塔',
  dota_badguys_tower2_top: '夜魇上路二塔',
  dota_badguys_tower2_mid: '夜魇中路二塔',
  dota_badguys_tower2_bot: '夜魇下路二塔',
  dota_badguys_tower3_top: '夜魇上路三塔',
  dota_badguys_tower3_mid: '夜魇中路三塔',
  dota_badguys_tower3_bot: '夜魇下路三塔',
  dota_badguys_tower4_top: '夜魇上路基地塔',
  dota_badguys_tower4_bot: '夜魇下路基地塔',
  dota_badguys_tower4: '夜魇基地塔',
  dota_badguys_barracks_top_melee: '夜魇上路近战兵营',
  dota_badguys_barracks_top_ranged: '夜魇上路远程兵营',
  dota_badguys_barracks_mid_melee: '夜魇中路近战兵营',
  dota_badguys_barracks_mid_ranged: '夜魇中路远程兵营',
  dota_badguys_barracks_bot_melee: '夜魇下路近战兵营',
  dota_badguys_barracks_bot_ranged: '夜魇下路远程兵营',
  dota_badguys_fort: '夜魇遗迹',
}

export function buildingName(key) {
  return BUILDING_NAMES[key] ?? key
}

export function teamName(team) {
  if (team === 0 || team === '0' || team === 'radiant') return '天辉'
  if (team === 1 || team === '1' || team === 'dire') return '夜魇'
  return null
}
