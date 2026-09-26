import { SITE_MESSAGE_TYPES, TRANSLATION_MESSAGE_TYPES, isTranslationPreflightMessage, type PageSessionDescriptor, type PageSessionIdentity, type PageSessionMessage, type PageSessionSettingsResult, type TranslationMessageResponse } from "../shared/messages";
import { isBaiduLanguageCode, isBaiduMvpDirection, type BaiduLanguageCode, type TranslationSourceLanguage } from "../shared/languages";
import { isTranslationAppearanceSettings, type TranslationTextColorId } from "../shared/translation-appearance";
import { discoverFirstStaticContentBlock, discoverStaticContentBlocksWithin, isPotentialStaticContentBlock, type StaticContentBlockCandidate } from "./static-content-discovery";
import { mountInPageTranslation, removeInPageTranslation, removeCompatibilityNotice, removeProviderFailureNotice, removeTabSessionPrompt, setTranslationTextColor, showCompatibilityNotice, showProviderFailureNotice, showTabSessionPrompt } from "./in-page-translation-root";
import { classifyStaticContentLanguage } from "./language-policy";
import { TRANSLATION_PROVIDER_ERROR_CODES, type TranslationAdapterId, type TranslationAdapterVersion, type TranslationProviderErrorCode } from "../shared/translation";
import { DynamicVisibleContentController, type DynamicContentCandidate } from "./dynamic-visible-content-controller";
import { isTopLevelContentFrame } from "./frame-context";
import { createCompatibilityDiagnostics } from "./compatibility-diagnostics";
import { createCompatibilityProbe } from "./compatibility-probe";
import { createPageCompatibilityGuard, type PageCompatibilityFailure } from "./page-compatibility-guard";
import { createSiteExceptionRegistry, siteExceptionRecordForDocument, siteExceptionStrategyForDocument } from "../shared/site-exception-registry";

const selector = "[data-web-translation-extension-shell]";
const siteExceptionRegistry = createSiteExceptionRegistry();

interface ActiveTranslation {
  generation: number;
  requestId?: string;
  blockId?: string;
  pending: boolean;
  target: HTMLElement;
  normalizedText: string;
  sourceLanguage?: TranslationSourceLanguage;
  targetLanguage?: BaiduLanguageCode;
  provider?: { adapter: TranslationAdapterId; version: TranslationAdapterVersion };
  sessionId?: string;
  renderer: ReturnType<typeof mountInPageTranslation>;
}

interface ContentState {
  generation: number;
  requestSequence: number;
  blockSequence: number;
  stopListenerBound: boolean;
  routeListenerBound: boolean;
  compatibilityListenerBound: boolean;
  visibilityListenerBound: boolean;
  targetLanguage?: BaiduLanguageCode;
  provider?: { adapter: TranslationAdapterId; version: TranslationAdapterVersion };
  session?: PageSessionIdentity;
  sessionDisposition?: PageSessionDescriptor["disposition"];
  textColor: TranslationTextColorId;
  sessionStarting: boolean;
  routeResetting: boolean;
  routeSignalPending: boolean;
  stopped: boolean;
  active: Map<HTMLElement, ActiveTranslation>;
  seen: WeakMap<HTMLElement, string>;
  blockIds: WeakMap<HTMLElement, string>;
  pendingRequestIds: Set<string>;
  dynamicController?: DynamicVisibleContentController;
  compatibilityProbe?: { stop(): void };
  compatibilityDiagnostics: ReturnType<typeof createCompatibilityDiagnostics>;
  compatibilityGuard?: ReturnType<typeof createPageCompatibilityGuard>;
}

type ContentGlobal = typeof globalThis & {
  __webTranslationContentState?: ContentState;
  __webTranslationContentInstance?: ContentState;
  __webTranslationDynamicController?: DynamicVisibleContentController;
  __webTranslationReconcileVisible?: () => void;
  __webTranslationReportCompatibilityIssue?: (reason: PageCompatibilityFailure) => boolean;
};

