# 票据 #13：Chrome Stable 人工验收

## 验收边界

- 日期：2026-09-09
- 浏览器：Google Chrome Stable 152.0.7977.83
- 扩展目录：仓库根目录下的 `dist`
- 页面：仅使用 `npm run manual:fixture` 提供的合成本地页面
- 禁止输入真实百度 APPID/密钥，禁止发起真实供应商请求

## 准备

1. 执行 `npm run build` 和 `npm run manual:fixture`。
2. 在 Chrome 打开 `chrome://extensions`，启用开发者模式，选择“加载已解压的扩展程序”，加载 `dist`。
3. 分别打开 `http://127.0.0.1:4173/` 和 `http://localhost:4173/`。

## 闭环检查

- [x] 在 `127.0.0.1` 页打开 popup：显示尚未授权；点击开启后接受权限请求，状态变为已授权且开启。
- [x] 刷新 `127.0.0.1` 页：设置仍为开启；在页面 DevTools 执行 `document.querySelector("[data-web-translation-extension-shell]")?.dataset.pageSession`，结果为 `idle`。
- [x] 在 `localhost` 页打开 popup：显示尚未授权；点击开启后拒绝权限请求，仍保持未授权；页面上不存在 `[data-web-translation-extension-shell]`。
- [x] 回到 `127.0.0.1` 页关闭翻译：popup 显示已授权且关闭；上述 `dataset.pageSession` 结果变为 `stopped`，宿主原文未改变。
- [x] 重新开启并刷新/新开 `127.0.0.1` 页，随后完全退出并重新启动 Chrome：popup 与页面仍表现为该域名已开启。
- [x] 在 Chrome 的扩展网站访问权限设置中撤销 `127.0.0.1` 权限：popup 恢复为未授权；刷新页面后不再注入扩展 shell。
- [x] 打开 `chrome://version` 后点击扩展图标：popup 显示当前页面不受支持，不出现授权或开启入口。
- [x] 全程 DevTools Network 中没有百度翻译或其他供应商请求，也没有真实凭据。

## 结果

状态：2026-09-09 经用户确认通过。
