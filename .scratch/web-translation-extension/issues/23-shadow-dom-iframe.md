# 23 — 支持开放 Shadow DOM 和获准 iframe

**What to build:** 用户阅读使用开放 Shadow DOM 或 iframe 组织内容的页面时，扩展在权限和安全边界允许的范围内翻译可见文本内容块；无法访问或无法可靠判断的区域被明确跳过，不导致页面错误或误发内容。

**Blocked by:** 21 — 原文变化后拒绝过期译文

**Status:** implemented-local

- [x] 本地夹具覆盖普通 DOM、开放 Shadow DOM、嵌套开放 Shadow DOM、同源 iframe 和获准跨域 iframe 的支持路径。
- [x] 每个受支持上下文仍执行相同内容边界、可见性、去重、语言和过期结果规则。
- [x] iframe 未获对应权限时不读取、不注入、不发送正文，并以安全跳过处理。
- [x] 关闭 Shadow DOM、Canvas/图片文字、浏览器内置 PDF、Chrome 内部页和不可访问跨域 iframe 不会被误报为成功支持。
- [x] 一个上下文中的页面导航、卸载或异常不会把译文写入另一个 frame 或宿主页面错误位置。
- [x] 扩展在不支持区域附近仍不破坏宿主页面布局、滚动和交互。
- [x] 不支持情况使用简短可执行提示或静默块级跳过，不显示密集重复错误。
- [x] Playwright 在真实扩展环境验证 Shadow DOM、frame 权限和 content script 链路，jsdom 测试不作为替代证据。
- [x] 所有测试夹具使用合成内容，不复制真实网站正文。

本地验证：`npm run verify` 通过 TypeScript、production 构建、Vitest 216/216 与 Playwright 2/2。真实 dist E2E 仅使用 Fake Adapter、HTTP/HTTPS 的本地 `127.0.0.1` 合成夹具；既有的未授权 frame 在开启前即存在，验证其零 content marker、零译文 host 与零正文提交。未访问真实翻译服务，未创建 Git 提交或远程写入。
