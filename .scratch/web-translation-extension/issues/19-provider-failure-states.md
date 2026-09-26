# 19 — 以可恢复状态处理供应商故障

**What to build:** 用户遇到网络、超时、限流、鉴权或配额问题时，可以看到准确且不过度重复的错误状态；扩展只对临时问题有限重试，对确定性错误停止自动调用，并允许适用的单块手动重试。

**Blocked by:** 17 — 在套餐和字符预算内调度可视翻译

**Status:** implemented-local（verify 与双轴复审已通过；未提交）

- [x] 脚本化 Fake Adapter 可按测试场景返回成功、慢响应、网络失败、超时、限流、鉴权/签名错误、余额/配额耗尽、不支持语言、无效参数和内容风险结果。
- [x] 网络、超时和临时服务异常最多自动重试两次，并采用逐次增加的等待；每次提交计入本地字符预算估算。
- [x] 限流结果进入受控等待，不触发所有文本内容块同时重试。
- [x] 鉴权/签名、余额/配额、不支持语言、内容风险和无效参数不会自动重试。
- [x] 可恢复的块级失败保留原文、显示简洁原因并提供单块重试。
- [x] 凭据无效、配额耗尽或服务不可用等供应商级故障暂停整页队列，并只显示一条顶部提示。
- [x] 关闭翻译、页面会话结束或错误升级为供应商级后，不再执行尚未提交的自动重试。
- [x] 诊断只记录脱敏错误类别、供应商错误码和时间，不记录正文、完整 URL、凭据、请求体或响应体。
- [x] 所有失败场景可用 Fake 稳定复现，自动测试不访问真实百度。

## 本地实施证据（2026-09-10）

- Fake 适配器按脚本顺序稳定模拟 success、slow 及九类脱敏供应商故障；生产默认仍是固定成功 Fake，不发出网络请求。
- 调度器对 NETWORK_ERROR、TIMEOUT、SERVICE_UNAVAILABLE 与 RATE_LIMITED 最多作两次递增退避重试。每次实际提交均重新经过长度、授权/可见 preflight、套餐 QPS/并发与预算预留；失败提交同样计入本地估算。
- RATE_LIMITED 共享 scheduler 级单飞 cooldown；恢复后所有重试重新通过 QPS、并发和预算门。取消、会话/授权预检失败、以及 provider scope 升级均会阻止尚未提交的重试。
- AUTHENTICATION_FAILED、PROVIDER_QUOTA_EXHAUSTED 和重试耗尽的 SERVICE_UNAVAILABLE 按 `tab/frame/documentId` 暂停；同页后续任务被阻止，其他 frame/tab 与导航后的新 document 不受影响。页面只显示一个顶部暂停提示，不在每块重复报错。
- 网络、超时与最终限流可手动重试；内容端为同一 blockId 创建新 requestId，重新计入预算。配额、不支持语言、无效参数和内容风险不自动重试。
- trusted service worker 的有界诊断仅保存 `{ category, providerCode?, occurredAt }`；供应商码采用安全格式白名单，非法时钟归一化，存储失败被吞没。不会持久化正文、译文、URL、凭据、请求/响应、错误 message 或 stack。
- 验证：`npm run verify` 通过（TypeScript、production build、Vitest 151/151、真实 dist 本地 Fake Playwright 2/2）；Standards/Spec 两轴最终复审清零。未访问真实百度或第三方站点，未提交。
