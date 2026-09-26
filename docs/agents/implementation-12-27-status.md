# 实施票据 #12–#27 本地集成记录

## 事实源与边界

- 执行日期：2026-09-09 起；最近 #24 诊断跟进为 2026-09-24
- 当前分支：`master`
- GitHub 仓库 `CurryMW/translation-software` 当前不存在 #12–#27。
- 用户已明确指定本次改用 `.scratch/web-translation-extension/issues/12-*.md`
  至 `27-*.md` 作为实施票据事实源。
- 本次自动化不执行 GitHub 远程写操作，不访问真实百度翻译服务；真实百度人工烟囱由用户在当前扩展设置页完成。
- 2026-09-25 用户明确变更产品要求：可读的英文导航、链接、按钮、侧栏与账号标签也应翻译；本轮在 #15 原安全排除矩阵之上追加该覆盖，表单输入、代码、扩展自身 DOM、图片/视频画面仍保持排除。

## 依赖基线

`12 → 13 → 14 → 15 → 16 → 17 → {18,19} → 20 → 21 → {22,23} → {24,25} → 26 → 27`

## 波次记录

| 波次 | 票据 | 负责人 | 执行方式 | 状态 | 集成证据 |
| --- | --- | --- | --- | --- | --- |
| 1 | #12 | `ticket_worker_12` | 单检出目录串行 | 已完成并集成；用户要求暂缓提交 | `npm run verify`：TypeScript 通过，构建通过，Vitest 9/9，Playwright 1/1 |
| 2 | #13 | `ticket_worker_13` | 单检出目录串行 | 已完成并集成；用户要求暂缓提交 | `npm run verify`：TypeScript 通过，构建通过，Vitest 28/28，Playwright 1/1；Chrome Stable 人工闭环通过 |
| 3 | #14 | `ticket_worker_14` | 单检出目录串行 | 已完成并集成；用户要求暂缓提交 | `npm run verify`：TypeScript 通过，构建通过，Vitest 45/45，Playwright 2/2；Spec 与安全复审清零 |
| 4 | #15 | `ticket_worker_15` | 单检出目录串行 | 已完成并集成；用户要求暂缓提交 | `npm run verify`：TypeScript、构建、Vitest 52/52、Playwright 2/2 通过；Spec 与 Standards 复审清零 |
| 5 | #16 | `ticket_worker_16` | 单检出目录串行 | 已完成并集成；用户要求暂缓提交 | `npm run verify`：TypeScript、production 构建、Vitest 93/93、Playwright 2/2 通过；Spec 与 Standards 终审清零 |
| 6 | #17 | `ticket_worker_17` | 单检出目录串行 | 已完成并集成；用户要求暂缓提交 | `npm run verify`：TypeScript、production 构建、Vitest 114/114、Playwright 2/2 通过；套餐/预算/可视调度公开行为测试通过，Standards/Spec 终审清零 |
| 7 | #18 | `ticket_worker_18` | 单检出目录串行 | 已完成并集成；用户要求暂缓提交 | `npm run verify`：TypeScript、production 构建、Vitest 123/123、Playwright 2/2 通过；长文本、页面复用与真实 dist 闭环通过，Standards/Spec 终审清零 |
| 8 | #19 | `ticket_worker_19` | 单检出目录串行 | 已完成并集成；用户要求暂缓提交 | `npm run verify`：TypeScript、production 构建、Vitest 151/151、Playwright 2/2 通过；供应商故障、受控重试、document scope 暂停与脱敏诊断通过，Standards/Spec 终审清零 |
| 9 | #20 | `ticket_worker_20` | 单检出目录串行 | 已完成并集成；用户要求暂缓提交 | `npm run verify`：TypeScript、production 构建、Vitest 164/164、Playwright 2/2 通过；动态可视内容、DOM 复用/移动、无轮询指标与真实 dist 闭环通过，Standards/Spec 终审清零 |
| 10 | #21 | `ticket_worker_21_terra_xhigh` | 单检出目录串行 | 已完成本地实施；用户要求暂缓提交 | `npm run verify`：TypeScript、production 构建、Vitest 176/176、Playwright 2/2 通过；文本稳定等待、provider 提交快照（含旧失败结果拒绝）、Fake 乱序和 SPA route cache reset/真实 dist pushState 数值闭环通过 |
| 11 | #22 | `ticket_worker_22` | 单检出目录串行 | 已完成本地实施；用户要求暂缓提交 | `npm run verify`：TypeScript、production 构建、Vitest 199/199、Playwright 2/2 通过；tab 前台确认、后台暂停、会话/目标语言门、同域全标签页关闭与真实 dist 双标签页数值闭环通过 |
| 12 | #23 | `ticket_worker_23` | 单检出目录串行 | 已完成本地实施；用户要求暂缓提交 | `npm run verify`：TypeScript、production 构建、Vitest 216/216、Playwright 2/2 通过；开放/嵌套 Shadow DOM、同源及获准跨域 frame、未授权 frame 安全跳过与真实 frame 卸载隔离闭环通过 |
| 13 | #24 | `ticket_worker_24` / 主 Agent 修复 | 单检出目录串行，Terra xhigh 双轴审查 | 真实人工 smoke 已通过；2026-09-22 在真实 `dist` 双确认流程复现并修复原生计时器 `Illegal invocation`，构建 0.0.3；用户要求暂缓提交 | 分项 TypeScript、production 构建、Vitest 342/342（42 files）通过；完整烟囱离线回归 2/2，全量 Playwright 最终独立运行 4/4；2026-09-24 用户设置页显示人工烟囱已通过；未提交 |
| 14 | #26 | `ticket_worker_26_terra_xhigh` | 单检出目录串行（用户明确授权在 #24 未通过时继续） | 本地实施完成，等待四站 Chrome Stable 人工验收；#24 真实人工 smoke 已通过 | `npm run verify` 通过：TypeScript、production 构建、Vitest 327/327（42 files）、Playwright 2/2；合成四站 fixture 与统一发现边界通过；未访问真实站点 |
| 15 | #27 | `ticket_worker_27_release_gate_terra_xhigh` | 单检出目录串行（用户明确授权在 #24 未通过时继续） | 已建立脱敏放行门、安装/配置/清除/费用/限制说明和 30 个固定样本索引；仍为 pending，不能交付 | `npm run release:gate` 输出 pending，样本组成 18/4/4/2/1/1 通过；真实百度 smoke 已通过，四站人工、Chrome Stable、清除本地数据和逐样本质量仍未验收 |

