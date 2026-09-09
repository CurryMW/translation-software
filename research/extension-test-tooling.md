# TypeScript + React 的 Chrome MV3 扩展测试工具边界

> 调研日期：2026-09-08  
> 范围：仅使用 Playwright、Chrome Extensions、Vitest、Testing Library 的官方文档；本文是工具可行性研究，不是已经执行过的测试结果。

## 结论

这套技术组合可行，但应明确分成三层，不能让某一层代替另一层：

1. **Vitest（Node 环境）**测试与浏览器无关的纯 TypeScript 逻辑，例如文本规范化、语言判断、任务状态机、分段、预算、错误分类、请求去重和过期结果判定。
2. **Vitest + React Testing Library + jsdom**测试 popup、设置页、页内提示和译文组件的用户可见状态与交互；`chrome.*` 依赖必须通过注入或 mock 隔离。
3. **Playwright + 随附 Chromium + 已构建的 `dist/`**测试真正的 Manifest V3 加载、content script 注入、页面内渲染、扩展页、消息链路与 service worker。

仍需在**当前正式版 Google Chrome**中人工验收安装、真实浏览器权限流程、工具栏入口、真实网站兼容性和视觉/性能体验。Playwright 的扩展自动化基线使用其随附 Chromium，并不能证明 branded Chrome Stable 或所有 Chrome 120+ 版本都兼容。

## 1. 单元测试：Vitest 的适用范围

