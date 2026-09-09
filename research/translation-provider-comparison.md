# Chrome 网页翻译扩展：首发翻译服务研究

## 决策问题

为个人使用、可在 Chrome 中“加载已解压扩展程序”运行、面向尽可能多网页的 MVP 选择首发云翻译服务。扩展允许用户自行配置 API Key；代码应通过“翻译服务适配器”隔离供应商。

## 结论

首发建议接入 **DeepL API（同时保留适配器接口）**，备用选择 **Microsoft Translator**，并把浏览器直连明确标注为“个人版实验配置”：

1. 官方 HTTP API 直接提供文本翻译端点，调用模型简单，适合在扩展中先做一个适配器。
2. `api-free.deepl.com` 与 `api.deepl.com` 的区域端点区分清晰；免费计划有月度字符额度，便于控制个人成本。
3. DeepL API 要求在请求头中携带 `Authorization: DeepL-Auth-Key …`。Key 放在浏览器本地并不能保密，因此只适合个人使用；公开发布版本必须改为自有后端代理或用户自带 Key（BYOK），不能把开发者 Key 写进扩展。

Google Cloud Translation、Microsoft Translator 和 OpenAI 也可作为后续适配器，但它们的云项目/区域配置或通用大模型 API 鉴权使首版接入与成本控制更复杂。Microsoft 的 REST 形态和面向机器翻译的接口使其更适合作为备用；服务选择仍应可替换，不能把 DeepL 的请求格式泄漏到领域层。

## 官方资料与事实

### Chrome 扩展网络权限

- Manifest V3 扩展需在 `host_permissions` 声明要访问的来源；扩展页面（service worker、popup 等）可对声明的来源发起跨域 `fetch`。内容脚本仍受页面源的 CORS 限制，通常应由 service worker 代发请求。
- 参考：[Chrome Extensions — Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- 参考：[Chrome Extensions — Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)

因此翻译请求应走 service worker，并把供应商域名作为可审计的最小权限；不能让内容脚本直接把 API Key 发往第三方。

### DeepL API

- 文本翻译端点为 `POST https://api-free.deepl.com/v2/translate`（付费端点为 `https://api.deepl.com/v2/translate`）。请求使用 JSON 或表单字段 `text`、`target_lang` 等；响应返回 `translations` 数组。
- 认证使用 `Authorization: DeepL-Auth-Key <key>` 请求头。
- 官方提供 Usage API，可查询当前周期字符用量；应在适配器中保留错误码和配额耗尽状态，避免页面无限重试。
- 参考：[DeepL API documentation — Translate text](https://developers.deepl.com/docs/api-reference/translate)
- 参考：[DeepL API documentation — Authentication](https://developers.deepl.com/docs/the-basics/authentication)
- 参考：[DeepL API documentation — Usage](https://developers.deepl.com/docs/api-reference/usage)
- 参考：[DeepL API plans and limits](https://support.deepl.com/hc/en-us/articles/360020016159-DeepL-API-plans)

### Google Cloud Translation

- Cloud Translation Advanced 使用 `projects.locations.translateText` 等资源化 API；鉴权通常通过 OAuth 2.0 服务账号或 API key，并要求 Google Cloud 项目启用 API 与计费。
- 参考：[Cloud Translation — Translate text](https://cloud.google.com/translate/docs/advanced/translating-text-v3)
- 参考：[Cloud Translation — Authentication](https://cloud.google.com/translate/docs/authentication)
- 参考：[Cloud Translation pricing](https://cloud.google.com/translate/pricing)

它语言覆盖广，但项目、配额和凭据配置对个人扩展 MVP 偏重；若未来改为后端代理，可优先评估。

### Microsoft Translator

- Azure AI Translator 文本翻译 REST API 使用订阅密钥（`Ocp-Apim-Subscription-Key`）和区域（`Ocp-Apim-Subscription-Region`，区域资源适用）；端点为 `https://api.cognitive.microsofttranslator.com/translate`。
- 参考：[Azure Translator — Translate method](https://learn.microsoft.com/azure/ai-services/translator/reference/v3-0-translate)
- 参考：[Azure Translator — Authentication](https://learn.microsoft.com/azure/ai-services/translator/authentication)
- 参考：[Azure AI Translator pricing](https://azure.microsoft.com/pricing/details/cognitive-services/translator/)

区域头和 Azure 资源生命周期增加了首版配置成本；可作为第二供应商适配器。

### OpenAI API（不作为首发翻译后端）

- OpenAI API 使用 Bearer API key，官方明确要求不要在客户端代码或浏览器中暴露 key；请求应经由开发者自己的后端。
- 参考：[OpenAI API — Authentication](https://platform.openai.com/docs/api-reference/authentication)
- 参考：[OpenAI API — Production best practices](https://platform.openai.com/docs/guides/production-best-practices)

因此不应把开发者 OpenAI key 打包进 Chrome 扩展。若用户自行 BYOK，可在后续实验中提供 OpenAI 适配器，但需额外处理提示词、输出格式、速率限制和更高延迟。

## 对 MVP 的工程约束

1. 领域层只依赖统一接口，例如 `translate(text, targetLanguage, sourceLanguage?) -> {text, detectedSourceLanguage?}`。
2. service worker 负责供应商请求、超时（建议 15–30 秒）、指数退避和配额错误映射；内容脚本只传递单个文本内容块，不接触 Key。
3. Key 使用 `chrome.storage.local` 保存，并在设置页提供清除按钮；UI 明示“浏览器本地存储不等于安全保险箱”。
4. 默认只发送当前文本块原文，不保存翻译历史；请求日志不得写入原文或 Key。
5. 对动态网页使用去重缓存（内存或短生命周期），但不要把完整翻译历史持久化。

## 尚未决策

- 是否要求离线翻译（若要求，应另立本地模型/浏览器内置翻译研究票据）。
- 目标语言列表与自动检测策略（DeepL 的语言代码与 Google/Microsoft 不同，适配器需做映射）。
- 扩展公开发布时的凭据方案：自有后端、BYOK，还是仅限本地开发者模式。

## 实现前需要再次核验

- DeepL 免费计划在用户所在地区是否可注册、当期免费额度及速率限制；价格和配额是会变化的运营信息。
- DeepL、Google 和 Microsoft 当前的数据保留/训练政策与账户协议。官方 API 参考页能确认调用方式，但不能替代签约时的隐私条款核验。
- 目标语言清单是否完整覆盖用户实际需要的语言，以及各供应商对自动检测和语言变体（如繁体中文、葡萄牙语）的最新支持。
- 对候选服务做小规模实测：相同的 50–100 个网页文本块测量 P50/P95 延迟、翻译质量、限流响应和长文本行为。官方文档不能替代实际网络与质量基准。