## 票据 #12 验收记录

- 可加载 MV3 产物：`dist/manifest.json` 使用 Manifest V3，设计兼容下限为 Chrome 120。
- UI 与核心边界：popup 与设置页使用 React；service worker、content script 和凭据控制为纯 TypeScript。
- 凭据行为：支持保存、替换和清除假 APPID/密钥；UI 仅显示是否已配置，不回显原文。
- 凭据隔离：service worker 设置 `TRUSTED_CONTEXTS`；真实 content script 行为测试证明无法读取已存凭据。
- 权限：manifest 仅有 `storage`，无全站权限、无百度 host permission、无远程脚本。
- 真实请求：本票据代码与 `verify` 均不访问真实百度。
- 评审：Standards 轴 0 项；Spec 轴首轮 2 项 P1，已由原负责人修复并经复审确认关闭，无未解决问题。

## 主 Agent 共享契约

- `src/shared/credentials.ts`：百度假凭据输入、配置状态与脱敏变更结果。
- `src/shared/messages.ts`：凭据、网站设置、页面会话和翻译任务的类型化消息协议。
- `src/shared/translation.ts`：翻译输入、输出、任务、结果和适配器公共接口；翻译消息不携带 URL。

## 已完成并集成

- #12：已通过票据验收、双轴评审和全量验证；按用户要求暂不提交。
- #13：自动验证、双轴评审及 Chrome Stable 人工闭环均通过；按用户要求暂不提交。
- #14：Fake 适配器、首个视口内显式静态块、200ms 可见加载、紧凑双语 React UI、单协调根、去重和样式隔离均通过；安全复审确认消息受 HTTP(S)、主机权限及域名开关约束，停止后旧响应不能复活 UI；按用户要求暂不提交。
- #15：七类静态阅读内容与完整排除矩阵通过公开内容发现接缝、真实构建 E2E、双轴复审和主 Agent 全量验证；按用户要求暂不提交。
- #16：网站目标语言、保守语言证据、同目标零调用、未知与误判的单块源语言纠正、当前标签页重扫和旧响应隔离均通过；production content bundle 从约 1.12MB 降至约 156KB，恢复稳定 200ms 门；按用户要求暂不提交。
- #23：开放及嵌套 Shadow DOM 发现、跨 Shadow host 的安全/可见性边界、按 frame 隔离的页面复用，以及获权 frame 的生产扩展闭环均通过；未授权 frame 保持零注入、零 DOM 读取、零正文消息；按用户要求暂不提交。

