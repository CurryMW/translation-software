# 12 — 加载安全的 React MV3 扩展骨架

**What to build:** 用户可以在 Chrome 中加载一个 TypeScript + React 的 Manifest V3 扩展，打开 popup 和设置页，并通过 service worker 安全地保存、替换和清除假凭据；该切片同时建立后续功能共用的构建、类型检查和零真实调用验证入口。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] 构建产物可在 Chrome 的开发者模式中作为未打包扩展加载，manifest 声明的设计兼容下限为 Chrome 120。
- [ ] popup、设置页、content script 和 Manifest V3 service worker 均可启动，React 只用于用户界面，核心运行逻辑保持为纯 TypeScript。
- [ ] popup 可以导航到设置页，并清楚显示扩展尚未配置真实翻译服务的状态。
- [ ] 设置页可以提交、替换和清除一组假 APPID/密钥，保存后只显示“已配置”状态，不回显密钥原文。
- [ ] 凭据操作通过类型化消息交给 service worker；content script 和网页上下文无法取得 APPID、密钥或保存操作的敏感载荷。
- [ ] service worker 初始化时将本地扩展存储限制为可信扩展上下文，并有自动测试证明 content script 不具备读取能力。
- [ ] 安装时不申请全站主机权限，也不包含任何真实百度凭据、远程脚本或真实翻译请求。
- [ ] 提供统一验证入口，至少执行类型检查、构建、纯逻辑/React 基线测试和加载真实构建产物的 Playwright 冒烟测试。
- [ ] Playwright 使用隔离的临时 persistent profile 和随附 Chromium，不复用用户日常 Chrome profile。