function contentState(): ContentState {
  const scope = globalThis as ContentGlobal;
  if (scope.__webTranslationContentState) return scope.__webTranslationContentState;
  scope.__webTranslationDynamicController?.stop();
  scope.__webTranslationContentInstance?.dynamicController?.stop();
  const next: ContentState = {
    generation: 0,
    requestSequence: 0,
    blockSequence: 0,
    stopListenerBound: false,
    routeListenerBound: false,
    compatibilityListenerBound: false,
    visibilityListenerBound: false,
    targetLanguage: undefined,
    provider: undefined,
    session: undefined,
    sessionDisposition: undefined,
    textColor: "adaptive",
    sessionStarting: false,
    routeResetting: false,
    routeSignalPending: false,
    stopped: false,
    active: new Map(),
    seen: new WeakMap(),
    blockIds: new WeakMap(),
    pendingRequestIds: new Set(),
    compatibilityDiagnostics: createCompatibilityDiagnostics(),
  };
  scope.__webTranslationContentState = next;
  scope.__webTranslationContentInstance = next;
  return next;
}

const state = contentState();

function isCurrentContentInstance(): boolean {
  return (globalThis as ContentGlobal).__webTranslationContentInstance === state;
}

const existingMarker = document.querySelector<HTMLSpanElement>(selector);
const pageSessionMarker = existingMarker ?? document.createElement("span");
pageSessionMarker.hidden = true;
pageSessionMarker.dataset.webTranslationExtensionShell = "ready";
if (!existingMarker) document.documentElement.append(pageSessionMarker);

function stopActiveTranslations(): void {
  state.generation += 1;
  for (const active of state.active.values()) cancelActiveTranslation(active);
  state.active.clear();
  state.dynamicController?.stop();
  state.dynamicController = undefined;
  state.compatibilityProbe?.stop();
  state.compatibilityProbe = undefined;
  const scope = globalThis as ContentGlobal;
  if (scope.__webTranslationDynamicController) scope.__webTranslationDynamicController = undefined;
  state.seen = new WeakMap();
  state.targetLanguage = undefined;
  state.provider = undefined;
  state.session = undefined;
  state.sessionDisposition = undefined;
  state.sessionStarting = false;
  state.stopped = true;
  removeProviderFailureNotice();
  removeTabSessionPrompt();
  removeCompatibilityNotice();
  pageSessionMarker.dataset.pageSession = "stopped";
}

function removeCompatibilityUi(): void {
  for (const active of state.active.values()) active.renderer.unmount();
  state.active.clear();
  state.seen = new WeakMap();
  removeCompatibilityNotice();
}

function pauseCompatibilitySession(): void {
  state.stopped = true;
  pageSessionMarker.dataset.pageSession = "compatibility-paused";
}

function updateCompatibilityMetrics(): void {
  pageSessionMarker.dataset.compatibilityDiagnostics = JSON.stringify(state.compatibilityDiagnostics.snapshot());
}

function resetCompatibilityDiagnostics(): void {
  state.compatibilityDiagnostics.reset();
  updateCompatibilityMetrics();
}

/** Public page-local seam used by compatibility checks and synthetic fixtures. */
export function reportPageCompatibilityIssue(reason: PageCompatibilityFailure): boolean {
  if (!isCurrentContentInstance()) return false;
  const guard = state.compatibilityGuard ?? (state.compatibilityGuard = createPageCompatibilityGuard({
    removeUi: removeCompatibilityUi,
    cancelPending: pauseNewTranslations,
    pauseSession: pauseCompatibilitySession,
    notify: (failure) => {
      state.compatibilityDiagnostics.record("page-fallback", failure);
      updateCompatibilityMetrics();
      showCompatibilityNotice(failure);
      const session = state.session;
      if (session && typeof chrome !== "undefined") void chrome.runtime.sendMessage({
        type: SITE_MESSAGE_TYPES.compatibilityFailure,
        payload: { session, reason: failure },
      }).catch(() => undefined);
    },
  }));
  return guard.report(reason);
}

