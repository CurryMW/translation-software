# 21 — 原文变化后拒绝过期译文

**What to build:** 用户展开帖子、页面改写文本或发生 SPA 导航时，旧译文会立即失效；扩展等待新文字稳定后仅重新翻译仍可见的内容，并拒绝任何属于旧页面、旧节点、旧原文、旧语言或旧供应商版本的乱序结果。

**Blocked by:** 20 — 翻译滚动与异步新增的可视内容

**Status:** implemented-local

- [x] 文本内容块发生变化时立即移除或标记旧译文失效，不继续把旧译文显示为当前内容结果。
- [x] 扩展等待文本短暂稳定后才重新排队，连续逐字变化不会产生连续供应商调用。
- [x] 结果写回前同时验证页面、节点、规范化原文、源语言、目标语言和供应商版本。
- [x] 任一版本不匹配、节点已分离或页面已导航时，结果被丢弃且不创建译文容器。
- [x] 原文 A 请求慢于更新后的原文 B 请求返回时，页面最终只显示 B 的译文。
- [x] 目标语言切换、网站开关关闭和供应商版本变化均使旧请求无法回写。
- [x] SPA 路由变化不会把前一路由缓存或译文容器复用到新页面。
- [x] 自动测试通过可编排 Fake 的乱序和延迟行为验证结果，不检查内部版本字段的实现形态。
- [x] 被丢弃结果不会被持久保存，也不会触发额外自动重试。

## 本地实施证据（2026-09-10）

- 受影响的候选根使用可注入 timer 的 200ms 稳定窗口；逐字更新立即卸载旧 UI，稳定后仅提交最终文本。稳定 timer 在 stop、路由、隐藏和移除时取消，且不写入扫描时长样本。
- 内容写回同时检查当前页面候选、节点连接性、规范化原文、源/目标语言、提交时 provider 快照、当前 session provider 和结果 adapter/version。不匹配结果会卸载 host 且不自动重试。
- SPA 使用 Navigation API 的 `navigate`，并覆盖 `popstate`/`hashchange`；无 URL/正文的 route reset 经后台确认后才重新获取会话设置。相同 documentId 的页面缓存会被清空。
- ActiveTranslation 在提交时复制 provider 身份；结果写回在成功、失败分支前均对比该快照与当前页面会话 provider，成功时再对比结果 adapter/version。provider、source 或 target 任一不一致都会卸载 loading host、清理 active/seen，且不自动重试。
- 注入等待的 Fake Adapter 场景可让 A 延迟、B 先完成；内容消息接缝只写回 B。旧 provider 的失败结果同样被丢弃，不渲染失败状态或重试入口。
- 真实 dist SPA 验证只从公开 usage 接缝读取 `submittedCharacters` 数字：同 documentId、同规范化文本先命中页内缓存而数值不变，随后 `history.pushState` 清空缓存并使新路由数值增长，证明再次跨过实际 adapter 提交边界。
- `npm run verify` 通过：TypeScript、production build、Vitest 176/176、真实 dist Playwright 2/2；仅使用 127.0.0.1 与 Fake Adapter，未访问第三方服务。
