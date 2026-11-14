/** 三个只读工具。名字、说明、参数来自 declarations.js，这里只挂处理函数。 */
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
  const { timezone = 'Asia/Shanghai' } = options

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
  }

  return TOOL_DECLS.map((decl) => ({
    name: decl.name,
    description: decl.description,
    parameters: decl.parameters,
    tags: decl.tags,
    handler: handlers[decl.name],
  }))
}
