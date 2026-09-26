import { FormEvent, useEffect, useRef, useState } from "react";
import type { CredentialClient } from "../shared/credential-client";
import type { TranslationUsageClient } from "../shared/translation-usage-client";
import { BAIDU_PLAN_OPTIONS, type TranslationUsageSnapshot } from "../shared/translation-usage";
import type { BaiduManualSmokeClient } from "../shared/baidu-manual-smoke-client";
import type { BaiduProviderPermissionClient } from "../shared/baidu-provider-permission-client";
import type { BaiduAccountReview } from "../shared/baidu-manual-smoke";
import { TRANSLATION_TEXT_COLOR_OPTIONS, type TranslationTextColorId } from "../shared/translation-appearance";
import type { TranslationAppearanceClient } from "../shared/translation-appearance-client";
import type { SiteStatus, SiteToggleClient } from "../shared/site-toggle-client";
import { BAIDU_MVP_LANGUAGES, type BaiduLanguageCode } from "../shared/languages";

const EMPTY_REVIEW: Omit<BaiduAccountReview, "plan"> = {
  quotaAndPricingConfirmed: false,
  qpsConfirmed: false,
  languageDirectionsConfirmed: false,
  singleRequestLengthConfirmed: false,
  dataTermsConfirmed: false,
};

const SAFE_SMOKE_PROVIDER_MESSAGES: Readonly<Record<string, string>> = {
  AUTHENTICATION_FAILED: "百度鉴权失败，请核对 APPID、密钥和服务开通状态",
  NETWORK_ERROR: "无法连接百度翻译服务，请检查网络",
  TIMEOUT: "百度翻译服务响应超时",
  RATE_LIMITED: "请求频率受限，请按当前账户 QPS 稍后手动重试",
  PROVIDER_QUOTA_EXHAUSTED: "百度账户额度不足或已耗尽，请核对账户额度",
  UNSUPPORTED_LANGUAGE: "百度账户不支持本次语言方向",
  INVALID_REQUEST: "百度拒绝了固定测试请求，请核对接口产品与账号权限",
  CONTENT_RISK: "百度内容安全策略拒绝了固定测试请求",
  SERVICE_UNAVAILABLE: "百度翻译服务暂不可用",
};