/** Stops only work that has not successfully rendered, retaining reading context. */
function pauseNewTranslations(): void {
  state.generation += 1;
  for (const active of [...state.active.values()]) if (active.pending) cancelActiveTranslation(active);
  state.dynamicController?.stop();
  state.dynamicController = undefined;
  state.compatibilityProbe?.stop();
  state.compatibilityProbe = undefined;
  const scope = globalThis as ContentGlobal;
  if (scope.__webTranslationDynamicController) scope.__webTranslationDynamicController = undefined;
  state.sessionStarting = false;
  removeProviderFailureNotice();
}

function isSessionAllowed(): boolean {
  return Boolean(document.visibilityState === "visible" && !state.stopped && state.session && state.sessionDisposition === "allowed");
}

if (!state.visibilityListenerBound) {
  state.visibilityListenerBound = true;
  document.addEventListener("visibilitychange", () => {
    if (!isCurrentContentInstance() || document.visibilityState === "visible") return;
    // This closes the small renderer-side gap before the worker's tab pause
    // reaches content. Successful hosts are intentionally retained.
    pauseNewTranslations();
    pageSessionMarker.dataset.pageSession = "paused";
  });
}

if (!state.stopListenerBound) {
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isCurrentContentInstance()) return;
    if (isTranslationPreflightMessage(message)) {
      const active = [...state.active.values()].find((current) => current.requestId === message.payload.requestId && current.blockId === message.payload.blockId);
      sendResponse(active && isSessionAllowed() && active.sessionId === message.session.id && active.generation === state.generation && isActiveCandidateCurrent(active)
        ? { ok: true }
        : { ok: false, error: state.stopped ? "SESSION_STOPPED" : "STALE_TASK" });
      return true;
    }
    const pageMessage = message as PageSessionMessage;
    if (pageMessage?.type === SITE_MESSAGE_TYPES.stopSession) {
      if (pageMessage.payload.scope.kind === "current-document" || pageMessage.payload.scope.domains.includes(location.hostname.toLowerCase())) {
        state.routeResetting = false;
        state.compatibilityGuard = undefined;
        stopActiveTranslations();
      }
      return;
    }
    if (pageMessage?.type === SITE_MESSAGE_TYPES.pause) {
      if (state.session?.id === pageMessage.payload.session.id) {
        pauseNewTranslations();
        state.session = undefined;
        state.sessionDisposition = undefined;
        removeTabSessionPrompt();
        pageSessionMarker.dataset.pageSession = "paused";
      }
      return;
    }
    if (pageMessage?.type === SITE_MESSAGE_TYPES.foreground && isBaiduLanguageCode(pageMessage.payload?.targetLanguage) && isProviderIdentity(pageMessage.payload.provider)) {
      receiveForegroundSession(pageMessage.payload);
      return;
    }
    if (pageMessage?.type === SITE_MESSAGE_TYPES.targetLanguageChanged && isBaiduLanguageCode(pageMessage.payload?.targetLanguage)) {
      restartForTargetLanguage(pageMessage.payload.targetLanguage);
    }
  });
  state.stopListenerBound = true;
}

function isActiveCandidateCurrent(active: ActiveTranslation): boolean {
  const current = state.dynamicController?.currentCandidate(active.target);
  return current?.normalizedText === active.normalizedText && active.target.isConnected;
}

function isActiveProviderCurrent(active: ActiveTranslation): boolean {
  return Boolean(
    state.provider &&
    active.provider &&
    active.provider.adapter === state.provider.adapter &&
    active.provider.version === state.provider.version,
  );
}