Chrome 官方说明，脱离扩展 API 的代码可以在浏览器外正常进行单元测试；依赖扩展 API 的代码应使用 mock，并推荐通过依赖注入减少底层实现对 `chrome` 命名空间的依赖。虽然官方示例使用 Jest，这一原则并不绑定 Jest，可直接用于 Vitest。[Chrome：Unit testing Chrome Extensions](https://developer.chrome.com/docs/extensions/how-to/test/unit-testing)

因此建议把以下代码设计成纯 TypeScript，并在 Vitest 默认的 `node` 环境中测试：

- 文本筛选、规范化和 hash；
- 语言阈值和同语种跳过规则；
- 任务队列、并发、重试和退避；
- 字符预算计算；
- 长文本分段与顺序合并；
- 百度响应/错误映射（输入固定 fixture，不访问真实接口）；
- 页面、节点、文本、语言、供应商版本组成的过期结果判定；
- content script 与 service worker 之间的消息协议。

Vitest 当前默认环境是 `node`；`jsdom` 和 `happy-dom` 只是由 Node 中的包模拟浏览器 API，Browser Mode 则是另一种独立运行方式。[Vitest：Test Environment](https://vitest.dev/guide/environment.html)

**边界：**Vitest 单元测试不能证明真实的 `chrome.storage` 访问级别、host permission、content-script isolated world、扩展 CSP、MV3 service worker 生命周期或扩展能被 Chrome 加载。这些必须交给扩展 E2E 或人工验收。

## 2. React 组件测试：React Testing Library 的适用范围

React Testing Library 建立在 DOM Testing Library 上，面向真实 DOM 节点和用户可观察行为，而不是 React 组件实例；它本身不是测试运行器，可以配合 Vitest 使用。[React Testing Library：Introduction](https://testing-library.com/docs/react-testing-library/intro/)、[Testing Library：Guiding Principles](https://testing-library.com/docs/guiding-principles/)

建议用 `Vitest + @testing-library/react + @testing-library/dom + jsdom` 覆盖：

- popup 与设置页表单的标签、按钮、校验、保存/清除确认和错误提示；
- 译文组件的 loading、success、error、collapsed、manual-retry 状态；
- 标签页切回后的“是否翻译”提示组件；
- 键盘操作、可访问名称、焦点和基本 ARIA 状态；
- 使用注入的端口/适配器 mock 消息成功、拒绝授权、配额不足、超时等情形。

查询优先按角色、标签和用户可见文本；`data-testid` 只作为无法用语义定位时的退路。这与 Testing Library 的官方定位一致。[React Testing Library：Introduction](https://testing-library.com/docs/react-testing-library/intro/)

**边界：**jsdom 没有真实布局引擎，无法可靠验证元素实际可见区域、尺寸、滚动位置和浏览器排版。Vitest 官方也明确指出 jsdom 等模拟环境存在真实浏览器才能发现的缺口，例如缺少布局引擎。[Vitest：Comparisons with Other Test Runners](https://vitest.dev/guide/comparisons.html)

所以以下内容不应只靠 RTL/jsdom：

- `getBoundingClientRect()`、真实滚动和“只翻译可视区域”；
- `IntersectionObserver`/`MutationObserver` 与动态站点的组合行为；
- 样式隔离、站点 CSS 冲突、深浅色实际渲染；
- 页内 React root 与宿主页面 DOM 的插入位置；
- `chrome.*` 权限和 service worker 消息的真实行为。

Vitest Browser Mode 能在真实浏览器中运行、提供 Playwright provider，并在测试 UI 的 iframe 中执行组件测试；它适合补充真实布局的组件级测试，但它本身不是“加载未打包 MV3 扩展”的替代方案。[Vitest：Browser Mode](https://vitest.dev/guide/browser/)

## 3. 扩展端到端测试：Playwright 的硬性约束

### 3.1 必须使用 persistent context

Playwright 当前扩展文档明确写明：扩展只在 Chromium 以 persistent context 启动时工作。应使用 `chromium.launchPersistentContext(...)`，并通过以下启动参数加载构建产物：

```ts
args: [
  `--disable-extensions-except=${extensionPath}`,
  `--load-extension=${extensionPath}`,
]
```

官方示例使用 `channel: 'chromium'`；这也允许扩展在新 headless 模式下运行，也可以改为 headed 模式。[Playwright：Chrome extensions](https://playwright.dev/docs/chrome-extensions)

persistent context 使用专门的 user data directory；传空字符串可以创建临时目录。不要指向用户日常使用的默认 Chrome profile，Playwright 官方说明由于 Chrome 策略变化，这种自动化不受支持，可能导致页面不加载或浏览器退出。[Playwright：BrowserType.launchPersistentContext](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context)

### 3.2 扩展加载测试应使用 Playwright 随附 Chromium

这里存在一个容易混淆的点：Playwright一般网页测试确实支持 `channel: 'chrome'` 和 `channel: 'msedge'`，但其**扩展专用文档**明确指出 Google Chrome 和 Microsoft Edge 已移除用于命令行侧载扩展的参数，因此未打包扩展的 Playwright 测试应使用 Playwright 随附的 Chromium。[Playwright：Browsers](https://playwright.dev/docs/browsers)、[Playwright：Chrome extensions](https://playwright.dev/docs/chrome-extensions)

结论：

- 普通网页自动化可以用 branded Chrome；
- 本项目通过 `--load-extension` 加载 `dist/` 的 E2E 基线，使用随附 Chromium；
- 不把 `channel: 'chrome'` 作为自动侧载扩展的受支持路径；
- 当前 Chrome Stable 的扩展兼容性要另做人工验收。

### 3.3 如何取得 MV3 service worker 和扩展 ID

Playwright 官方示例先读取已有 workers；若尚未启动，则等待 `serviceworker` 事件：

```ts
let [serviceWorker] = context.serviceWorkers();
if (!serviceWorker) {
  serviceWorker = await context.waitForEvent('serviceworker');
}
const extensionId = serviceWorker.url().split('/')[2];
```

拿到扩展 ID 后，可以直接打开 `chrome-extension://${extensionId}/popup.html` 或设置页做自动化。Chrome 官方也确认扩展页可通过 `chrome-extension://<id>/...` URL 使用常规导航方法测试。[Playwright：Chrome extensions](https://playwright.dev/docs/chrome-extensions)、[Chrome：End-to-end testing for Chrome Extensions](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing)

MV3 worker 闲置后会被挂起并按需重启。Playwright 当前保持同一个 Worker 对象；重启后的新 `evaluate()` 会等待上下文恢复，但恰好在挂起瞬间已经执行中的调用可能抛出 `Service worker restarted`。因此 E2E fixture 要容忍这一明确的瞬态失败，且至少增加一次 worker 休眠/恢复场景。[Playwright：Chrome extensions](https://playwright.dev/docs/chrome-extensions)

### 3.4 自动化 E2E 应覆盖什么

应始终加载真正的构建目录而不是源码开发页。Chrome 对 E2E 的定义就是构建扩展包、将其加载进浏览器，再从用户行为验证结果。[Chrome：End-to-end testing for Chrome Extensions](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing)

用完全受控的本地 fixture 页面和 Mock 翻译服务自动覆盖：

- manifest 能加载、MV3 service worker 出现；
- 扩展页能打开，设置能保存，敏感字段不会在 UI 中回显；
- content script 对静态语义块进行筛选、插入译文且不重复；
- 可视区域、滚动进入/离开、MutationObserver 更新、原文变化后的旧译文清除；
- 标签页切回提示、接受/拒绝及后台页不发新请求；
- iframe/open shadow root 的受支持路径；
- host permission 已授予情况下的启用/禁用路径；
- service worker 消息链、Mock provider 成功/失败/超时/限流；
- popup/设置页可以直接用 `chrome-extension://...` URL 验证用户可见行为。

集成测试应优先断言用户能看到的状态，而不是扩展内部数组或私有变量；这是 Chrome 和 Playwright 官方共同建议。[Chrome：End-to-end testing for Chrome Extensions](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing)、[Playwright：Best Practices](https://playwright.dev/docs/best-practices)

## 4. 必须保留的人工验收

### 4.1 当前 Google Chrome Stable

以下项目应在用户实际安装的当前 Chrome Stable 中人工完成：

- 在 `chrome://extensions` 开启开发者模式并加载最终 `dist/`；
- 安装/重载后 manifest、service worker、popup、设置页均无错误；
- 从真实工具栏图标打开 popup，而不是只通过 popup URL；
- 首次启用网站时触发真实 optional host permission 提示，分别验证允许与拒绝；Chrome 要求权限请求发生在用户手势内，并可能显示浏览器原生确认框。[Chrome：chrome.permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- 验证浏览器设置页中的站点访问状态、撤销权限后的行为；
- 手工检查深色/浅色主题、字体缩放、长文本换行、焦点和键盘操作；
- 真实百度 API 的少量脱敏冒烟测试，以及断网、错误凭据、额度/限流错误的用户提示；
- service worker 挂起后再次使用扩展是否能正常恢复；
- 连续滚动 10 分钟时的主观卡顿、请求失控、重复译文和明显内存增长。

### 4.2 Chrome 120+ 的含义必须收紧

只在最新 Playwright Chromium 和当前 Chrome Stable 通过，不足以证明“每一个 Chrome 120+ 版本均已测试”。Playwright 每个版本绑定特定浏览器二进制，并持续升级到最新版本；`minimum_chrome_version` 只控制旧版能否安装，不会替开发者验证兼容性。[Playwright：Browsers](https://playwright.dev/docs/browsers)、[Chrome：Minimum Chrome Version](https://developer.chrome.com/docs/extensions/reference/manifest/minimum-chrome-version)

因此建议把验收表述拆开：

- **自动化基线：**锁定项目 Playwright 版本及其随附 Chromium，记录两者版本；
- **发布门槛：**当前公开 Chrome Stable 人工通过；
- **最低版本声明：**若 manifest 写 `minimum_chrome_version: "120"`，须逐项核对使用的 Chrome API 在 120 的可用性；如果无法取得隔离的 Chrome 120 环境做冒烟测试，应将其写成“设计兼容下限”，不能写成“已验证覆盖 120+”；
- **回归策略：**每次升级 Playwright 后重新安装其浏览器并运行扩展 E2E；Playwright 官方建议保持版本更新以覆盖新浏览器变化。[Playwright：Browsers](https://playwright.dev/docs/browsers)

### 4.3 真实网站只做人工/非阻断 smoke，不做稳定 CI 门槛

Playwright 官方建议不要把不受自己控制的第三方站点作为自动化依赖，因为页面内容、登录、弹窗和服务器状态都会变化，应尽可能用网络 mock 和受控数据。[Playwright：Best Practices](https://playwright.dev/docs/best-practices)

因此：

- CI 的阻断性 E2E 使用本地 fixture，模拟普通文章、信息流、嵌套列表、链接文本、动态加载、虚拟滚动、open shadow root 和 iframe；
- X、Wikipedia、GitHub、Hacker News 在当前 Chrome Stable 上做人工 smoke；
- 真实网站检查可以另设非阻断脚本辅助观察，但不应把其偶发网络/DOM变化直接判为本项目回归；
- X 是核心场景，人工 smoke 失败仍应阻止 MVP 验收，而不是因其属于第三方站点就自动豁免。

## 5. 推荐的最小测试矩阵

| 层级 | 工具/环境 | 主要对象 | 能否验证真实扩展能力 | 是否阻断提交/验收 |
|---|---|---|---|---|
| 纯逻辑单元 | Vitest / Node | 识别规则、状态机、队列、预算、错误映射 | 否 | 阻断提交 |
| React 组件 | Vitest + RTL / jsdom | popup、设置页、译文及提示组件 | 否，`chrome.*` 为 mock | 阻断提交 |
| 可选真实布局组件 | Vitest Browser Mode / Chromium | 少量依赖布局的 UI | 部分；不是扩展上下文 | 可按风险启用 |
| 扩展 E2E | Playwright persistent context + 随附 Chromium + `dist/` | MV3、content script、扩展页、消息链路、动态 DOM | 是 | 阻断提交/阶段完成 |
| Stable 人工验收 | 当前 Google Chrome Stable | 安装、真实权限/工具栏、真实 API、真实网站、视觉和体感性能 | 是，且最接近用户环境 | 阻断 MVP 验收 |
| 真实站点 smoke | 当前 Chrome Stable：X、Wikipedia、GitHub、Hacker News | 兼容性和站点 CSS/DOM | 是 | X 失败阻断；其余按既定兼容性规则分级 |

## 6. 对项目的直接建议

1. 采用 `Vitest + React Testing Library + jsdom` 作为快速单元/组件基线；不要为大多数 UI 测试引入真实浏览器成本。
2. 把 Chrome API 包在很薄的端口层后面，核心逻辑使用依赖注入；测试只 mock 用到的最小 API 表面。
3. 单独配置 `@playwright/test` 扩展 E2E fixture：每次从干净临时 persistent profile 加载真实 `dist/`，使用 `channel: 'chromium'`。
4. E2E 获取 service worker 后动态计算 extension ID；不要把开发机生成的 ID硬编码进常规测试。
5. CI 中不调用真实百度接口，也不依赖真实 X/Wikipedia/GitHub/Hacker News；用 Mock provider 与本地 fixture 保证确定性。
6. 每次 MVP 候选构建都在当前 Chrome Stable 上按人工检查表走一次；这一步不可由 Playwright 随附 Chromium代替。
7. 将“支持 Chrome 120+”拆成“API/构建目标兼容 120”和“当前 Stable 已验证”，避免把未经旧版本运行验证的范围表述成事实。

## 官方资料

- [Playwright：Chrome extensions](https://playwright.dev/docs/chrome-extensions)
- [Playwright：BrowserType.launchPersistentContext](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context)
- [Playwright：Browsers](https://playwright.dev/docs/browsers)
- [Playwright：Best Practices](https://playwright.dev/docs/best-practices)
- [Chrome：End-to-end testing for Chrome Extensions](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing)
- [Chrome：Unit testing Chrome Extensions](https://developer.chrome.com/docs/extensions/how-to/test/unit-testing)
- [Chrome：chrome.permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Chrome：Minimum Chrome Version](https://developer.chrome.com/docs/extensions/reference/manifest/minimum-chrome-version)
- [Vitest：Getting Started](https://vitest.dev/guide/)
- [Vitest：Test Environment](https://vitest.dev/guide/environment.html)
- [Vitest：Browser Mode](https://vitest.dev/guide/browser/)
- [Vitest：Comparisons with Other Test Runners](https://vitest.dev/guide/comparisons.html)
- [React Testing Library：Introduction](https://testing-library.com/docs/react-testing-library/intro/)
- [Testing Library：Guiding Principles](https://testing-library.com/docs/guiding-principles/)