## 票据 #14 验收记录

- Fake 翻译服务适配器返回独立人工固定译文，无网络访问。
- content script 只选择首个视口内且通过最小安全资格检查的显式静态块；屏外、空、隐藏、链接、表单和编辑区零消息。
- 真实构建 E2E 从预授权后的 popup 用户开启动作贯穿 content script、service worker、Fake 适配器和页内 React UI；原生权限提示由 #13 Chrome Stable 人工记录覆盖。
- Shadow DOM 内可见加载节点在点击后 200ms 内出现；宿主原文不变，默认展开，可收起/展开且不重新调用适配器。
- 文档级单一 React 协调根通过 portal 管理译文；重复扫描不重复请求或插入，hostile 宿主 CSS 与浅/深主题均通过。
- Spec 与安全复审的所有 P1/P2 已由原负责人修复并经复审确认关闭。

## 票据 #15 验收记录

- `discoverStaticContentBlocks(document)` 是公开内容发现行为接缝；它返回候选、规范化原文与不含正文的跳过原因，content script 从同一接缝提交任务。
- 标题、正文、列表项、帖子、评论、图片说明和引用在本地 MV3 闭环中各显示一个可见 Fake 译文；页面只使用文档级单一 React 协调根。
- 导航、工具栏、原生菜单、按钮、页脚、广告、代码、表单、编辑区、用户名、链接（包括包裹式及大小写/多 token ARIA link）、隐藏/折叠/屏外内容和扩展 DOM 全部在发送前排除。
- 父子重叠只保留最小且完整的安全语义块；纯数字、标点、emoji 跳过，正常外语短语保留。节点身份与规范化原文共同去重，原文改变后复用容器并重新提交。
- 发现测试断言 fixture id 与跳过原因，不保存排除语料快照或日志；本地 E2E 仅使用 127.0.0.1 与 Fake Adapter。共享消息与翻译类型未变。
- Spec 与 Standards 两轴只读复审均通过；供应商失败/重试状态仍归 #19，动态新增扫描仍归 #20。

## 当前前沿

- #18、#19、#20、#21、#22、#23 已完成本地实施与完整 verify；#24 已在 0.0.3 修复导致 `RUN_INTERNAL_FAILURE` 的原生计时器调用错误，完整离线烟囱测试通过，并于 2026-09-24 由用户完成真实人工 smoke；#25 的兼容性安全实施、完整 verify 与 Terra xhigh 双轴复审已完成。根据用户明确授权，本地已继续实施 #26/#27：#26 已完成通用修复与合成 fixture，#27 已建立放行门与交付说明；最终 MVP 仍被 #26 四站人工验收及 #27 其他发布门槛阻断。
- 主 Agent 已固定适配器版本、长文本错误与脱敏供应商故障契约；普通功能实现继续采用单检出目录串行票据 Agent。

### #26/#27 本轮复审备注

- Spec 轴：#26 四站真实 Chrome Stable 验收仍未执行；#27 的 30 个固定样本仅有无正文索引，逐样本完整性、语义质量和性能证据仍未形成，因此不放行。
- Standards 轴：未发现 AGENTS/docs/agents 中的硬规范违反；记录一项低优先级判断性异味：`static-content-discovery.ts` 中代码块/省略文本的选择器组合存在重复，暂不扩展本票据范围。

## 票据 #16 验收记录

