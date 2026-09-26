# 26 — 加固 X、Wikipedia、GitHub 和 Hacker News

**What to build:** 用户在当前 Chrome Stable 中访问 X 信息流、英文 Wikipedia 文章、GitHub Issue/Discussion 和 Hacker News 评论时，可以完成核心翻译流程且原网站保持可用；发现的通用问题或必要站点特例都留下不含真实正文的回归资产。

**Blocked by:** 24 — 接入百度通用翻译并通过真实服务安全门; 25 — 对高风险网站执行兼容性暂停和安全降级

**Status:** implemented-local-awaiting-human-and-#24

- [ ] 在当前 Chrome Stable 中使用与自动测试相同的候选构建产物执行四个网站的人工检查。
- [ ] 每个网站至少验证5个应翻译文本内容块及主要排除区域，不保存真实正文、译文、账号、完整 URL 或页面截图。
- [ ] 每站验证首次授权、切入确认、加载/成功/失败、滚动新增、原文变化、无重复、关闭停止和宿主页面不被破坏。
- [ ] X 连续滚动场景不会因虚拟列表复用导致错位译文、重复容器或失控请求。
- [ ] Wikipedia 的正文及内嵌链接排除规则、GitHub 的正文/代码边界、Hacker News 的嵌套评论边界符合统一内容规则。
- [ ] 可由合成通用夹具复现，或影响多个结构无关网站的问题必须优先通用修复并运行完整 `verify`。
- [ ] 只有通用修复会伤害其他网站且存在可靠语义锚点时才新增站点特例；特例必须有合成夹具和安全失效路径。
- [ ] 四个网站任一核心路径失败均阻断本票据完成，不能直接标记为“不支持”或明确延期。
- [ ] 检查记录只包含日期、Chrome/扩展版本、网站类型、权限状态、数量、通过项、脱敏错误和人工备注。

## 本地实施进度（2026-09-21）

- [x] 在统一内容发现接缝补充 X 信息流文本容器 `[data-testid='tweetText']` 与 Hacker News `.commtext` 评论容器；保留现有可见性、链接、代码、嵌套、去重和动态节点复用规则。
- [x] 将独立 `<pre>` 纳入安全跳过诊断，避免 GitHub 类代码块被误当正文；`pre` 仅用于诊断，不参与可读块嵌套仲裁，避免影响 Shadow/长文本调度。
- [x] 新增 `tests/manual-fixtures/core-site-hardening.html` 脱敏合成夹具，并由 `scripts/manual-fixture-server.mjs` 提供 `/core-site-hardening.html` 路径。
- [x] `tests/content/static-content-discovery.test.ts` 覆盖四类结构的候选与排除结果；未保存真实正文、URL、账号、截图或凭据。
- [x] 类型检查、生产构建、Vitest 与 Playwright 通过；完整 `npm run verify` 在 2026-09-22 通过（Vitest 42 files/327 tests，Playwright 2/2）。
- [ ] X、Wikipedia、GitHub、Hacker News 的当前 Chrome Stable 人工检查仍未执行；记录见 [`docs/agents/core-site-hardening-manual-check.md`](../../docs/agents/core-site-hardening-manual-check.md)。

### 当前阻断与安全边界

- #24 的真实百度人工 smoke 仍未通过；本票据不伪造 #24 通过，也不触发真实百度或真实网站请求。
- 四个真实网站的核心路径（首次授权、切入确认、加载/成功/失败、滚动新增、原文变化、无重复、关闭停止、宿主页面不破坏）尚无人工证据，因此本地实施不等同于 #26 完成。
- 本地合成夹具只验证通用内容边界：X 虚拟列表文本锚点、Wikipedia 内嵌链接剔除、GitHub 正文/代码边界和 Hacker News 嵌套评论；不声称真实站点 DOM 永久稳定。
