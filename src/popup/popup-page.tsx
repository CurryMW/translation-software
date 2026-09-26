import { useEffect, useState } from "react";
import type { CredentialClient } from "../shared/credential-client";
import type { SiteStatus, SiteToggleClient } from "../shared/site-toggle-client";
import { BAIDU_MVP_LANGUAGES, type BaiduLanguageCode } from "../shared/languages";

export function PopupPage({
  client,
  siteClient,
  openOptions,
}: {
  client: CredentialClient;
  siteClient: SiteToggleClient;
  openOptions: () => void;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [site, setSite] = useState<SiteStatus | null>(null);
  const [siteError, setSiteError] = useState<string | null>(null);

  useEffect(() => {
    void client.status().then((status) => setConfigured(status.configured));
  }, [client]);

  useEffect(() => {
    const refresh = () => void siteClient.status().then(setSite).catch(() => setSiteError("无法读取此网站的授权状态"));
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [siteClient]);

  async function enable(): Promise<void> {
    const result = await siteClient.enable();
    if (!result.ok) {
      setSiteError(result.error === "PERMISSION_DENIED" ? "未获授权，未启用页面翻译" : "无法启用此网站翻译");
      return;
    }
    setSiteError(null);
    setSite(result.status);
  }

  async function disable(): Promise<void> {
    const result = await siteClient.disable();
    if (!result.ok) {
      setSiteError("无法关闭此网站翻译");
      return;
    }
    setSiteError(null);
    setSite(result.status);
  }

  async function setTargetLanguage(targetLanguage: BaiduLanguageCode): Promise<void> {
    const result = await siteClient.setTargetLanguage(targetLanguage);
    if (!result.ok) {
      setSiteError("无法保存此网站的目标语言");
      return;
    }
    setSiteError(null);
    setSite(result.status);
  }

  return (
    <main className="popup-page" aria-live="polite">
      <header className="page-header">
        <span className="brand-mark" aria-hidden="true">译</span>
        <div>
          <h1>网页翻译</h1>
          <p>让全球信息，触手可及。</p>
        </div>
        <button className="icon-button" type="button" aria-label="设置选项" onClick={openOptions}>⚙</button>
      </header>
      <p className="config-status" aria-live="polite">
        {configured === null ? "正在检查配置…" : configured ? "已配置翻译服务" : "尚未配置翻译服务"}
      </p>
      {site === null && siteError === null ? <p>正在检查网站授权…</p> : null}
      {siteError ? <p role="alert">{siteError}</p> : null}
      {site?.kind === "unsupported" ? <p>此页面不支持翻译</p> : null}
      {site?.kind === "not-authorized" ? (
        <section className="popup-card" aria-label="网站翻译">
          <div className="service-status service-status--pending">
            <span className="service-status__icon" aria-hidden="true">!</span>
            <div><strong>翻译服务未配置</strong><span>允许后即可翻译当前网站</span></div>
          </div>
          <div className="card-heading"><h2>此网站翻译</h2><span className="status-pill">此网站尚未授权</span></div>
          <button type="button" onClick={() => void enable()}>授权并开启此网站翻译</button>
        </section>
      ) : null}
      {site?.kind === "authorized" ? (
        <section className="popup-card" aria-label="网站翻译">
          <div className={`service-status ${site.settings.enabled ? "service-status--success" : "service-status--pending"}`}>
            <span className="service-status__icon" aria-hidden="true">{site.settings.enabled ? "✓" : "!"}</span>
            <div><strong>{configured ? "翻译服务已配置" : "翻译服务未配置"}</strong><span>{site.settings.enabled ? "此网站翻译已开启" : "此网站翻译已关闭"}</span></div>
          </div>
          <div className="card-heading"><h2>目标语言</h2><span className={`status-pill ${site.settings.enabled ? "status-pill--success" : ""}`}>{site.settings.enabled ? "已开启" : "已关闭"}</span></div>
          <label className="select-label" htmlFor="target-language">目标语言</label>
          <select
            id="target-language"
            value={site.settings.targetLanguage}
            onChange={(event) => void setTargetLanguage(event.target.value as BaiduLanguageCode)}
          >
            {BAIDU_MVP_LANGUAGES.map(({ code, label }) => <option key={code} value={code}>{label}</option>)}
          </select>
          <p className="selection-summary">目标语言：{BAIDU_MVP_LANGUAGES.find(({ code }) => code === site.settings.targetLanguage)?.label}</p>
          {site.settings.enabled ? (
            <button type="button" onClick={() => void disable()}>关闭此网站翻译</button>
          ) : (
            <button type="button" onClick={() => void enable()}>开启此网站翻译</button>
          )}
        </section>
      ) : null}
      <button className="primary-action" type="button" onClick={openOptions}>打开设置</button>
      <button className="settings-link" type="button" onClick={openOptions}><span>⚙ 设置</span><span aria-hidden="true">›</span></button>
    </main>
  );
}