- 新网站默认简体中文，目标语言按 hostname 独立持久化；popup 只列出本地百度 MVP 契约的中、英、日、韩、西五种目标语言。
- 内容脚本通过 service worker 在主机权限及网站开关均有效时取得目标语言，不读取扩展存储；关闭网站后更改目标不会重启已停止会话。
- 固定语料覆盖英语、中文、日语、韩语、西班牙语、同目标、约 30% 混合阈值与无法归类片段；未知占主导时保守进入单块手动入口，不以任意拉丁字母冒充英语。
- 自动成功结果同样允许为当前文本内容块更正源语言并重试；其他块不受影响，同语言方向由内容层及 worker 双层拒绝。
- 切换目标语言仅通知当前标签页，清除旧译文并重新发现当前可视安全内容；代际与请求 ID 共同阻止旧响应回显。
- 启用链路采用同域 single-flight、注册快照恢复和设置/注册失败回滚；预检 API 失败稳定映射为可处理错误，不产生部分注入。
- production esbuild 启用 React production 分支与压缩，`content-script.js` 从约 1,123,074B 降至约 156,321B；真实构建 E2E 的加载状态保持在 200ms 门内。
- Spec 与 Standards 最终复审均清零；真实百度账户套餐和可用方向仍受用户边界约束，明确递延到 #24 的真实服务安全门。

## 票据 #17 验收记录

- trusted service worker 只持久化所选套餐、UTC 月度周期与提交的源字符计数；不持久化原文、译文、完整 URL、凭据或请求/响应体。
- 入队和 adapter 提交前均重新检查页面授权，并在提交前通过无正文 `translation.preflight` 校验原 tab/frame 的会话、节点规范化原文和当前可见性；`translation.cancel` 可从等待队列移除任务。
- scroll/resize 导致块滑出视口时，内容端移除等待任务并无正文取消；再次可见时重扫并按需排队。会话停止、撤权、取消与旧结果均受请求代际保护。
- 标准版明确 `maxConcurrency=1`、QPS=1，测试以可控时钟观察相邻 adapter 提交起点至少 1000ms；高级版只经显式套餐选择启用，提交限速在套餐等待期间切换后重新读取当前值。
- 本地预算在真实 adapter 提交边界以前按 Unicode 源字符预留，手动重试走同一提交边界；超限不调用 adapter，页面显示可到设置页调整的提示。并发预留、取消回滚和跨 UTC 月回滚均有本地行为测试。
- 设置页可选择套餐、编辑非负预算，并标为“本扩展估算”，明确不是百度官方账单、账户总用量或免费保证；UI 显示 UTC 周期。`npm run verify`：TypeScript、构建、Vitest 114/114、Playwright 2/2 通过；Standards/Spec 终审清零。

## 票据 #18 验收记录

- 长文本按段落、再按句子拆分；Unicode 计数的每个实际 adapter 请求均受当前套餐安全长度约束。不可拆原子句返回 `TEXT_TOO_LONG`，零预留、零 adapter 调用。
- 每个内部片段保留父 requestId/blockId，并重新经过授权、预检、QPS/并发和预算；父取消阻止等待片段。高级版跨父峰值并发为 10，标准版为 1。
- 成功结果仅按 documentId、段落拓扑规范化原文、语言、adapter id/version 在页面内存中复用；失败、导航、tab 关闭、documentId 更替或缺失均不复用，内容不持久化或日志输出。
- 真实 dist 本地 E2E 验证 content → handler → scheduler → Shadow UI 的单容器、三片合并与 `\n\n` 边界。`npm run verify`：Vitest 123/123、Playwright 2/2；Standards/Spec 终审清零；未访问真实百度、未提交。

## 票据 #19 验收记录

- 脚本化 Fake 覆盖成功、慢响应和九类供应商故障；默认 Fake 继续返回固定成功结果，自动化零真实网络调用。
- NETWORK_ERROR、TIMEOUT、SERVICE_UNAVAILABLE、RATE_LIMITED 最多三次实际提交；每次重新过 #17 预算/套餐门与无正文 preflight。RATE_LIMITED 使用全局单飞 cooldown，取消退避后不会新增提交或预算。
- 鉴权、配额及重试耗尽服务故障按 tab/frame/documentId 暂停，导航、frame、tab 均隔离；块级网络/超时/限流保留原文和手动重试，重试同 blockId、新 requestId。
- trusted worker 有界持久化仅含脱敏类别、可选安全供应商码和时间；存储失败不影响翻译，记录不含正文、译文、URL、凭据、请求/响应、message 或 stack。
- `npm run verify`：Vitest 151/151、Playwright 2/2；Standards/Spec 终审清零；未访问真实百度、未提交。

