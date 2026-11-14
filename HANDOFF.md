# 刀塔战况 · 交接

> 做到哪、下一步、环境事实、踩过的坑。设计在 `PLAN.md`，取舍在 `DECISIONS.md`。

## 做到哪了（2026-11-14 13:10）

**v0.1.2 已发到 npm**：`cortico-world-dota2-gsi@0.1.2`，MIT，23 个文件。仓库和装进 Coopanion 的 vendor 副本都是这一版；市场收录是异步的，搜不到要等。

- 0.1.1：换成 year 提供的大肥鱼娘化立绘（`design/icon-source.png`，不进包），`tools/make-icon.py` 按内容居中裁方、四角切圆、导出 512 和 128。0.1.0 的三条状态条图标已淘汰。
- 0.1.2：简介换成 year 定稿的那版（官方接口、事件推送、不做判断、能力边界、无三方风险），安装说明保留在后面。

上一轮已经真机跑通并修完的问题：

- 空格子的名字是 `empty`，原来被当成装备报了九次「买到 empty」。现在跳过空格子，且按真机结构分了身上 / 背包 / 中立 / 回城卷轴四个位置。
- 选人阶段 `hero` 段先出现、`id` 是 0，原来会念成「英雄 0」。现在当「还没有英雄」。
- 开局载入会出现一两帧没有 `map` 的报文，原来会误报一次「回到菜单」再报一次「对局开始」。现在掉出对局要持续 6 秒才确认，短暂空白只当没发生。
- 出兵前 `daytime` 从 false 翻成 true，原来会报「天亮了」，现在压掉。
- 中文语境里 `nevermore` 这类英文键名前面补了空格；「进入登场」改成「进入登场展示」。

**发布相关的文件**

- 图标 `assets/icon.png`（512×512，另有一张 128），由 `tools/make-icon.py` 从 `design/icon-source.png` 生成。
- 自描述 `describe.json`，由 `tools/build-describe.mjs` 从 `src/declarations.js` 和 `ENV_PROMPT.md` 生成；改了工具、事件或提示词要重跑一次。
- 市场详情页用的是 `package.json` 的 `description`，支持 Markdown；列表卡片用 `cortico.locales.*.description`。

**真机核对结果**

- 对得上的：`map`、`player`、`hero`、`abilities`（含 `ultimate` 标记）、`items`、`draft`、`buildings` 的结构和字段名基本如文档。
- 不一样的：`items` 的键是 `slot0`–`slot8` + `neutral0` + `teleport0`，另有 `stash*` / `preserved_neutral*`；物品数量字段是 `charges` / `item_charges`；`map` 这一版没有 `roshan_respawn_timer`；`buildings` 只发自己那一侧；`player.kill_list` 是杀过谁，不含击杀者。

## 下一步（按顺序）

1. **重启 Coopanion** 加载 0.1.2（vendor 已重装过）。
2. 在市场里搜一次「刀塔战况」或 `cortico-world-dota2-gsi`，确认收录；收录后可以把本地 link 安装换成市场安装。
3. 开一局再看一遍「最近的事件」：不该再有 `empty`、`英雄 0`、开局误报退赛、假天亮。
4. npm 上还留着一个 `0.0.0-stage` 的占位版本（发布过程的临时物）。要清掉得 `npm unpublish cortico-world-dota2-gsi@0.0.0-stage`，删东西前先问 year。
5. 观察一下画面卡顿：我们的负载是每秒 2 次、每次约 7 KB 的本地 POST，解析在 1 毫秒内，理论上不是原因。要证实可以在对局中量 Coopanion 的 CPU 占用，和关掉扩展时对比。

## 环境事实

| 项 | 值 |
|---|---|
| Dota 2 | `E:\Software\Steam\steamapps\common\dota 2 beta`（Steam 库里 appid 570，约 82 GB） |
| GSI 配置目录 | 上面那个路径下的 `game\dota\cfg\gamestate_integration\`，已存在，内含 Logitech 的 cfg |
| Steam 根 | `E:/software/steam`（注册表 `HKCU\Software\Valve\Steam` 的 `SteamPath`） |
| Steam 启动项 | 没设 `-gamestateintegration`（2026-11-13 查 `userdata\442519128\config\localconfig.vdf`） |
| 端口占用 | 3002 被 Logitech 的 GSI 占着；本扩展默认 35123 |
| Coopanion | 0.2.19，扩展目录 `E:\AI_Agent\Coopanion\data\extensions` |

## 踩过的坑

- 第一次启用后点扩展卡片报「页面不存在」，但 `/api/webui/manifest` 里这一页已经在。这是窗口的页面列表没刷新，`Ctrl+R` 重载后正常（面板本身没问题，服务端 invoke 一直是 200）。
- 从聊天附件复制出来的图带着只读属性，`fs.cpSync` 覆盖到 vendor 时报 `EIO, Access is denied`，安装脚本看起来像静默失败（vendor 还是旧版本）。装之前先 `Set-ItemProperty -Name IsReadOnly -Value $false`，或 `[IO.FileAttributes]::ReadOnly` 位清掉。
- `node --test` 会把 `test\` 目录下的所有 `.mjs` 都当测试跑。`e2e.mjs` 里用 `process.env.NODE_TEST_CONTEXT` 判一下，被扫到时什么都不做。
- 卡片和事件的测试时间戳用 `Date.now()` 造，别写死一个过去的时间；否则「15 分钟内的事件」会被过滤光。
- 同一帧里既有击杀又有比分变化时，比分事件会重复，已经按「有击杀/助攻/阵亡就不发比分」压掉。
- 终局帧（`POST_GAME`）里的数字是终局快照，别逐条补发升级、装备、比分，只发一条汇总。
- 菜单和已结束的局里，GSI 可能不再推数据，这时候没有报文是正常的，不能报「断线」。
- `DOTA_GAMERULES_STATE_DISCONNECT` 算「在局里」：它说明这一局没结束，只是客户端断了。

## 还没做

- 中文名表（`data\names.zh.json` 钩子已留，代码只读不写）。
- 图标、`describe.json`、npm 发布。
- 观战/教练模式的全玩家数据（等真机确认有没有）。
- 赛后落盘（第一版不存历史）。

## 交接记录

### 2026-11-13（第一版）

- 需求从「每秒推卡」改成「只推事件、卡现读」，按 year 的意见改了 PLAN 和 DECISIONS。
- 写完代码、测试、示例帧，装进 Coopanion，停在重启和真机验证之前。
