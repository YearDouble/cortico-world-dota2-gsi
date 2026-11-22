/** 小工具：数字、时间、文本，不依赖宿主。 */

export function num(value) {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function bool(value) {
  if (value === true || value === false) return value
  if (value === 1 || value === '1' || value === 'true') return true
  if (value === 0 || value === '0' || value === 'false') return false
  return null
}

/** 秒数 → 12:34；负数（出兵前的 clock_time）→ -1:30。超过一小时给 1:02:03。 */
export function clock(seconds) {
  const n = num(seconds)
  if (n === null) return null
  const sign = n < 0 ? '-' : ''
  const total = Math.abs(Math.round(n))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${sign}${h}:${mm}:${ss}` : `${sign}${m}:${ss}`
}

/** 秒数 → 1 分 20 秒；不到一分钟只说秒。 */
export function span(seconds) {
  const n = num(seconds)
  if (n === null) return null
  const total = Math.max(0, Math.round(n))
  if (total < 60) return `${total} 秒`
  const m = Math.floor(total / 60)
  const s = total % 60
  return s === 0 ? `${m} 分` : `${m} 分 ${s} 秒`
}

export function percent(value, max) {
  const v = num(value)
  const m = num(max)
  if (v === null || m === null || m <= 0) return null
  return Math.max(0, Math.min(100, Math.round((v / m) * 100)))
}

export function stripPrefix(key, prefix) {
  if (typeof key !== 'string') return null
  return key.startsWith(prefix) ? key.slice(prefix.length) : key
}

/** 太长就截断，回执里用。 */
export function clip(text, max = 4000) {
  const s = String(text ?? '')
  return s.length <= max ? s : `${s.slice(0, max)}…（已截断，原长 ${s.length}）`
}

/** 英文键名前面补一个空格，免得「买到blink」黏在一起。 */
export function glue(label) {
  if (typeof label !== 'string' || label === '') return ''
  return /^[A-Za-z0-9_]/.test(label) ? ` ${label}` : label
}
