# 票据 #27：MVP 放行门槛与脱敏验收记录

## 当前结论

**状态：pending（不得交付为 ready）**

本记录只覆盖本地可重复的放行门槛、样本索引和验收表格。票据 #26 的本地通用修复已完成，但 X、英文 Wikipedia、GitHub Issue/Discussion 和 Hacker News 的真实网站人工验收仍保持 `blocked/pending`。仓库自动化不执行真实百度 smoke；用户已于 2026-09-24 在 0.0.3 设置页完成真实百度人工 smoke，不能据此推断官方账单或其他网站门槛已通过。

机器可执行的门槛定义位于 [`src/shared/mvp-release-gate.ts`](../../src/shared/mvp-release-gate.ts)，运行：

```bash
npm run release:gate          # 信息性检查：输出 pending，但不访问网络
npm run release:gate -- --strict  # 发布前检查：未全部 pass 时返回非零
```

默认 `release:gate` 不执行 `npm run verify`，也不触发真实百度或真实网站；它只校验样本组成和当前脱敏状态。完整本地自动化仍使用 `npm run verify`。

## 现有候选构建的门槛状态

| 检查 | 状态 | 证据/下一步 |
| --- | --- | --- |
| typecheck、build、Vitest、Playwright | `pass` | 2026-09-22 构建 0.0.3 分项检查：typecheck、production build、Vitest 42 files/342 tests、Playwright 最终独立运行 4/4。首轮有用例/进程退出超时，原因未确定，详见 #24 记录；未访问真实百度或第三方网站。 |
| 关键行为矩阵 | `pending` | 已有分层自动测试；尚未形成 #27 汇总记录。 |
| 30 个固定样本 | `pending` | 仅完成无正文 ID 索引，逐样本结果待填写，见[样本索引](27-mvp-sample-index.md)。 |
| 加载/首条译文/扫描 P95 | `pending` | 由本地动态夹具记录中位数、P95、静止后请求和扫描计数。 |
| X 十分钟滚动与内存体感 | `pending` | 必须由用户在当前 Chrome Stable 人工执行。 |
| 隐私与清除本地数据 | `pending` | 自动化覆盖凭据隔离和脱敏；完整清除链路仍需候选构建验收。 |
| Chrome Stable 扩展页验收 | `pending` | #13 只证明本地合成夹具，不等同于 #27 候选版本最终验收。 |
| 真实百度 smoke | `pass` | 2026-09-24 用户在 0.0.3 设置页完成真实百度人工 smoke，页面显示人工烟囱已通过；本地显示累计估算提交 133 个源字符，不作为百度官方账单或请求次数。 |
| 四个核心真实网站 | `blocked` | #26 本地修复已有，但四站 Chrome Stable 人工核心路径尚未执行；任一核心路径失败都阻断放行。 |

## 自动化门槛

发布前必须在干净的 `dist/` 候选上运行：

```bash
npm run verify
npm run release:gate -- --strict
```

自动化证据只记录测试名称、通过/失败、耗时、计数、脱敏错误类别、浏览器/扩展版本。不要保存真实网站 HTML、正文、译文、完整 URL、账号、请求/响应体、截图或凭据。失败时先记录环境和脱敏类别，再分类为代码回归、测试缺陷或外部变化；不得靠重复运行掩盖失败。

## 人工验收记录（模板）

人工记录采用下列字段，正文和凭据字段必须留空：

```text
日期：YYYY-MM-DD
Chrome Stable 版本：
扩展构建标识（仅版本/哈希）：
网站类型：local-fixture | X | Wikipedia | GitHub | Hacker News
权限状态：未授权 | 已授权 | 已撤销
应翻译块数量：
成功/失败/跳过数量：
重复容器：0 | >0
关闭后新增请求：0 | >0
页面破坏：无 | layout-breakage | scroll-breakage | interaction-breakage
脱敏错误类别：无 | AUTHENTICATION_FAILED | PROVIDER_QUOTA_EXHAUSTED | ...
备注（不得包含正文、译文、账号或完整 URL）：
结论：pending | pass | blocked
```

四站检查必须逐站至少观察 5 个应翻译文本内容块和主要排除区域，并覆盖首次授权、切入确认、加载/成功/失败、滚动新增、原文变化、无重复、关闭停止和宿主页面不被破坏。没有用户本人记录前，四站状态保持 `pending`，不能用本地 fixture 代替。

## 真实百度 smoke 的边界

真实烟囱仅能由用户从设置页显式执行：先重新核对当前账户的套餐、配额/计费、QPS、语言方向、单次长度和数据条款；再勾选确认、显示不超过 300 个源字符的固定无敏感短文本，并第二次点击发送一次。系统不自动重试，不显示或保存正文/响应。`npm run verify` 和 `npm run release:gate` 都不得访问百度。

用户已完成该操作，真实服务门槛可记录为 `pass`；但自动化仍不得访问百度，且本地累计字符数不能推断官方账单、请求次数或套餐费用。

## 发布阻断规则

- #26 的四站真实人工核心路径未完成时，#27 最终状态必须是 `pending`。
- 真实百度 smoke 未完成时，真实服务门槛必须是 `pending`，不能以 Fake Adapter 证据替代；本次用户人工结果已将该门槛置为 `pass`。
- 四站任一核心路径失败时，按阻断级问题处理；不能改写为“不支持”或无证据的“明确延期”。
- 任一隐私、凭据、页面破坏或费用失控风险未隔离时，不得发布解压扩展。
