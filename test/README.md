# 测试

- `node --test` 跑全部单测。
- 夹具在 `data/sample-match.json`：一局从菜单到结束的合成帧序列（不是从真机录的，字段按 GSI 公开结构写）。面板的「喂一段测试数据」用的也是这一份。
- 真机报文到了之后，把真实帧另存一份，补一个 `test/fixtures/real-*.json` 做回归，别覆盖合成帧。
- 端到端脚本：`node test/e2e.mjs`，起接收器、按顺序 POST、打印每一条事件。
