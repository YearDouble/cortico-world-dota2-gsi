# 测试

- `node --test` 跑全部单测。
- 合成夹具在 `data/sample-match.json`：一局从菜单到结束的合成帧序列（不是从真机录的，字段按 GSI 公开结构写）。面板的「喂一段测试数据」用的也是这一份。
- 真机夹具 `test/fixtures/real-probe.jsonl`：2026-11-15 探针样本裁剪的 10 帧（`sandbox/gsi-probe/` 是全量），带 ts 外壳、含 events 和 minimap 段，v0.2 管线回放和 e2e 用。
- 端到端脚本：`node test/e2e.mjs`，起接收器、按顺序 POST、打印每一条事件，末尾用真机帧回放一遍 v0.2 管线（名单、位置库、事件文本），人工读一遍像不像人话。
- 新增的 v0.2 测试文件：`minimap.test.js`（区域/名单/塔死）、`eventstream.test.js`（去重/字段语义/赏金符）、`idmap.test.js`（id 映射）、`fights.test.js`（团战/intel/肉山/建筑/kill_list 把关）、`v02.test.js`（state 全链集成：幻影清扫/名单稳定与更正/模式日志）、`mode.test.js`（模式推断/手动指定/赏金符）、`names.test.js`（中文名表与用户覆盖）。
- 合成 minimap 帧的构造器在 `helpers.js`（`heroFrame`/`fill`），形状按真机样本；`fill` 是为了凑「有效帧」元素数（黑窗判据），测塔死时别省。
