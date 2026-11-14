/** 名字显示：原始键、去前缀、或用户给的对照表。 */

function heroTable(names) {
  return names?.heroes && typeof names.heroes === 'object' ? names.heroes : null
}

function itemTable(names) {
  return names?.items && typeof names.items === 'object' ? names.items : null
}

function abilityTable(names) {
  return names?.abilities && typeof names.abilities === 'object' ? names.abilities : null
}

function strip(key, prefix) {
  return typeof key === 'string' && key.startsWith(prefix) ? key.slice(prefix.length) : key
}

export function heroName(key, names, rawKeys = false) {
  if (!key) return null
  if (rawKeys) return key
  const short = strip(key, 'npc_dota_hero_')
  return heroTable(names)?.[short] ?? short
}

export function itemName(key, names, rawKeys = false) {
  if (!key) return null
  if (rawKeys) return key
  const short = strip(key, 'item_')
  return itemTable(names)?.[short] ?? short
}

export function abilityName(key, names, rawKeys = false) {
  if (!key) return null
  if (rawKeys) return key
  return abilityTable(names)?.[key] ?? key
}