/** A success may write only for the exact page-side translation identity. */
function isExpectedTranslationOutput(
  output: { sourceLanguage: TranslationSourceLanguage; targetLanguage: BaiduLanguageCode; adapter: TranslationAdapterId; adapterVersion: TranslationAdapterVersion },
  active: ActiveTranslation,
): boolean {
  if (!isActiveProviderCurrent(active) || !active.provider) return false;
  return Boolean(
    active.sourceLanguage &&
    active.targetLanguage &&
    output.sourceLanguage === active.sourceLanguage &&
    output.targetLanguage === active.targetLanguage &&
    output.adapter === active.provider.adapter &&
    output.adapterVersion === active.provider.version,
  );
}

function cancelActiveTranslation(active: ActiveTranslation): void {
  if (active.pending && active.requestId && active.blockId && active.sessionId) {
    state.pendingRequestIds.delete(active.requestId);
    if (typeof chrome !== "undefined") void chrome.runtime.sendMessage({
      type: TRANSLATION_MESSAGE_TYPES.cancel,
      session: { id: active.sessionId },
      payload: { requestId: active.requestId, blockId: active.blockId },
    }).catch(() => undefined);
  }
  active.renderer.unmount();
  state.active.delete(active.target);
  state.seen.delete(active.target);
}

function reconcileVisibleTranslations(): void {
  if (!isSessionAllowed() || !state.targetLanguage) return;
  state.dynamicController?.scan(document.body);
}

const scope = globalThis as ContentGlobal;
scope.__webTranslationReconcileVisible = reconcileVisibleTranslations;
scope.__webTranslationReportCompatibilityIssue = reportPageCompatibilityIssue;

function nextRequestId(): string {
  state.requestSequence += 1;
  return state.requestSequence === 1 ? "first-visible-static-block" : `static-content-${state.requestSequence}`;
}

function blockIdFor(element: HTMLElement): string {
  const known = state.blockIds.get(element);
  if (known) return known;
  state.blockSequence += 1;
  const blockId = state.blockSequence === 1 ? "first-visible-static-block" : `static-content-${state.blockSequence}`;
  state.blockIds.set(element, blockId);
  return blockId;
}

/**
 * Scans the current static document through the public discovery seam and
 * submits each new readable content block exactly once for its current text.
 */
export function scanStaticContentBlocks(): void {
  state.dynamicController?.scan(document.body);
}

/** Closed shadow roots and unavailable iframe contents cannot be inferred by
 * generic discovery. An actually empty body remains a safe no-op. */
function hasOpaqueOnlyContent(document: Document): boolean {
  const children = Array.from(document.body?.children ?? []);
  if (!children.length) return false;
  return children.every((element) => {
    if (element.matches("iframe, frame")) return true;
    if (element.localName.includes("-")) return true;
    return element.children.length === 0 && !element.textContent?.trim();
  });
}

function hasUnsafeDiscoverySkips(discovery: { skipped: readonly { reason: string }[] }): boolean {
  return discovery.skipped.some(({ reason }) => reason === "unsafe-context" || reason === "link-only-or-incomplete" || reason === "excluded-descendant-content");
}

