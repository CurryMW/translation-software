# 确定 API Key 与页面内容隐私边界

Type: grilling
Status: resolved
Assignee: Curry学长（Codex 协作）
Blocked by: 01

## Question

确定 API Key 与隐私边界：设置页如何配置服务和 Key，Key 存储与导出/清除行为是什么，扩展需要哪些 Chrome 权限，哪些原文会离开浏览器，日志是否允许保存，如何向个人用户解释“浏览器端 Key 不是真正保密”，以及未来后端代理迁移的接口边界。

## Comments

### 已核验事实

- Chrome 官方建议在功能允许时优先使用 `optional_permissions` / `optional_host_permissions`，让用户在运行时授予实际需要的网站权限；主机权限可用于向页面注入脚本，也会触发权限说明或警告。来源：[Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)、[chrome.permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)、[chrome.scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)。
- `chrome.storage.local` 是本机持久存储；即使用户清除浏览缓存和浏览历史，扩展存储仍可保留。Chrome DevTools 可以查看和编辑扩展存储，因此本地存放 API Key 不能被描述为加密保险箱。来源：[chrome.storage](https://developer.chrome.com/docs/extensions/reference/api/storage)、[Storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)。
- service worker 对第三方翻译 API 的跨域请求需要相应主机权限；内容脚本中的跨域请求仍受页面来源限制。来源：[Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)。

### 本轮建议

1. 网页读取权限按网站域名在用户首次启用时申请，不在安装时索取所有网站权限；只请求 `http/https` 网站，不支持 Chrome 内部页面。翻译服务域名作为独立、最小化的主机权限。
2. 个人 MVP 在设置页保存用户自己的 DeepL Key 到 `chrome.storage.local`，以密码框显示且不提供复制回显或导出；提供“测试连接”“替换”和“清除”。界面必须明示：本机持久存储，不等于安全加密存储。内容脚本永远拿不到 Key，由 service worker 读取和发送。
3. 仅向已选供应商发送用户确认翻译的当前可见文本块和语言参数；不发送整页、URL、页面标题、账号名或相邻上下文。不开启翻译、不确认切入提示或选择“暂不翻译”时不发送页面文本。
4. 不保存翻译历史、原文或 API 响应；持久诊断只记录不含内容的错误类别、供应商和时间，不记录 Key、请求头、原文、译文或完整 URL。提供“清除本地数据”，同时清除 Key、网站开关和诊断记录。
5. 未来公开发布时，翻译服务适配器接口保持不变，凭据与请求发送改到自有后端；当前 MVP 不实现后端、账号、密钥同步或导入导出。

以上仍是建议，待用户确认后才能作为 Answer；当前票据不代表功能已经实现。

### 最新用户反馈与百度 API 核验

- 用户确认 Q1、Q3、Q4：按网站申请网页权限；仅发送当前可视文本块及语言参数；不保存翻译内容，清除本地数据时删除凭据、设置与非内容日志。
- 用户针对 Q2 表示“可能会选择使用百度翻译的 API”。这使“DeepL Key”这一写死称呼失效，但“可能”尚不足以推翻已关闭的首发服务决策。
- 百度官方当前提供不同鉴权形态：通用文本翻译使用 APPID、密钥与请求签名；大模型文本翻译推荐 APPID 加 Bearer API Key，也兼容签名鉴权。来源：[通用文本翻译 API](https://fanyi-api.baidu.com/product/113)、[大模型文本翻译 API](https://fanyi-api.baidu.com/doc/21)。
- 百度的 API Key 管理页明确提示避免在浏览器或客户端代码中暴露 Key。来源：[百度 API Keys 管理](https://fanyi-api.baidu.com/manage/apiKey)。因此无论选择 DeepL 还是百度，浏览器端持久保存凭据均不能视为真正保密。

建议把 Q2 改写为供应商无关的规则：设置页保存“当前服务所需的凭据字段”，字段由翻译服务适配器定义；凭据只由 service worker 读取，不向内容脚本、日志、导出或明文回显暴露；本地保存风险提示、测试、替换和清除行为不变。

2026-09-07：用户已明确把首发服务从 DeepL 改为百度翻译。由于凭据字段取决于最终选择的百度接口，本票据解除认领并等待“在个人 Chrome MVP 中选择百度首发翻译接口”完成；此前已确认的网页权限、最小化发送和日志策略保留。

## Answer

用户确认网页权限、发送内容、日志与清除策略，并明确允许将百度通用文本翻译的 `APPID + 密钥` 持久保存在 `chrome.storage.local`，接受其并非加密保险箱的风险。最终边界如下：

1. **按网站申请权限**：用户首次在某网站启用翻译时申请相应 `http/https` 主机权限，不在安装时索取所有网站权限；不支持 Chrome 内部页面。百度 API 域名使用独立、最小化的主机权限。
2. **本机保存凭据**：设置页保存百度通用文本翻译的 `APPID + 密钥` 到 `chrome.storage.local`。密码字段不明文回显、不导出、不进入日志，提供测试、替换和清除操作，并明确提示本机存储并非安全加密存储。
3. **限制凭据接触面**：仅 service worker 读取凭据、计算签名并向百度发送请求；内容脚本和网页上下文不得获得 APPID、密钥、签名原串或认证请求头。
4. **最小化发送内容**：仅向百度发送用户确认翻译的当前可视文本块，以及接口必需的 `q`、`from`、`to`、`appid`、`salt`、`sign` 字段；密钥本身和签名原串绝不发送。不发送整页、页面 URL、标题、账号名或相邻上下文。网站未开启、切入提示未确认或选择“暂不翻译”时，不发送页面文本。
5. **不保存翻译内容**：不持久保存原文、译文、请求体、响应体或翻译历史。诊断只允许记录不含内容的错误类别、百度错误码和时间，不记录完整 URL。
6. **彻底清除**：“清除本地数据”同时移除 APPID、密钥、网站权限偏好/开关和诊断记录；扩展应说明撤销网站权限可能还需通过 Chrome 权限接口或扩展详情页完成。
7. **公开发布边界**：当前凭据方案仅适用于个人、解压加载的 MVP。未来公开发布时保留翻译服务适配器接口，但将签名和供应商请求迁移到自有后端；不把开发者凭据打包进扩展。

本票据解决的是产品与安全边界，不代表密钥已创建、百度服务已开通或代码已经实现。百度账户实际套餐与凭据有效性仍须在接入时验证。

### 实现澄清

真实 `APPID + 密钥` 不得写入源代码或 `manifest.json`，而应由用户在扩展设置页填写。`chrome.storage.local` 默认可由内容脚本访问，因此 service worker 初始化时必须将其访问级别设为 `TRUSTED_CONTEXTS`。这能排除内容脚本，但 Chrome 的权限粒度是“可信扩展上下文”，并非单脚本密钥库；“仅 service worker 读取”还需靠代码边界落实：其他扩展页面不得实现读取或回显凭据的路径。

来源：[Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)。
