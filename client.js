const ZH = {
  title: '实况',
  en: 'Live',
  intro: '游戏通过本机的端口把这一局的战况送过来。这里是 Coo 此刻能读到的卡片，和最近发生过的事。',
  waiting: '还没有收到数据。',
  write: '写入 Dota 配置',
  copy: '复制配置内容',
  raw: '复制原始帧',
  simulate: '喂一段测试数据',
  retry: '重试监听',
  confirmWrite: '会在 Dota 的 cfg 目录里写 gamestate_integration_coopanion.cfg，其他文件不动。继续？',
  wrote: '写好了',
  noPath: '没找到 Dota 目录',
  manual: '手动放这里：<Steam 库>\\steamapps\\common\\dota 2 beta\\game\\dota\\cfg\\gamestate_integration\\',
  copied: '配置内容已复制',
  copyFail: '复制没成功，可以点「写入 Dota 配置」看完整内容',
  simulated: '喂了',
  frames: '帧，产生',
  eventsWord: '条事件',
  retried: '重试完了',
  failed: '操作没成',
  conn: '连接',
  online: '正常',
  stale: '45 秒没数据',
  none: '还没收到',
  down: '端口没起来',
  match: '对局',
  noMatch: '不在局中',
  cfg: '配置',
  cfgOn: '已写入',
  cfgOff: '没写',
  cfgNone: '没找到目录',
  launch: '启动项',
  launchOn: '已设置',
  launchOff: '未设置',
  launchUnknown: '未知',
  mode: '模式',
  modeTurbo: '加速',
  modeRegular: '常规',
  modeUnknown: '判断中',
  recent: '最近的事件',
  noEvents: '还没有事件。',
  debug: '位置库调试（v0.2）',
  port: '端口',
  hint: 'Steam 里 Dota 2 的启动选项要加 -gamestateintegration，改完重启游戏。',
}

const EN = {
  title: 'Live',
  en: '',
  intro: 'The game pushes this match to a local port. This is the card Coo can read right now, plus the most recent changes.',
  waiting: 'No data yet.',
  write: 'Write Dota config',
  copy: 'Copy config text',
  raw: 'Copy raw frame',
  simulate: 'Feed test data',
  retry: 'Retry listener',
  confirmWrite: 'This writes gamestate_integration_coopanion.cfg into Dota\'s cfg folder and touches nothing else. Continue?',
  wrote: 'Written',
  noPath: 'Dota folder not found',
  manual: 'Drop it here by hand: <Steam library>\\steamapps\\common\\dota 2 beta\\game\\dota\\cfg\\gamestate_integration\\',
  copied: 'Config text copied',
  copyFail: 'Copy failed; use “Write Dota config” to see the full text',
  simulated: 'Fed',
  frames: 'frames, produced',
  eventsWord: 'events',
  retried: 'Retried',
  failed: 'That did not work',
  conn: 'Connection',
  online: 'online',
  stale: 'no data for 45s',
  none: 'nothing yet',
  down: 'port not open',
  match: 'Match',
  noMatch: 'not in a match',
  cfg: 'Config',
  cfgOn: 'written',
  cfgOff: 'missing',
  cfgNone: 'folder not found',
  launch: 'Launch option',
  launchOn: 'set',
  launchOff: 'not set',
  launchUnknown: 'unknown',
  mode: 'Mode',
  modeTurbo: 'Turbo',
  modeRegular: 'Regular',
  modeUnknown: 'guessing',
  recent: 'Recent events',
  noEvents: 'No events yet.',
  debug: 'Position tracker debug (v0.2)',
  port: 'port',
  hint: 'Add -gamestateintegration to Dota 2\'s Steam launch options, then restart the game.',
}

