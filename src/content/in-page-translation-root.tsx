import { useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { TranslationOutput, TranslationProviderErrorCode } from "../shared/translation";
import { BAIDU_MVP_LANGUAGES, type BaiduLanguageCode } from "../shared/languages";
import { isTranslationTextColorId, translationTextColorOption, type TranslationTextColorId } from "../shared/translation-appearance";

interface Renderer {
  renderLoading(status?: "queued" | "active"): void;
  renderSuccess(output: TranslationOutput, onRetry?: (sourceLanguage: BaiduLanguageCode) => void): void;
  renderManualSourceLanguage(targetLanguage: BaiduLanguageCode, onRetry: (sourceLanguage: BaiduLanguageCode) => void): void;
  renderBudgetExhausted(onOpenSettings: () => void): void;
  renderTextTooLong(): void;
  renderFailure(error: string, onRetry?: () => void): void;
  renderPaused(): void;
  renderSkipped(): void;
  unmount(): void;
}

interface TranslationHost extends HTMLElement {
  __webTranslationRenderer?: Renderer;
}

interface TranslationEntry {
  id: number;
  slot: HTMLElement;
  state:
    | { kind: "loading"; status: "queued" | "active" }
    | { kind: "success"; output: TranslationOutput; onRetry?: (sourceLanguage: BaiduLanguageCode) => void }
    | { kind: "manual"; targetLanguage: BaiduLanguageCode; onRetry: (sourceLanguage: BaiduLanguageCode) => void }
    | { kind: "budget-exhausted"; onOpenSettings: () => void }
    | { kind: "text-too-long" }
    | { kind: "failure"; error: string; onRetry?: () => void }
    | { kind: "paused" }
    | { kind: "skipped" };
}

interface Coordinator {
  set(target: HTMLElement, entry: Omit<TranslationEntry, "id">): void;
  remove(target: HTMLElement): void;
  setTextColor(textColor: TranslationTextColorId): void;
}

interface TranslationDocument extends Document {
  __webTranslationCoordinator?: Coordinator;
}

interface TabSessionPromptHost extends HTMLElement {
  __webTranslationPromptRoot?: Root;
}

function TranslationView({ state, textColor }: { state: TranslationEntry["state"]; textColor: TranslationTextColorId }) {
  const [manualSourceLanguage, setManualSourceLanguage] = useState<BaiduLanguageCode>("en");
  const isSuccess = state.kind === "success";
  const color = translationTextColorOption(textColor);
  const selectableManualSource = (targetLanguage: BaiduLanguageCode) => (
    manualSourceLanguage === targetLanguage ? (targetLanguage === "zh" ? "en" : "zh") : manualSourceLanguage
  );
  return (
    <>
      <style>{`
        :host { all: initial !important; display: block !important; }
        .translation { color: ${color.light}; color-scheme: light dark; font: 14px/1.5 system-ui, sans-serif; margin: 0.55rem 0 0; padding: 0.55rem 0.75rem; border-left: 3px solid ${color.light}; background: color-mix(in srgb, ${color.light} 8%, transparent); border-radius: 0 0.45rem 0.45rem 0; }
        .translation__toggle { background: none; border: 0; color: #0969da; cursor: pointer; font: inherit; padding: 0; text-decoration: underline; }
        .translation__text { color: inherit; margin: 0; white-space: pre-wrap; }
        .translation__loading[data-status='queued'] { opacity: 0.72; }
        @media (prefers-color-scheme: dark) {
          .translation { color: ${color.dark}; border-left-color: ${color.dark}; background: color-mix(in srgb, ${color.dark} 11%, transparent); }
          .translation__toggle { color: #58a6ff; }
        }
      `}</style>
      <section className="translation" aria-live="polite" aria-label="网页翻译">
        {isSuccess ? <>
          <p className="translation__text">{state.output.translatedText}</p>
        </> : state.kind === "manual" ? <div className="translation__manual">
          <span>无法自动识别，请选择原文语言。</span>
          <label>原文语言
            <select aria-label="原文语言" value={selectableManualSource(state.targetLanguage)} onChange={(event) => setManualSourceLanguage(event.target.value as BaiduLanguageCode)}>
              {BAIDU_MVP_LANGUAGES.filter(({ code }) => code !== state.targetLanguage).map(({ code, label }) => <option key={code} value={code}>{label}</option>)}
            </select>
          </label>
          <button className="translation__toggle" type="button" onClick={() => state.onRetry(selectableManualSource(state.targetLanguage))}>翻译此内容块</button>
        </div> : state.kind === "budget-exhausted" ? <div><span>已达到本扩展估算的月度字符预算。</span><button className="translation__toggle" type="button" onClick={state.onOpenSettings}>打开设置并调整预算</button></div> : state.kind === "text-too-long" ? <span>此内容块包含无法安全拆分的超长句子，未发送翻译请求。</span> : state.kind === "failure" ? <div><span>{failureMessage(state.error)}</span>{state.onRetry ? <button className="translation__toggle" type="button" onClick={state.onRetry}>重试此内容块</button> : null}</div> : state.kind === "paused" ? null : state.kind === "skipped" ? <span>原文已是目标语言，无需翻译。</span> : <span className="translation__loading" data-status={state.status}>{state.status === "queued" ? "排队中…" : "正在翻译…"}</span>}
      </section>
    </>
  );
}

function failureMessage(error: string): string {
  if (error === "NETWORK_ERROR") return "网络连接失败，请检查网络后重试。";
  if (error === "TIMEOUT") return "翻译请求超时，请稍后重试。";
  if (error === "RATE_LIMITED") return "翻译请求过于频繁，请稍后重试。";
  if (error === "UNSUPPORTED_LANGUAGE") return "当前语言方向暂不支持。";
  if (error === "INVALID_REQUEST") return "此内容块暂时无法翻译。";
  if (error === "CONTENT_RISK") return "此内容块因安全原因未发送翻译。";
  return "翻译失败，请稍后重试。";
}

function providerFailureMessage(error: TranslationProviderErrorCode): string {
  if (error === "AUTHENTICATION_FAILED") return "翻译服务身份验证失败，已暂停本页翻译。请检查凭据后重新打开本页。";
  if (error === "PROVIDER_QUOTA_EXHAUSTED") return "翻译服务配额已耗尽，已暂停本页翻译。";
  return "翻译服务暂时不可用，已暂停本页翻译。请稍后重新打开本页。";
}

export function showProviderFailureNotice(error: TranslationProviderErrorCode): void {
  let host = document.querySelector<HTMLElement>("[data-web-translation-provider-notice]");
  if (!host) {
    host = document.createElement("div");
    host.dataset.webTranslationProviderNotice = "root";
    host.setAttribute("role", "status");
    host.attachShadow({ mode: "open" });
    document.documentElement.prepend(host);
  }
  const shadow = host.shadowRoot!;
  shadow.textContent = providerFailureMessage(error);
}

export function removeProviderFailureNotice(): void {
  document.querySelector("[data-web-translation-provider-notice]")?.remove();
}

function compatibilityFailureMessage(reason: "layout-breakage" | "scroll-breakage" | "interaction-breakage" | "unsafe-page"): string {
  if (reason === "unsafe-page") return "当前页面无法安全识别可翻译内容，已暂停本页翻译。";
  if (reason === "layout-breakage") return "检测到页面布局异常，已暂停本页翻译并恢复网页内容。";
  if (reason === "scroll-breakage") return "检测到页面滚动异常，已暂停本页翻译并恢复网页内容。";
  return "检测到页面交互异常，已暂停本页翻译并恢复网页内容。";
}

export function showCompatibilityNotice(reason: "layout-breakage" | "scroll-breakage" | "interaction-breakage" | "unsafe-page"): void {
  let host = document.querySelector<HTMLElement>("[data-web-translation-compatibility-notice]");
  if (!host) {
    host = document.createElement("div");
    host.dataset.webTranslationCompatibilityNotice = "root";
    host.setAttribute("role", "status");
    host.attachShadow({ mode: "open" });
    document.documentElement.prepend(host);
  }
  host.shadowRoot!.textContent = compatibilityFailureMessage(reason);
}

export function removeCompatibilityNotice(): void {
  document.querySelector("[data-web-translation-compatibility-notice]")?.remove();
}

function TabSessionPrompt({ onDecision, onClose }: { onDecision: (decision: "accept" | "reject") => Promise<boolean>; onClose: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const continueButton = useRef<HTMLButtonElement>(null);
  const decide = async (decision: "accept" | "reject") => {
    if (submitting) return;
    setSubmitting(true);
    try {
      if (await onDecision(decision)) onClose();
      else setSubmitting(false);
    } catch {
      setSubmitting(false);
    }
  };
  useEffect(() => { continueButton.current?.focus(); }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      void decide("reject");
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  });
  return <>
    <style>{`
      :host { all: initial !important; color-scheme: light dark; }
      .tab-session-prompt { background: #ffffff; border: 1px solid #d0d7de; border-radius: 0.5rem; box-shadow: 0 0.4rem 1.3rem rgba(31, 35, 40, 0.2); color: #24292f; font: 14px/1.5 system-ui, sans-serif; inset: 1rem 1rem auto auto; max-width: 22rem; padding: 1rem; position: fixed; z-index: 2147483647; }
      .tab-session-prompt__title { font-weight: 650; margin: 0 2rem 0.35rem 0; }
      .tab-session-prompt__body { margin: 0; }
      .tab-session-prompt__actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.8rem; }
      button { background: #f6f8fa; border: 1px solid #8c959f; border-radius: 0.3rem; color: inherit; cursor: pointer; font: inherit; padding: 0.35rem 0.65rem; }
      button[data-action='accept'] { background: #0969da; border-color: #0969da; color: #ffffff; }
      button[data-action='close'] { background: transparent; border: 0; font-size: 1.2rem; line-height: 1; padding: 0.1rem 0.35rem; position: absolute; right: 0.45rem; top: 0.45rem; }
      button:focus-visible { outline: 3px solid #0969da; outline-offset: 2px; }
      button:disabled { cursor: wait; opacity: 0.7; }
      @media (prefers-color-scheme: dark) {
        .tab-session-prompt { background: #161b22; border-color: #30363d; box-shadow: 0 0.4rem 1.3rem rgba(0, 0, 0, 0.45); color: #f0f6fc; }
        button { background: #21262d; border-color: #8b949e; }
        button[data-action='accept'] { background: #1f6feb; border-color: #1f6feb; }
        button:focus-visible { outline-color: #58a6ff; }
      }
    `}</style>
    <section className="tab-session-prompt" role="dialog" aria-modal="false" aria-label="本次停留翻译确认">
      <button type="button" data-action="close" aria-label="关闭本次翻译确认" disabled={submitting} onClick={() => void decide("reject")}>×</button>
      <p className="tab-session-prompt__title">是否继续翻译本次停留内容？</p>
      <p className="tab-session-prompt__body">继续后才会提交当前可见内容；暂不翻译会保留已有译文。</p>
      <div className="tab-session-prompt__actions">
        <button ref={continueButton} type="button" data-action="accept" disabled={submitting} onClick={() => void decide("accept")}>继续翻译</button>
        <button type="button" data-action="reject" disabled={submitting} onClick={() => void decide("reject")}>暂不翻译</button>
      </div>
    </section>
  </>;
}

export function showTabSessionPrompt(onDecision: (decision: "accept" | "reject") => Promise<boolean>): void {
  removeTabSessionPrompt();
  const host = document.createElement("div") as TabSessionPromptHost;
  host.dataset.webTranslationTabSessionPrompt = "root";
  const shadow = host.attachShadow({ mode: "open" });
  document.documentElement.append(host);
  const root = createRoot(shadow);
  host.__webTranslationPromptRoot = root;
  const close = () => removeTabSessionPrompt();
  flushSync(() => root.render(<TabSessionPrompt onDecision={onDecision} onClose={close} />));
}

export function removeTabSessionPrompt(): void {
  const host = document.querySelector<TabSessionPromptHost>("[data-web-translation-tab-session-prompt]");
  host?.__webTranslationPromptRoot?.unmount();
  host?.remove();
}

function CoordinatorView({ entries, textColor }: { entries: Iterable<[HTMLElement, TranslationEntry]>; textColor: TranslationTextColorId }) {
  return <>{[...entries].map(([, entry]) => createPortal(<TranslationView state={entry.state} textColor={textColor} />, entry.slot, entry.id))}</>;
}

function createCoordinator(): Coordinator {
  const coordinatorHost = document.createElement("div");
  coordinatorHost.hidden = true;
  coordinatorHost.dataset.webTranslationReactCoordinator = "root";
  document.documentElement.append(coordinatorHost);
  const root: Root = createRoot(coordinatorHost);
  const entries = new Map<HTMLElement, TranslationEntry>();
  let textColor: TranslationTextColorId = "adaptive";
  let nextEntryId = 1;
  let renderPending = false;
  const render = () => flushSync(() => root.render(<CoordinatorView entries={entries.entries()} textColor={textColor} />));
  const scheduleRender = () => {
    if (renderPending) return;
    renderPending = true;
    queueMicrotask(() => {
      renderPending = false;
      render();
    });
  };
  return {
    set(target, entry) {
      entries.set(target, { id: entries.get(target)?.id ?? nextEntryId++, ...entry });
      scheduleRender();
    },
    remove(target) { entries.delete(target); scheduleRender(); },
    setTextColor(next) {
      if (!isTranslationTextColorId(next) || textColor === next) return;
      textColor = next;
      scheduleRender();
    },
  };
}

export function setTranslationTextColor(textColor: TranslationTextColorId): void {
  coordinatorForDocument().setTextColor(textColor);
}

function coordinatorForDocument(): Coordinator {
  const translationDocument = document as TranslationDocument;
  const current = translationDocument.__webTranslationCoordinator;
  if (current && document.querySelector("[data-web-translation-react-coordinator]")) return current;
  const next = createCoordinator();
  translationDocument.__webTranslationCoordinator = next;
  return next;
}

export function mountInPageTranslation(target: HTMLElement): Renderer {
  const adjacent = target.nextElementSibling as TranslationHost | null;
  if (adjacent?.dataset.webTranslationTranslation === "root" && adjacent.__webTranslationRenderer) return adjacent.__webTranslationRenderer;
  const host = document.createElement("div") as TranslationHost;
  host.dataset.webTranslationTranslation = "root";
  const shadow = host.attachShadow({ mode: "open" });
  const slot = document.createElement("div");
  shadow.append(slot);
  target.insertAdjacentElement("afterend", host);
  const coordinator = coordinatorForDocument();
  let active = true;
  const render = (state: TranslationEntry["state"]) => coordinator.set(target, { slot, state });
  const renderer: Renderer = {
    renderLoading: (status = "active") => { if (active) render({ kind: "loading", status }); },
    renderSuccess: (output, onRetry) => { if (active) render({ kind: "success", output, onRetry }); },
    renderManualSourceLanguage: (targetLanguage, onRetry) => { if (active) render({ kind: "manual", targetLanguage, onRetry }); },
    renderBudgetExhausted: (onOpenSettings) => { if (active) render({ kind: "budget-exhausted", onOpenSettings }); },
    renderTextTooLong: () => { if (active) render({ kind: "text-too-long" }); },
    renderFailure: (error, onRetry) => { if (active) render({ kind: "failure", error, onRetry }); },
    renderPaused: () => { if (active) render({ kind: "paused" }); },
    renderSkipped: () => { if (active) render({ kind: "skipped" }); },
    unmount: () => {
      if (!active) return;
      active = false;
      coordinator.remove(target);
      delete host.__webTranslationRenderer;
      host.remove();
    },
  };
  host.__webTranslationRenderer = renderer;
  renderer.renderLoading();
  return renderer;
}

export function removeInPageTranslation(target: HTMLElement): void {
  const host = target.nextElementSibling as TranslationHost | null;
  host?.__webTranslationRenderer?.unmount();
}