function startDynamicVisibleContentController(): void {
  state.dynamicController?.stop();
  state.compatibilityProbe?.stop();
  state.compatibilityProbe = undefined;
  const initialDiscovery = discoverStaticContentBlocksWithin(document, document.body);
  const unsafeInitialSkips = hasUnsafeDiscoverySkips(initialDiscovery);
  const exceptionStrategy = siteExceptionStrategyForDocument(siteExceptionRegistry, document, location.hostname, initialDiscovery.candidates.length > 0 || !unsafeInitialSkips);
  if (exceptionStrategy === "skip") {
    state.compatibilityDiagnostics.record("exception-disabled", "unsupported-region");
    updateCompatibilityMetrics();
    reportPageCompatibilityIssue("unsafe-page");
    return;
  }
  if (exceptionStrategy === "exception") pageSessionMarker.dataset.siteException = "active";
  if (!initialDiscovery.candidates.length && (unsafeInitialSkips || hasOpaqueOnlyContent(document))) {
    reportPageCompatibilityIssue("unsafe-page");
    return;
  }
  state.dynamicController = new DynamicVisibleContentController({
    document,
    observeAttributes: siteExceptionRegistry.list().some((record) => Boolean(record.triggerSelector)),
    discover: (root) => {
      // Re-evaluate the trigger on every mutation batch. A site wrapper can
      // disappear during SPA updates; only then may generic discovery resume.
      const genericDiscovery = discoverStaticContentBlocksWithin(document, root);
      const currentStrategy = siteExceptionStrategyForDocument(
        siteExceptionRegistry,
        document,
        location.hostname,
        genericDiscovery.candidates.length > 0 || !hasUnsafeDiscoverySkips(genericDiscovery),
      );
      if (currentStrategy === "skip") {
        state.compatibilityDiagnostics.record("region-skipped", "unsupported-region");
        updateCompatibilityMetrics();
        return [];
      }
      const currentRecord = siteExceptionRecordForDocument(siteExceptionRegistry, document, location.hostname);
      const constrainedRoot = currentRecord?.triggerSelector ? document.querySelector<HTMLElement>(currentRecord.triggerSelector) : undefined;
      if (currentStrategy === "exception" && currentRecord?.triggerSelector && !constrainedRoot) return [];
      if (currentStrategy === "exception" && constrainedRoot && root !== constrainedRoot && !root.contains(constrainedRoot) && !constrainedRoot.contains(root)) return [];
      const discovery = currentStrategy === "exception" && constrainedRoot
        ? discoverStaticContentBlocksWithin(document, root === document.body || root.contains(constrainedRoot) ? constrainedRoot : root)
        : genericDiscovery;
      if (currentStrategy === "generic") delete pageSessionMarker.dataset.siteException;
      else if (currentStrategy === "exception") pageSessionMarker.dataset.siteException = "active";
      for (const skipped of discovery.skipped) {
        const error = skipped.reason === "unsafe-context" ? "unsafe-context" : "unsupported-region";
        state.compatibilityDiagnostics.record("block-skipped", error);
      }
      if (discovery.skipped.length) updateCompatibilityMetrics();
      return discovery.candidates;
    },
    isPotentialCandidateRoot: isPotentialStaticContentBlock,
    isIgnoredNode: isExtensionOwnedNode,
    onVisible: submitVisibleCandidate,
    onHidden: (element) => {
      const active = state.active.get(element);
      if (active?.pending) cancelActiveTranslation(active);
    },
    onInvalidated: (element) => {
      cleanupInvalidCandidate(element);
    },
    onRemoved: (element) => {
      cleanupInvalidCandidate(element);
    },
    onMetrics: (metrics) => {
      // Numeric-only observability: no text, URL, credentials or payload data.
      pageSessionMarker.dataset.dynamicMetrics = JSON.stringify(metrics);
    },
    queueDepth: () => state.pendingRequestIds.size,
  });
  (globalThis as ContentGlobal).__webTranslationDynamicController = state.dynamicController;
  state.dynamicController.start();
  state.compatibilityProbe = createCompatibilityProbe({ document, report: reportPageCompatibilityIssue });
}

function cleanupInvalidCandidate(element: HTMLElement): void {
  const active = state.active.get(element);
  if (active) cancelActiveTranslation(active);
  state.seen.delete(element);
  state.blockIds.delete(element);
}

function isExtensionOwnedNode(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return Boolean(element?.closest("[data-web-translation-extension-shell], [data-web-translation-translation], [data-web-translation-react-coordinator], [data-web-translation-provider-notice], [data-web-translation-tab-session-prompt]"));
}