## 票据 #20 验收记录

- `MutationObserver` 仅对新增子树、最近受影响的可读祖先和移除节点维护候选索引；结构可见但屏外的内容块会被索引，只有 `IntersectionObserver`（`rootMargin: 0px`）及几何复核确认实际进入视口后才提交。
- 同一节点的文本拓扑变化、同步 remove→append 与虚拟复用都会取消旧在途任务、卸载旧 host、生成不串译的新身份；已成功的译文滑出视口仍保留，不会重复请求。
- 扩展 shell、translation host、React coordinator 和 provider notice 的新增/移除均被排除，静止页面不轮询或增加采样；指标仅发布扫描耗时、请求数、未完成队列深度、DOM 插入数与样本 P95 等数值。
- 控制器测试覆盖 mutation 批处理、重叠根、空 `p > span` 异步填充、自有 host 移除、rAF 合帧与节点移动；真实 production dist E2E 覆盖屏外延迟、替换/移动、连续动态追加、静止指标稳定，至少五个浏览器采样的 P95 ≤100ms。
- `npm run verify`：Vitest 164/164、Playwright 2/2；Standards/Spec 终审清零；仅使用 127.0.0.1 与 Fake Adapter，未访问真实百度、未提交。

## 票据 #15 风险记录

- 链接剔除后、没有终止标点的单词残段无法在未实现语言识别前可靠判断是否仍是完整语义。当前默认保留单词短语，但拒绝明确的多语言动作/连接引导词；这是避免“Read more”等残段的有限启发式，不是语言识别。
- #16 必须以目标语言、自动源语言识别和手动源语言入口取代这项静态启发式，并用英语、日语、韩语、西班牙语及混合语料回归；在此前不得把该规则扩展为站点特例或把被跳过内容自动提交。

## 票据 #23 验收记录

- 静态发现从根节点递归进入开放 ShadowRoot；嵌套开放 root 被发现一次，关闭 root 不可见即静默跳过。安全祖先和可见性判断沿 `ShadowRoot.host` 的 composed parent 继续，不会把 Shadow 内的隐藏、链接、表单、编辑区或扩展自身节点误当作可译内容。
- 动态控制器仅用递归 root 枚举建立 `MutationObserver`，每个本次受影响 root 只执行一次递归发现；没有轮询，也不会因 root 嵌套产生深度平方的重复扫描。composed descendant 判断覆盖 Shadow 子树失效和移除。
- 一个 tab 仅有一个前台 stay；子 frame 继承它且在等待时静默。顶层确认后 worker 向该 tab 已注入的 frame 广播许可描述符，晚加载的获权 frame 通过 settings 查询接入；single-flight 与每 tab epoch 防止并发 connect、暂停或撤权后的旧异步结果创建错误 stay。
- content-script 注册使用 `allFrames` 且仍由 host 匹配/权限约束。当前页注入先保证 top frame；`allFrames` 的原子失败或漏注入时仅在 worker 栈内枚举 frame、逐个检查 host 权限并补注入，单个 child 失败安全跳过，绝不回滚顶层。frame URL 不返回、不缓存、不持久化、不记录。
- `routeChanged` 只清 `tabId/frameId` 的页面复用；tab 删除和顶层导航才作 tab-wide 清理。生产 E2E 分别覆盖子 frame 的 SPA route 与实际 `iframe.src` 文档卸载：旧 frame 执行上下文销毁，迟到结果不会写入新 frame、顶层或 sibling。
- 本地 production E2E 使用普通 DOM、开放/嵌套/关闭 Shadow DOM、同源 frame、不同端口的获准 HTTP frame，以及开启前已存在的本地 HTTPS 未授权 frame。后者确证可加载却没有 content marker、译文 host 或正文提交；Canvas/图片文字同样没有扩展译文 UI。所有文本与 TLS 材料均为测试合成内容，适配器为 Fake。
- trusted storage 的访问级别初始化失败时，settings、翻译、凭据和注入协调全部 fail closed；worker 返回可呈现的不可用结果，初始化拒绝不会形成未处理 Promise。共享 `siteIdentity` 只产生 `domain`/`origin`，不会让完整 URL 越过安全边界。
- `npm run verify`：TypeScript、production 构建、Vitest 216/216、Playwright 2/2 通过；未访问真实百度或第三方网络，未创建 Git 提交或远程写入。修复后 Terra xhigh 双轴终审：Standards 0 项、Spec 0 项；#18 要求的同 document 进程内复用经复核保留，storage isolation fail-closed 为本轮明确追加验收。

