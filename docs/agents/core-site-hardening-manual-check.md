# #26 核心站点人工检查记录

本记录只保存环境状态、数量、通过项和脱敏错误类别；不保存真实正文、译文、账号、完整 URL、截图或凭据。

- 日期：2026-09-21
- Chrome Stable：未执行（本次仅运行本地自动化；未要求用户提供账号或打开真实站点）
- 扩展版本：本地候选构建产物 `dist/`，未在当前 Chrome Stable 完成人工加载确认
- 依赖状态：#24 的真实百度人工 smoke 仍未通过；本记录不将其伪造为通过

| 网站类型 | 权限状态 | 应翻译块数量 | 通过项 | 脱敏错误 | 人工备注 |
| --- | --- | ---: | --- | --- | --- |
| X 信息流 | 未执行 | 0 | 无 | `BLOCKED_DEPENDENCY_24` | 未进行账号登录、连续滚动或虚拟列表人工观察 |
| 英文 Wikipedia | 未执行 | 0 | 无 | `BLOCKED_DEPENDENCY_24` | 未访问真实站点；正文/内嵌链接由本地合成夹具覆盖 |
| GitHub Issue/Discussion | 未执行 | 0 | 无 | `BLOCKED_DEPENDENCY_24` | 未访问真实站点；正文/代码边界由本地合成夹具覆盖 |
| Hacker News 评论 | 未执行 | 0 | 无 | `BLOCKED_DEPENDENCY_24` | 未访问真实站点；嵌套 `.commtext` 边界由本地合成夹具覆盖 |

## 本地可复现证据

- `tests/content/static-content-discovery.test.ts`：在统一内容发现接缝验证 X 文本锚点、Wikipedia 内嵌链接剔除、GitHub Markdown/代码边界和 Hacker News 嵌套评论；所有语料为合成占位文本。
- `tests/manual-fixtures/core-site-hardening.html`：四类站点结构的脱敏合成夹具；`scripts/manual-fixture-server.mjs` 可通过 `/core-site-hardening.html` 提供。
- 2026-09-22：修复 `<pre>` 候选与可读块嵌套仲裁的耦合引起的真实 dist loading 回归；现在代码块仅作为跳过诊断，全量 `npm run verify` 通过。
- 本次自动化不访问真实翻译服务、真实站点或用户数据。真实网站核心路径仍未完成，不能据此标记 #26 完成。