function submitVisibleCandidate(candidate: DynamicContentCandidate): { requestCount: number; domInsertions: number } {
  const targetLanguage = state.targetLanguage;
  const session = state.session;
  if (!isSessionAllowed() || !session || !pageSessionMarker.isConnected || !targetLanguage || !state.provider || state.seen.get(candidate.element) === candidate.normalizedText) return { requestCount: 0, domInsertions: 0 };
  const hadTranslationHost = candidate.element.nextElementSibling?.matches("[data-web-translation-translation='root']") ?? false;
  state.seen.set(candidate.element, candidate.normalizedText);
  const renderer = mountInPageTranslation(candidate.element);
  const active: ActiveTranslation = {
    generation: state.generation,
    target: candidate.element,
    blockId: blockIdFor(candidate.element),
    normalizedText: candidate.normalizedText,
    provider: { ...state.provider },
    sessionId: session.id,
    pending: false,
    renderer,
  };
  state.active.set(candidate.element, active);
  const decision = classifyStaticContentLanguage(candidate.text, targetLanguage);
  if (decision.kind === "skip") {
    removeInPageTranslation(candidate.element);
    state.active.delete(candidate.element);
    return { requestCount: 0, domInsertions: hadTranslationHost ? 0 : 1 };
  }
  if (decision.kind === "manual") {
    renderer.renderManualSourceLanguage(targetLanguage, (sourceLanguage) => submitTranslation(candidate, active, sourceLanguage));
    return { requestCount: 0, domInsertions: hadTranslationHost ? 0 : 1 };
  }
  submitTranslation(candidate, active, decision.sourceLanguage);
  return { requestCount: 1, domInsertions: hadTranslationHost ? 0 : 1 };
}

function submitTranslation(
  candidate: StaticContentBlockCandidate,
  active: ActiveTranslation,
  sourceLanguage: TranslationSourceLanguage,
): void {
  const targetLanguage = state.targetLanguage;
  const session = state.session;
  if (!isSessionAllowed() || !session || active.sessionId !== session.id || !targetLanguage || !isBaiduMvpDirection(sourceLanguage, targetLanguage) || !isActiveCandidateCurrent(active)) {
    active.renderer.renderSkipped();
    return;
  }
  active.sourceLanguage = sourceLanguage;
  active.targetLanguage = targetLanguage;
  const requestId = nextRequestId();
  active.requestId = requestId;
  active.pending = true;
  active.renderer.renderLoading();
  const task = { requestId, blockId: active.blockId, text: candidate.text, sourceLanguage, targetLanguage };
  state.pendingRequestIds.add(requestId);
  void chrome.runtime.sendMessage({ type: TRANSLATION_MESSAGE_TYPES.translate, session: { id: session.id }, payload: task }).then((result: TranslationMessageResponse) => {
    if (state.active.get(active.target) === active && active.requestId === requestId) active.pending = false;
    state.pendingRequestIds.delete(requestId);
    if (
      state.active.get(active.target) !== active ||
      active.generation !== state.generation ||
      active.sessionId !== state.session?.id ||
      !isSessionAllowed() ||
      result.requestId !== active.requestId ||
      result.blockId !== active.blockId ||
      !isActiveCandidateCurrent(active)
    ) return;
    if (!isActiveProviderCurrent(active)) {
      cleanupInvalidCandidate(active.target);
      return;
    }
    if (!result.ok) {
      if (isProviderPageFailure(result.error)) {
        active.renderer.renderPaused();
        showProviderFailureNotice(result.error);
        return;
      }
      if (result.error === "TEXT_TOO_LONG") {
        active.renderer.renderTextTooLong();
        return;
      }
      if (result.error === "BUDGET_EXHAUSTED") active.renderer.renderBudgetExhausted(() => {
        window.open(chrome.runtime.getURL("options.html"), "_blank", "noopener");
      });
      else active.renderer.renderFailure(result.error, isBlockRetryable(result.error) ? () => submitTranslation(candidate, active, sourceLanguage) : undefined);
      return;
    }
    if (!isExpectedTranslationOutput(result.output, active)) {
      cleanupInvalidCandidate(active.target);
      return;
    }
    active.renderer.renderSuccess(result.output, (manualSourceLanguage) => submitTranslation(candidate, active, manualSourceLanguage));
  }).catch(() => {
    if (state.active.get(active.target) === active && active.requestId === requestId) active.pending = false;
    state.pendingRequestIds.delete(requestId);
  });
}

