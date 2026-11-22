/** 测试共用的帧构造器：合成 minimap 报文，形状按 2026-11-15 真机样本。 */

export function heroFrame(clock, entries, matchid = 'm1') {
  const minimap = {}
  let i = 0
  for (const entry of entries) {
    minimap[`o${i++}`] = {
      xpos: entry.x,
      ypos: entry.y,
      image: entry.self ? 'minimap_herocircle_self' : entry.enemy ? 'minimap_enemyicon' : 'minimap_herocircle',
      team: entry.team ?? (entry.enemy ? 3 : 2),
      yaw: 0,
      unitname: entry.unit,
      visionrange: 1800,
    }
  }
  return {
    provider: { appid: 570 },
    map: { game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: clock, game_time: clock + 138, matchid },
    minimap,
  }
}

/** 凑够「有效帧」的最少元素数（黑窗判据）。 */
export function fill(entries, count = 9) {
  const out = [...entries]
  for (let i = out.length; i < count; i++) {
    out.push({ unit: `npc_dota_hero_filler${i}`, x: -6000 + i * 100, y: -6000, team: 2 })
  }
  return out
}