export default {
  panels: {
    live: {
      async mount(ctx) {
        const t = ctx.language === 'en' ? EN : ZH
        const { ui, root } = ctx
        const said = (error, fallback) => ui.toast(error?.message ?? String(error ?? fallback), 'bad')

        const sheet = ui.sheet({ title: t.title, en: t.en, desc: t.intro })
        root.append(sheet.el)

        const pills = ui.h('div', 'dg-pills')
        const note = ui.h('div', 'dg-note', '')
        const head = ui.h('div', 'dg-head')
        head.append(pills, note)
        sheet.body.append(head)

        const card = ui.h('pre', 'dg-card', t.waiting)
        sheet.body.append(card)

        const section = ui.h('div', 'dg-section', t.recent)
        const events = ui.h('div', 'dg-events')
        sheet.body.append(section, events)

        const debugSection = ui.h('div', 'dg-section', t.debug)
        const debug = ui.h('pre', 'dg-card', '')
        sheet.body.append(debugSection, debug)

        const toolbar = ui.rowbar()
        toolbar.append(
          ui.button(t.write, { variant: 'primary', onClick: onWrite }),
          ui.button(t.copy, { onClick: onCopy }),
          ui.button(t.raw, { onClick: onRaw }),
          ui.button(t.simulate, { onClick: onSimulate }),
          ui.button(t.retry, { onClick: onRetry }),
        )
        sheet.body.append(toolbar)

        function clear(node) {
          while (node.firstChild) node.removeChild(node.firstChild)
        }

        function pill(label, value, tone) {
          return ui.pill(`${label}：${value}`, tone)
        }

        function render(data) {
          clear(pills)

          const connection = data.connection
          const connTone = connection === 'online' ? 'on' : 'plain'
          const connText =
            data.receiverError ? t.down : connection === 'online' ? t.online : connection === 'stale' ? t.stale : t.none
          pills.append(pill(t.conn, connText, connTone))

          const matchText = data.inMatch ? `${data.phaseLabel ?? ''}${data.stats?.clock !== null && data.stats?.clock !== undefined ? ` ${data.stats.clock}` : ''}` : t.noMatch
          pills.append(pill(t.match, matchText, data.inMatch ? 'on' : 'plain'))

          const cfgText = !data.dota?.cfgDir ? t.cfgNone : data.dota?.cfgExists ? t.cfgOn : t.cfgOff
          pills.append(pill(t.cfg, cfgText, data.dota?.cfgExists ? 'on' : 'plain'))

          const launchText = data.dota?.launchOption === 'set' ? t.launchOn : data.dota?.launchOption === 'unset' ? t.launchOff : t.launchUnknown
          pills.append(pill(t.launch, launchText, data.dota?.launchOption === 'set' ? 'on' : 'plain'))

          // 模式（GSI 不发，是推断出来的）：把依据一起摆出来，一眼能看出这局按哪张表走。
          const modeValue = data.mode?.value ?? 'unknown'
          const modeLabel = modeValue === 'turbo' ? t.modeTurbo : modeValue === 'regular' ? t.modeRegular : t.modeUnknown
          const modeEvidence =
            data.mode?.basis === 'income' && data.mode?.incomeRate !== null
              ? `${data.mode.incomeRate}金/秒`
              : data.mode?.basis === 'creep' && data.mode?.creepBounty !== null
                ? `${data.mode.creepBounty}金/刀`
                : data.mode?.basis
          pills.append(pill(t.mode, modeEvidence ? `${modeLabel}（${modeEvidence}）` : modeLabel, modeValue === 'turbo' ? 'on' : 'plain'))

          const bits = [`${t.port} ${data.port}`]
          if (data.receiverError) bits.push(data.receiverError)
          else if (data.dota?.cfgFile) bits.push(data.dota.cfgFile)
          if (data.stats?.sections) {
            const marks = ['map', 'player', 'hero', 'abilities', 'items', 'buildings']
              .map((key) => `${key}${data.stats.sections[key] ? '✓' : '·'}`)
              .join(' ')
            bits.push(`收到 ${data.stats.received} 帧 · 字段 ${marks}${data.stats.avgIngestMs !== null && data.stats.avgIngestMs !== undefined ? ` · ${data.stats.avgIngestMs} ms/帧` : ''}`)
          }
          bits.push(t.hint)
          note.textContent = bits.join(' · ')

          card.textContent = data.card || t.waiting
          debug.textContent = data.auxDebug || '—'

          clear(events)
          if (!data.events || data.events.length === 0) {
            events.append(ui.h('div', 'dg-empty', t.noEvents))
          } else {
            for (const event of data.events) {
              const row = ui.h('div', 'dg-event')
              row.append(ui.h('span', 'dg-time', event.time), ui.h('span', 'dg-text', event.text))
              events.append(row)
            }
          }
        }

        async function refresh() {
          try {
            render(await ctx.invoke('status'))
          } catch (error) {
            card.textContent = `${t.failed}：${error?.message ?? error}`
          }
        }

        async function onWrite() {
          try {
            const ok = await ui.confirm({ title: t.confirmWrite })
            if (!ok) return
            const out = await ctx.invoke('writeConfig')
            if (out?.error) {
              ui.toast(`${out.error}${out.hint ? `。${out.hint}` : ''}`, 'bad')
              return
            }
            ui.toast(`${t.wrote}：${out.path}`, 'ok')
            await refresh()
          } catch (error) {
            said(error, t.failed)
          }
        }

        async function onCopy() {
          try {
            const out = await ctx.invoke('configText')
            await navigator.clipboard.writeText(out.text)
            ui.toast(t.copied, 'ok')
          } catch (error) {
            said(error, t.copyFail)
          }
        }

        async function onRaw() {
          try {
            const out = await ctx.invoke('raw')
            if (out?.error) {
              said(out.error, t.failed)
              return
            }
            await navigator.clipboard.writeText(out.text)
            ui.toast(t.copied, 'ok')
          } catch (error) {
            said(error, t.copyFail)
          }
        }

        async function onSimulate() {          try {
            const out = await ctx.invoke('simulate', ['sequence'])
            if (out?.error) {
              said(out.error, t.failed)
              return
            }
            ui.toast(`${t.simulated} ${out.frames} ${t.frames} ${out.events.length} ${t.eventsWord}`, 'ok')
            await refresh()
          } catch (error) {
            said(error, t.failed)
          }
        }

        async function onRetry() {
          try {
            const out = await ctx.invoke('retry')
            if (out?.error) said(out.error, t.failed)
            else ui.toast(t.retried, 'ok')
            await refresh()
          } catch (error) {
            said(error, t.failed)
          }
        }

        await refresh()
        ctx.interval(() => refresh(), 1500)
      },
    },
  },
}