function isProviderPageFailure(error: string): error is TranslationProviderErrorCode {
  return error === TRANSLATION_PROVIDER_ERROR_CODES.authentication || error === TRANSLATION_PROVIDER_ERROR_CODES.quotaExhausted || error === TRANSLATION_PROVIDER_ERROR_CODES.serviceUnavailable;
}

function isBlockRetryable(error: string): boolean {
  return error === TRANSLATION_PROVIDER_ERROR_CODES.network || error === TRANSLATION_PROVIDER_ERROR_CODES.timeout || error === TRANSLATION_PROVIDER_ERROR_CODES.rateLimited;
}

/** @deprecated Kept as a compatibility alias for the #14 test seam. */
export function scanFirstVisibleStaticBlock(): void {
  scanStaticContentBlocks();
}

export async function startContentSession(): Promise<void> {
  if (state.session || state.sessionStarting || state.compatibilityGuard?.isPaused()) return;
  state.stopped = false;
  state.generation += 1;
  const generation = state.generation;
  state.sessionStarting = true;
  pageSessionMarker.dataset.pageSession = "starting";
  let result: PageSessionSettingsResult | undefined;
  try {
    result = await chrome.runtime.sendMessage({ type: SITE_MESSAGE_TYPES.getPageSessionSettings });
  } catch {
    // A content script must not infer settings or read extension storage itself.
  }
  if (generation !== state.generation || (globalThis as ContentGlobal).__webTranslationContentInstance !== state) return;
  state.sessionStarting = false;
  if (!result?.ok || !isBaiduLanguageCode(result.targetLanguage) || !isProviderIdentity(result.provider)) {
    stopActiveTranslations();
    pageSessionMarker.dataset.pageSession = "unavailable";
    return;
  }
  if (isTranslationAppearanceSettings({ textColor: result.textColor })) state.textColor = result.textColor!;
  setTranslationTextColor(state.textColor);
  receiveForegroundSession(result);
}

function receiveForegroundSession(descriptor: PageSessionDescriptor): void {
  if (state.compatibilityGuard?.isPaused()) return;
  if (state.session?.id !== descriptor.session.id) {
    resetCompatibilityDiagnostics();
    state.generation += 1;
    state.sessionStarting = false;
    pauseNewTranslations();
  }
  if (state.targetLanguage && state.targetLanguage !== descriptor.targetLanguage) stopActiveTranslations();
  state.stopped = false;
  state.session = descriptor.session;
  state.sessionDisposition = descriptor.disposition;
  if (isTranslationAppearanceSettings({ textColor: descriptor.textColor })) state.textColor = descriptor.textColor!;
  setTranslationTextColor(state.textColor);
  state.targetLanguage = descriptor.targetLanguage;
  state.provider = descriptor.provider;
  if (descriptor.disposition === "allowed") {
    removeTabSessionPrompt();
    for (const active of state.active.values()) {
      active.generation = state.generation;
      active.sessionId = descriptor.session.id;
      active.provider = { ...descriptor.provider };
    }
    pageSessionMarker.dataset.pageSession = "idle";
    startDynamicVisibleContentController();
    return;
  }
  pauseNewTranslations();
  pageSessionMarker.dataset.pageSession = descriptor.disposition;
  if (descriptor.disposition === "awaiting-decision" && isTopLevelContentFrame(window)) showTabSessionPrompt(decideCurrentSession);
  else removeTabSessionPrompt();
}

async function decideCurrentSession(decision: "accept" | "reject"): Promise<boolean> {
  const session = state.session;
  if (!session || state.sessionDisposition !== "awaiting-decision") return false;
  try {
    const result = await chrome.runtime.sendMessage({
      type: SITE_MESSAGE_TYPES.sessionDecision,
      payload: { session, decision },
    });
    if (state.session?.id !== session.id) return false;
    if (!result?.ok || (result.disposition !== "allowed" && result.disposition !== "rejected")) {
      pauseNewTranslations();
      state.session = undefined;
      state.sessionDisposition = undefined;
      pageSessionMarker.dataset.pageSession = "unavailable";
      return true;
    }
    receiveForegroundSession({
      targetLanguage: state.targetLanguage!,
      provider: state.provider!,
      session,
      disposition: result.disposition,
    });
    return true;
  } catch {
    return false;
  }
}