export function OptionsPage({
  client,
  usageClient,
  manualSmokeClient,
  providerPermissionClient,
  appearanceClient,
  siteClient,
  buildVersion,
}: {
  client: CredentialClient;
  usageClient?: TranslationUsageClient;
  manualSmokeClient?: BaiduManualSmokeClient;
  providerPermissionClient?: BaiduProviderPermissionClient;
  appearanceClient?: TranslationAppearanceClient;
  siteClient?: SiteToggleClient;
  buildVersion?: string;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<TranslationUsageSnapshot | null>(null);
  const [plan, setPlan] = useState("standard");
  const [budget, setBudget] = useState("50000");
  const [usageError, setUsageError] = useState<string | null>(null);
  const [textColor, setTextColor] = useState<TranslationTextColorId>("adaptive");
  const [appearanceError, setAppearanceError] = useState<string | null>(null);
  const [appearanceSaved, setAppearanceSaved] = useState(false);
  const [siteStatus, setSiteStatus] = useState<SiteStatus | null>(null);
  const [review, setReview] = useState<Omit<BaiduAccountReview, "plan">>(EMPTY_REVIEW);
  const [smokeConfirmation, setSmokeConfirmation] = useState<{
    token: string;
    sourceCharacterCount: number;
  } | null>(null);
  const [smokeError, setSmokeError] = useState<string | null>(null);
  const [smokeSuccess, setSmokeSuccess] = useState(false);
  const [smokePending, setSmokePending] = useState<"prepare" | "run" | null>(null);
  const smokePendingRef = useRef(false);
  const smokeGenerationRef = useRef(0);

  function clearSmokeForConfigurationChange() {
    smokeGenerationRef.current += 1;
    setReview(EMPTY_REVIEW);
    setSmokeConfirmation(null);
    setSmokeError(null);
    setSmokeSuccess(false);
  }

  function invalidateSmokeConfirmation() {
    smokeGenerationRef.current += 1;
    setSmokeConfirmation(null);
    setSmokeError(null);
    setSmokeSuccess(false);
  }

  useEffect(() => {
    void client.status().then(status => setConfigured(status.configured));
  }, [client]);

  useEffect(() => {
    if (!usageClient) return;
    void usageClient
      .get()
      .then(result => {
        if (!result.ok) return setUsageError("无法读取本地预算，请重试。");
        setUsage(result.snapshot);
        setPlan(result.snapshot.settings.plan);
        setBudget(String(result.snapshot.settings.monthlyCharacterBudget));
      })
      .catch(() => setUsageError("无法读取本地预算，请重试。"));
  }, [usageClient]);

  useEffect(() => {
    if (!appearanceClient) return;
    void appearanceClient.get()
      .then(result => {
        if (!result.ok) return setAppearanceError("无法读取译文显示样式，请重试。");
        setTextColor(result.settings.textColor);
      })
      .catch(() => setAppearanceError("无法读取译文显示样式，请重试。"));
  }, [appearanceClient]);

  useEffect(() => {
    if (!siteClient) return;
    void siteClient.status().then(setSiteStatus).catch(() => setSiteStatus(null));
  }, [siteClient]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const result = await client.save({ appId, secret });
    if (!result.ok) {
      setError(
        result.error === "INVALID_CREDENTIALS" ? "请输入 APPID 和密钥。" : "无法保存凭据，请重试。"
      );
      return;
    }
    setConfigured(result.status.configured);
    setAppId("");
    setSecret("");
    clearSmokeForConfigurationChange();
  }

  async function clear() {
    setError(null);
    const result = await client.clear();
    if (!result.ok) {
      setError("无法清除凭据，请重试。");
      return;
    }
    setConfigured(result.status.configured);
    setAppId("");
    setSecret("");
    clearSmokeForConfigurationChange();
  }

  async function saveUsage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !usageClient ||
      !Number.isSafeInteger(Number(budget)) ||
      Number(budget) < 0 ||
      (plan !== "standard" && plan !== "advanced")
    ) {
      setUsageError("请输入非负整数形式的本地月度字符预算。");
      return;
    }
    const result = await usageClient.update({ plan, monthlyCharacterBudget: Number(budget) });
    if (!result.ok) return setUsageError("无法保存本地预算，请重试。");
    setUsage(result.snapshot);
    setUsageError(null);
    clearSmokeForConfigurationChange();
  }

  async function saveAppearance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!appearanceClient) return;
    const result = await appearanceClient.update({ textColor });
    if (!result.ok) {
      setAppearanceError("无法保存译文显示样式，请重试。");
      setAppearanceSaved(false);
      return;
    }
    setAppearanceError(null);
    setAppearanceSaved(true);
  }

  async function setTargetLanguage(targetLanguage: BaiduLanguageCode) {
    if (!siteClient || siteStatus?.kind !== "authorized") return;
    const result = await siteClient.setTargetLanguage(targetLanguage);
    if (result.ok) setSiteStatus(result.status);
  }

  function reviewInput(key: keyof Omit<BaiduAccountReview, "plan">, label: string) {
    return (
      <label className="checkbox-option" key={key}>
        <input
          type="checkbox"
          disabled={smokePending !== null}
          checked={review[key]}
          onChange={event => {
            setReview(current => ({ ...current, [key]: event.target.checked }));
            invalidateSmokeConfirmation();
          }}
        />
        {label}
      </label>
    );
  }

  function smokeMessage(error: string): string {
    if (error === "NOT_CONFIGURED") return "请先保存 APPID 和密钥。";
    if (error === "ACCOUNT_REVIEW_REQUIRED")
      return "请重新核对并保存当前套餐后，再勾选全部账户确认项。";
    if (error === "PERMISSION_REQUIRED") return "未获得百度服务所需权限，未发送任何请求。";
    if (error === "BUDGET_EXHAUSTED") return "本地字符预算不足，未发送任何请求。";
    if (error === "CREDENTIAL_STORAGE_FAILURE") return "人工烟囱未通过：无法读取后台凭据状态，请重新保存凭据后重试；未发送请求。";
    if (error === "USAGE_STORAGE_FAILURE") return "人工烟囱未通过：无法读取或更新本地预算状态，请重新加载扩展后重试；未发送请求。";
    if (error === "TOKEN_GENERATION_FAILURE") return "人工烟囱未通过：后台无法创建一次性确认令牌，请更新或重新加载 Chrome 后重试；未发送请求。";
    if (error === "PREPARE_INTERNAL_FAILURE") return "人工烟囱未通过：人工烟囱准备流程内部异常，请重新加载扩展后重试；未发送请求。";
    if (error === "USAGE_RESERVATION_FAILURE") return "人工烟囱未通过：无法预留本地用量；未发送请求。";
    if (error === "READINESS_STORAGE_FAILURE") return "人工烟囱未通过：百度请求已成功发送，但扩展无法保存通过状态；系统不会自动重试。";
    if (error === "RUN_INTERNAL_FAILURE") return "人工烟囱未通过：运行流程发生未分类异常，请勿立即重试；请求状态无法确认。";
    if (error === "WORKER_OPERATION_FAILURE") return "人工烟囱未通过：后台安全队列异常，请重新加载扩展后重试；未发送请求。";
    if (error === "STORAGE_FAILURE") return "人工烟囱未通过：扩展本地存储或后台服务异常，请重新加载扩展后重试；未发送请求。";
    if (error === "UNTRUSTED_SENDER") return "人工烟囱未通过：扩展页面来源不受信任，请从扩展详情重新打开设置页；未发送请求。";
    if (error === "UNAVAILABLE") return "人工烟囱未通过：扩展后台 service worker 尚未就绪，请重新加载扩展后重试；未发送请求。";
    if (error === "CONFIRMATION_EXPIRED" || error === "CONFIRMATION_USED")
      return "确认已失效，请重新准备；系统不会自动重试。";
    const providerMessage = SAFE_SMOKE_PROVIDER_MESSAGES[error];
    if (providerMessage)
      return `人工烟囱未通过：${providerMessage}；仅显示脱敏类别，系统不会自动重试。`;
    return "人工烟囱未通过；未显示服务端详情，系统不会自动重试。";
  }

  async function prepareSmoke() {
    if (!manualSmokeClient || !providerPermissionClient || smokePendingRef.current) return;
    // `request` is invoked inside ensure() before this handler awaits, keeping
    // Chrome's direct options-page user gesture intact.
    smokePendingRef.current = true;
    try {
      const generation = smokeGenerationRef.current;
      const permission = providerPermissionClient.ensure();
      setSmokePending("prepare");
      setSmokeError(null);
      setSmokeSuccess(false);
      setSmokeConfirmation(null);
      if (!(await permission)) {
        setSmokeError("未获得百度服务所需权限，未发送任何请求。");
        return;
      }
      const result = await manualSmokeClient.prepare({
        plan: plan === "advanced" ? "advanced" : "standard",
        ...review,
      });
      if (!result.ok) {
        if (generation !== smokeGenerationRef.current) return;
        setSmokeError(smokeMessage(result.error));
        return;
      }
      if (generation !== smokeGenerationRef.current) return;
      setSmokeConfirmation({
        token: result.confirmationToken,
        sourceCharacterCount: result.sourceCharacterCount,
      });
    } catch {
      setSmokeError("人工烟囱未通过；未显示服务端详情，系统不会自动重试。");
    } finally {
      smokePendingRef.current = false;
      setSmokePending(null);
    }
  }

  async function runSmoke() {
    if (!manualSmokeClient || !smokeConfirmation || smokePendingRef.current) return;
    smokePendingRef.current = true;
    setSmokePending("run");
    setSmokeError(null);
    setSmokeConfirmation(null);
    try {
      const generation = smokeGenerationRef.current;
      const result = await manualSmokeClient.run(smokeConfirmation.token);
      if (!result.ok) {
        if (generation !== smokeGenerationRef.current) return;
        setSmokeError(smokeMessage(result.error));
        return;
      }
      if (generation !== smokeGenerationRef.current) return;
      setSmokeSuccess(true);
    } catch {
      setSmokeError("人工烟囱未通过；未显示服务端详情，系统不会自动重试。");
    } finally {
      smokePendingRef.current = false;
      setSmokePending(null);
    }
  }

  return (
    <main className="settings-page">
      <div className="settings-shell">
        <aside className="settings-sidebar" aria-label="设置导航">
          <div className="sidebar-brand">
            <span className="brand-mark" aria-hidden="true">译</span>
            <div><strong>网页翻译</strong><span>让全球信息，触手可及</span></div>
          </div>
          <nav>
            <a className="settings-nav__item settings-nav__item--active" href="#translation-service">⚙ <span>翻译设置</span></a>
            <a className="settings-nav__item" href="#translation-appearance">◉ <span>译文显示样式</span></a>
          </nav>
        </aside>
        <div className="settings-content">
          <header className="page-header page-header--settings">
            <div>
              <h1>设置</h1>
              <p>配置网页翻译功能，让浏览更轻松。</p>
            </div>
          </header>
          {buildVersion ? <p className="build-version">扩展构建版本：{buildVersion}</p> : null}
          <section id="translation-service" aria-label="翻译服务">
            <div className={`service-status ${configured ? "service-status--success" : "service-status--pending"}`}>
              <span className="service-status__icon" aria-hidden="true">✓</span>
              <div><strong>{configured ? "已配置翻译服务" : "尚未配置翻译服务"}</strong><span>此网站翻译已开启</span></div>
              <span className={`status-switch ${configured ? "status-switch--on" : ""}`} aria-hidden="true"><span /></span>
            </div>
        <div className="card-heading">
          <h2>翻译服务状态</h2>
        </div>
        <p>凭据保存在本机扩展存储中，并非安全加密保险箱。保存后不会在此处回显。</p>
        <form onSubmit={save}>
          <label htmlFor="app-id">百度 APPID</label>
          <input
            id="app-id"
            disabled={smokePending !== null}
            value={appId}
            onChange={event => setAppId(event.target.value)}
            autoComplete="off"
            required
          />
          <label htmlFor="secret">密钥</label>
          <input
            id="secret"
            disabled={smokePending !== null}
            type="password"
            value={secret}
            onChange={event => setSecret(event.target.value)}
            autoComplete="new-password"
            required
          />
          <button type="submit" disabled={smokePending !== null}>
            保存凭据
          </button>
        </form>
        <button className="secondary-action" type="button" disabled={smokePending !== null} onClick={() => void clear()}>
          清除凭据
        </button>
          {error && <p role="alert">{error}</p>}
          </section>
          {siteClient ? (
            <section className="settings-card settings-card--language" aria-label="目标语言">
              <div className="card-heading"><h2><span className="section-icon" aria-hidden="true">◎</span>目标语言</h2></div>
              <select
                id="settings-target-language"
                aria-label="设置页目标语言"
                disabled={siteStatus?.kind !== "authorized"}
                value={siteStatus?.kind === "authorized" ? siteStatus.settings.targetLanguage : "zh"}
                onChange={event => void setTargetLanguage(event.target.value as BaiduLanguageCode)}
              >
                {BAIDU_MVP_LANGUAGES.map(({ code, label }) => <option key={code} value={code}>{label}</option>)}
              </select>
              <p>{siteStatus?.kind === "authorized" ? "当前网站目标语言" : "请先从当前网页打开插件弹窗，再设置目标语言。"}</p>
            </section>
          ) : null}
          {usageClient ? (
        <section className="settings-card" aria-label="套餐与本地预算">
          <h2>套餐与本地预算</h2>
          <p>以下用量是本扩展估算，不是百度官方账单、账户总用量或免费保证。</p>
          <p>
            {plan === "standard"
              ? "标准版页面请求按 QPS 1 串行。"
              : "高级版页面请求使用本地高级套餐限速；仍请以当前账户条款为准。"}
          </p>
          <form onSubmit={saveUsage}>
            <label htmlFor="baidu-plan">百度套餐</label>
            <select
              id="baidu-plan"
              disabled={smokePending !== null}
              value={plan}
              onChange={event => {
                setPlan(event.target.value);
                clearSmokeForConfigurationChange();
              }}
            >
              {BAIDU_PLAN_OPTIONS.map(option => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <label htmlFor="monthly-budget">本地月度字符预算</label>
            <input
              id="monthly-budget"
              disabled={smokePending !== null}
              type="number"
              min="0"
              step="1"
              value={budget}
              onChange={event => setBudget(event.target.value)}
            />
            <button type="submit" disabled={smokePending !== null}>
              保存本地预算
            </button>
          </form>
          {usage ? (
            <p aria-live="polite">
              UTC 月度周期 {usage.periodKey}：已估算提交 {usage.submittedCharacters} 个源字符，剩余{" "}
              {usage.remainingCharacters} 个。
            </p>
          ) : (
            <p>正在读取本地预算…</p>
          )}
          {usageError ? <p role="alert">{usageError}</p> : null}
        </section>
      ) : null}
          {appearanceClient ? (
        <section id="translation-appearance" className="settings-card" aria-label="译文显示样式">
          <div className="card-heading">
            <h2>译文显示样式</h2>
            <span className="status-pill">可自定义</span>
          </div>
          <p>选择译文文字颜色，保存后重新加载网页即可生效。</p>
          <form onSubmit={saveAppearance}>
            <fieldset className="color-picker" aria-label="译文文字颜色">
              <legend>译文文字颜色</legend>
              <div className="color-picker__options">
                {TRANSLATION_TEXT_COLOR_OPTIONS.map(option => (
                  <label className={`color-option ${textColor === option.id ? "color-option--selected" : ""}`} key={option.id}>
                    <input
                      type="radio"
                      name="translation-text-color"
                      value={option.id}
                      checked={textColor === option.id}
                      disabled={smokePending !== null}
                      onChange={() => {
                        setTextColor(option.id);
                        setAppearanceSaved(false);
                      }}
                    />
                    <span className="color-option__swatch" style={{ backgroundColor: option.light }} aria-hidden="true" />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="appearance-preview" style={{ color: TRANSLATION_TEXT_COLOR_OPTIONS.find(option => option.id === textColor)?.light }}>
              译文示例：这是一段译文预览。
            </p>
            <button type="submit" disabled={smokePending !== null}>保存译文样式</button>
          </form>
          {appearanceSaved ? <p role="status">译文样式已保存，刷新网页后生效。</p> : null}
          {appearanceError ? <p role="alert">{appearanceError}</p> : null}
        </section>
      ) : null}
          {manualSmokeClient && providerPermissionClient ? (
        <section className="settings-card" aria-label="真实服务人工烟囱">
          <h2>真实服务人工烟囱</h2>
          <p>
            这是独立人工检查：仅在你两次明确操作后发送内置无敏感短文本。它不会自动重试，也不会显示或保存请求、响应或译文正文。
          </p>
          <p>
            请先在当前账户中重新核对套餐、免费额度与计费、QPS、可用语言方向、单次长度和数据处理条款。
          </p>
          {reviewInput("quotaAndPricingConfirmed", "当前免费额度与计费条款")}
          {reviewInput("qpsConfirmed", "QPS")}
          {reviewInput("languageDirectionsConfirmed", "可用语言方向")}
          {reviewInput("singleRequestLengthConfirmed", "单次长度")}
          {reviewInput("dataTermsConfirmed", "数据处理条款")}
          {!smokeConfirmation ? (
            <button
              type="button"
              disabled={smokePending !== null}
              onClick={() => void prepareSmoke()}
            >
              {smokePending === "prepare" ? "正在准备人工烟囱测试…" : "准备人工烟囱测试"}
            </button>
          ) : (
            <>
              <p aria-live="polite">
                本次将提交 {smokeConfirmation.sourceCharacterCount} 个源字符。
              </p>
              <button
                type="button"
                disabled={smokePending !== null}
                onClick={() => void runSmoke()}
              >
                {smokePending === "run" ? "正在发送人工烟囱请求…" : "确认并发送一次人工烟囱请求"}
              </button>
            </>
          )}
          {smokeError ? <p role="alert">{smokeError}</p> : null}
          {smokeSuccess ? (
            <p aria-live="polite">人工烟囱已通过；重新确认当前标签页后，后续页面翻译将使用百度。</p>
          ) : null}
        </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
