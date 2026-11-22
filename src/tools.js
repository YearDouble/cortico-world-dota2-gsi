/** 五个工具：四个只读 + dota_mode（手动指定模式）。名字、说明、参数来自 declarations.js。 */
import { renderMatchRecord } from './card.js'
import { TOOL_DECLS } from './declarations.js'

function clampInt(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return { value: fallback, clamped: false }
  const rounded = Math.round(n)
  const kept = Math.min(max, Math.max(min, rounded))
  return { value: kept, clamped: kept !== rounded }
}

export function createTools(state, options = {}) {
  const { timezone = 'Asia/Shanghai', persist = null } = options

  const handlers = {
    async dota_status() {
      return state.statusText()
    },

    async dota_events(args) {
      const minutes = clampInt(args?.minutes, 1, 60, 15)
      const limit = clampInt(args?.limit, 1, 50, 20)
      const found = state.eventsSince(minutes.value, limit.value)
      const notes = []
      if (minutes.clamped) notes.push(`minutes 超出范围，按 ${minutes.value} 分钟查`)
      if (limit.clamped) notes.push(`limit 超出范围，按 ${limit.value} 条给`)

      if (found.total === 0) {
        return `[ok] 最近 ${minutes.value} 分钟没有记录到变化。${notes.length > 0 ? `（${notes.join('；')}）` : ''}`
      }

      const lines = [`[ok] 最近 ${minutes.value} 分钟记录到 ${found.total} 条，给最近 ${found.items.length} 条：`]
      for (const event of found.items) lines.push(event.text)
      if (notes.length > 0) lines.push(`（${notes.join('；')}）`)
      return lines.join('\n')
    },

    async dota_match() {
      const summary = state.matchSummary()
      if (!summary) return '[ok] 还没有对局记录。'

      const body = renderMatchRecord(summary)
      if (summary.scope === 'current') {
        return `[ok] 正在打，到现在：${body}。`
      }

      const when =
        summary.endedAt !== undefined && summary.endedAt !== null
          ? `（结束于 ${new Date(summary.endedAt).toLocaleTimeString('zh-CN', { hour12: false, timeZone: timezone })}）`
          : ''
      return `[ok] 上一局${when}：${body}。`
    },

    async dota_minimap() {
      return state.minimapReceipt()
    },

    async dota_mode(args) {
      const value = args?.mode
      if (value === undefined || value === null || value === '') {
        const label = state.mode.mode === 'turbo' ? '加速' : state.mode.mode === 'regular' ? '常规' : '判断中（按常规时刻表兜底）'
        const basis = state.mode.basis === 'manual' ? '手动指定' : state.mode.basis ?? '还在推断'
        return `[ok] 当前模式：${label}（${basis}）。${state.mode.debugText()}`
      }
      if (!['auto', 'regular', 'turbo'].includes(value)) {
        return `[fail] mode 只能是 auto/regular/turbo，收到的是 ${value}。`
      }
      if (persist) persist({ mode: { force: value } })
      // 直接拍上去，不等设置对象回读（宿主的 cfg 是活引用，这里两条路都通）。
      state.mode.setForced(value === 'auto' ? null : value)
      const label = value === 'turbo' ? '加速' : value === 'regular' ? '常规' : '自动（恢复推断）'
      return `[ok] 模式已设为「${label}」，本局立即生效，设置里也存了（重启不变）。要回到自动判断，说一声或设回 auto。`
    },
  }

  return TOOL_DECLS.map((decl) => ({
    name: decl.name,
    description: decl.description,
    parameters: decl.parameters,
    tags: decl.tags,
    handler: handlers[decl.name],
  }))
}