function restartForTargetLanguage(targetLanguage: BaiduLanguageCode): void {
  if (state.stopped || !state.session || (state.targetLanguage === targetLanguage && !state.sessionStarting)) return;
  state.routeResetting = false;
  const provider = state.provider;
  const session = state.session;
  const disposition = state.sessionDisposition;
  stopActiveTranslations();
  state.stopped = false;
  state.targetLanguage = targetLanguage;
  state.provider = provider;
  state.session = session;
  state.sessionDisposition = disposition;
  if (disposition === "allowed") {
    pageSessionMarker.dataset.pageSession = "idle";
    startDynamicVisibleContentController();
  } else if (disposition === "awaiting-decision" && isTopLevelContentFrame(window)) {
    pageSessionMarker.dataset.pageSession = "awaiting-decision";
    showTabSessionPrompt(decideCurrentSession);
  } else if (disposition === "awaiting-decision") {
    pageSessionMarker.dataset.pageSession = "awaiting-decision";
    removeTabSessionPrompt();
  }
}

function queueRouteRestart(): void {
  if (!isCurrentContentInstance() || state.stopped || !state.session || state.routeResetting || state.routeSignalPending) return;
  state.routeSignalPending = true;
  queueMicrotask(() => {
    state.routeSignalPending = false;
    void restartForRoute();
  });
}

async function restartForRoute(): Promise<void> {
  const session = state.session;
  if (!isCurrentContentInstance() || state.stopped || !session || state.routeResetting) return;
  state.routeResetting = true;
  resetCompatibilityDiagnostics();
  stopActiveTranslations();
  const generation = state.generation;
  pageSessionMarker.dataset.pageSession = "starting";
  try {
    await chrome.runtime.sendMessage({ type: SITE_MESSAGE_TYPES.routeChanged, payload: { session } });
    if (generation !== state.generation) return;
    // A worker restart forgets its in-memory stay and rejects this old ACK.
    // Do not retain the old grant: the fresh settings handshake below may only
    // establish a new awaiting-decision descriptor (or remain unavailable).
  } catch {
    if (generation !== state.generation) return;
  } finally {
    if (generation === state.generation) state.routeResetting = false;
  }
  state.stopped = false;
  await startContentSession();
}

if (!state.routeListenerBound) {
  state.routeListenerBound = true;
  window.addEventListener("popstate", queueRouteRestart);
  window.addEventListener("hashchange", queueRouteRestart);
  // Navigation API observes History API transitions from the page's main
  // world without injecting a URL-bearing bridge into the DOM.
  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  navigation?.addEventListener("navigate", queueRouteRestart);
}

// Host-specific synthetic fixtures and future probes can report a confirmed
// page regression without introducing a worker message or sending page data.
if (!state.compatibilityListenerBound) {
  state.compatibilityListenerBound = true;
  window.addEventListener("web-translation-extension:compatibility-failure", (event) => {
    const reason = (event as CustomEvent<{ reason?: unknown }>).detail?.reason;
    if (reason === "layout-breakage" || reason === "scroll-breakage" || reason === "interaction-breakage" || reason === "unsafe-page") reportPageCompatibilityIssue(reason);
  });
}

function isProviderIdentity(value: unknown): value is { adapter: TranslationAdapterId; version: TranslationAdapterVersion } {
  if (typeof value !== "object" || value === null) return false;
  const provider = value as Partial<{ adapter: TranslationAdapterId; version: TranslationAdapterVersion }>;
  return (provider.adapter === "fake" || provider.adapter === "baidu") && typeof provider.version === "string" && provider.version.length > 0;
}

startContentSession();
