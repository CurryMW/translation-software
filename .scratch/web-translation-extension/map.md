# Chrome 网页翻译扩展 MVP 路线图

## Destination

交付一个可以通过 Chrome“加载已解压的扩展程序”直接运行的个人版网页翻译 MVP：用户可在任意网页开启按域名记忆的自动翻译，保留原文并在可见阅读内容下方展示目标语言译文，同时处理动态新增内容、隐私、失败重试和可替换翻译服务。

## Notes

领域：Chrome Extension Manifest V3、网页内容识别与翻译体验。每次推进应查阅根目录 `CONTEXT.md`；涉及用户体验和范围的票据使用 grilling + domain-modeling，涉及第三方翻译服务事实的票据使用 research。本路线图覆盖从关键决策到 MVP 实现与验收；在前置决策未清晰前，不提前拆分实现任务。全部决策已聚合到 [Chrome 网页翻译扩展 MVP 规格](spec.md)，状态为 `ready-for-agent`。

## Decisions so far

- [在个人 Chrome MVP 中选择百度首发翻译接口](issues/01-translation-provider.md) — 首发改为百度通用文本翻译，优先个人高级版、标准版仅用于低并发验证；大模型接口保留为后续质量对照。
- [定义通用网页的可翻译内容边界](issues/02-content-boundary.md) — 按语义块处理可见阅读内容，所有链接文字和交互/编辑区域排除，采用当前页面内节点引用加原文哈希去重。
- [确认原文下方译文的呈现契约](issues/03-rendering-contract.md) — 用户选定 A「紧凑双语」：默认展开，保留收起与单块重试；原型分支归档待提交确认。
- [确定语言检测与目标语言策略](issues/04-language-policy.md) — 目标语言按网站记忆，切换时仅重译当前标签页可见内容，识别异常允许单块指定源语言后重试；算法仍待验证。
- [确定动态网页的增量翻译契约](issues/05-dynamic-processing.md) — 仅翻译可视区域，文字稳定后重译；每次切入已开启翻译的标签页先询问，确认前不新增请求。
- [确定 API Key 与页面内容隐私边界](issues/06-key-privacy.md) — 网页权限按网站申请；百度 APPID 与密钥允许本机持久保存且仅 service worker 使用；正文与凭据不进入持久日志。
- [确定翻译失败与调用成本控制策略](issues/07-failure-cost.md) — 本地预算约束自动调用，临时错误有限重试，长文本安全切分，缓存仅保留在当前页面，供应商级故障暂停整页队列。
- [定义跨网站 MVP 验收标准](issues/08-mvp-acceptance.md) — 用本地夹具、X、Wikipedia、GitHub、Hacker News 验证核心路径，设定时延、性能、质量、隐私阻断门槛与明确延期边界。
- [划分 MVP 实现阶段与集成顺序](issues/09-implementation-stages.md) — 采用 TypeScript + React，React 限定于扩展与网页内 UI，核心保持纯 TypeScript；按安全骨架、静态 Mock、任务编排、动态生命周期、百度适配器和总验收六个可运行切片推进。
- [设计 MVP 测试资产与验证方法](issues/10-test-assets.md) — 以 Vitest、React Testing Library、Playwright Chromium 和 Chrome Stable 人工检查构成四层验证，配套固定夹具/Fake、零真实调用的 `verify` 与脱敏验收证据。
- [制定 MVP 兼容性问题处置规则](issues/11-compatibility-triage.md) — 风险优先执行安全隔离、通用修复、必要站点特例和条件延期；高风险域名不可绕过暂停，修复按影响范围回归并维护已知限制。

## Not yet specified

- 无。MVP 的产品边界、服务选择、安全成本、实现阶段、测试资产和兼容性规则均已形成可执行决策。

## Out of scope

- Chrome Web Store 上架、账号体系、订阅计费和团队协作能力。
- 浏览器外的桌面/移动端客户端。
- 本地模型推理和完全离线翻译。
- 翻译搜索框、按钮、菜单、用户名等网站交互 UI（除非后续重新定义目的地）。