## 票据 #24 验收记录

- 百度适配器仅在 service worker 读取凭据并通过 POST 发送最小六字段；MD5 签名、UTF-8 向量、错误映射、超时和请求取消均有独立单测。Fake Adapter 仍是默认自动化路径，自动 verify 不访问真实百度。
- 真实服务人工 smoke 使用固定无敏感文本（19 个源字符），必须先获得最小百度 host permission、再完成全部账户审查并准备一次性令牌，第二次明确点击才允许一次提交；令牌代次、恰好到期、凭据/套餐变更、权限撤销和共享 QPS 起点均有回归覆盖。
- 普通页面 Baidu runtime 只有人工 smoke 脱敏成功后才切换；凭据变更、预算/套餐变化及权限撤销会同步中止在途请求、清除 readiness 并回退 Fake。宽泛主机权限撤销按 fail-closed 处理。
- 2026-09-22 根因修复：默认 timer 直接复制原生方法导致 Chrome worker 的接收者错误；改为以 `globalThis` 调用。真实 production `dist` 双确认测试在修复前稳定重现 `RUN_INTERNAL_FAILURE` 且 transport 调用为 0，修复后成功和 `54001` 脱敏失败均通过。用量预留增加不能作为已向百度发送的证据。
- 0.0.3 分项验证：TypeScript、production 构建、Vitest 342/342（42 files），完整烟囱离线回归 2/2，全量 Playwright 最终独立运行 4/4（46.7s）。首轮并行验证时发生一次 60s 用例及 worker teardown 超时，原因未确定，保留在 #24 票据中；不能以再次通过掩盖该失败。2026-09-24 用户在设置页完成真实百度人工 smoke，页面显示人工烟囱已通过；本地累计估算提交 133 个源字符，不记录凭据或响应正文，票据状态为 `passed`。未创建 Git 提交或远程写入。

## 票据 #25 验收记录

- 块级安全边界与整页 opaque iframe/自定义元素回退均 fail-closed；页面回退先取消未完成任务、移除扩展 UI，再暂停当前 session，并通过无正文兼容性消息由 worker 清理 tab/frame/session scope。
- 兼容性 probe 只响应扩展-owned host 或其开放 Shadow DOM 的 mutation，检查 root overflow/scrollWidth、host/Shadow descendant 几何越界与宿主控件覆盖；普通宿主 mutation 不会被归因给扩展。导航期间用 sender documentId/frameId 防止旧 document 的迟到故障暂停新页面。
- 持久暂停区分手工与受管 storage，冷读 fail-closed、热读保留最近成功快照，维护操作不会复制/删除受管暂停；非法 selector 与非法受管 pause reason 也安全回退/阻断。站点特例每次动态扫描重算触发器，触发器消失时仅通用安全检查通过才恢复 generic。
- 限制清单同步提供于根仓库和打包 `static/KNOWN_LIMITATIONS.md`；诊断仅保留当前会话脱敏计数/类别，未写入正文、账号、完整 URL、截图或凭据。合成站点特例 fixture 与兼容性/消息/存储/探测回归场景均在本地覆盖。
- 本地验证：`npm run typecheck`、`npm run build`、Vitest 41 files/310 tests、Playwright 2/2（最近 `.last-run.json` passed）；Terra xhigh Spec/Standards 复审均为 P0/P1/P2 = 0。未访问真实百度或第三方网络，未创建 Git 提交。
