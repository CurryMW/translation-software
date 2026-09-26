import { createCredentialController } from "./credential-controller";
import { createSiteSettingsController } from "./site-settings-controller";
import { BAIDU_MANUAL_SMOKE_MESSAGE_TYPES, CREDENTIAL_MESSAGE_TYPES, isBaiduManualSmokeMessage, isCredentialMessage, isPageSessionCompatibilityFailureMessage, isPageSessionDecisionMessage, isPageSessionRouteChangedMessage, isPageSessionSettingsMessage, isSiteSettingsMessage, isTranslationAppearanceMessage, isTranslationCancellationMessage, isTranslationMessage, isTranslationUsageMessage, SITE_MESSAGE_TYPES, type PageSessionMessage } from "../shared/messages";
import { siteMatchPatterns, siteScriptId } from "../shared/site-script-registration";
import { FakeTranslationAdapter } from "./fake-translation-adapter";
import { createTranslationMessageHandler, translationSenderScope } from "./translation-message-handler";
import { createPageSessionSettingsHandler } from "./page-session-settings-handler";
import { createTranslationUsageController } from "./translation-usage-controller";
import { createTranslationScheduler } from "./translation-scheduler";
import { createTranslationDiagnosticsController } from "./translation-diagnostics-controller";
import { createTabSessionController } from "./tab-session-controller";
import { createStorageIsolationGate } from "./storage-isolation-gate";
import { siteIdentityFromUrl } from "../shared/site-identity";
import { BaiduTranslationAdapter, BAIDU_PROVIDER_ORIGIN_PATTERN } from "./baidu-translation-adapter";
import { createBaiduManualSmokeController } from "./baidu-manual-smoke-controller";
import { createProviderRuntimeManager } from "./provider-runtime";
import { createWorkerBootstrapGate } from "./worker-bootstrap-gate";
import { createWorkerSafetyOperationQueue } from "./worker-safety-operation-queue";
import { createBaiduSubmissionGate } from "./baidu-submission-gate";
import { createCompatibilityPauseController } from "./compatibility-pause-controller";
import { createTranslationAppearanceController } from "./translation-appearance-controller";
import { SITE_EXCEPTION_REGISTRY } from "../shared/site-exception-registry";

const controller = createCredentialController({
  storage: {
    get: (key) => chrome.storage.local.get(key),
    set: (values) => chrome.storage.local.set(values),
    remove: (key) => chrome.storage.local.remove(key),
  },
});

const siteSettingsController = createSiteSettingsController({
  storage: {
    get: (key) => chrome.storage.local.get(key),
    set: (values) => chrome.storage.local.set(values),
  },
});
const fakeTranslationAdapter = new FakeTranslationAdapter();
// Deliberately outside runtime creation: Fake↔Baidu swaps never reset the
// account-wide submission-start history.
const baiduSubmissionGate = createBaiduSubmissionGate();
const translationUsageController = createTranslationUsageController({
  storage: {
    get: (key) => chrome.storage.local.get(key),
    set: (values) => chrome.storage.local.set(values),
  },
});
const translationDiagnosticsController = createTranslationDiagnosticsController({
  storage: {
    get: (key) => chrome.storage.local.get(key),
    set: (values) => chrome.storage.local.set(values),
  },
});
const translationAppearanceController = createTranslationAppearanceController({
  storage: {
    get: (key) => chrome.storage.local.get(key),
    set: (values) => chrome.storage.local.set(values),
  },
});
const baiduTranslationAdapter = new BaiduTranslationAdapter({
  credentials: () => controller.readForServiceWorker(),
  postForm: async (endpoint, fields, signal) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams(fields),
      signal,
    });
    return { status: response.status, json: () => response.json() };
  },
});
const baiduManualSmokeController = createBaiduManualSmokeController({
  adapter: baiduTranslationAdapter,
  credentials: () => controller.readForServiceWorker(),
  usage: translationUsageController,
  submissionGate: baiduSubmissionGate,
  hasProviderPermission: () => chrome.permissions.contains({ origins: [BAIDU_PROVIDER_ORIGIN_PATTERN] }),
  storage: {
    get: (key) => chrome.storage.local.get(key),
    set: (values) => chrome.storage.local.set(values),
    remove: (key) => chrome.storage.local.remove(key),
  },
});
const workerSafetyOperations = createWorkerSafetyOperationQueue();
const compatibilityPauseController = createCompatibilityPauseController({
  storage: {
    get: (key) => chrome.storage.local.get(key),
    set: (values) => chrome.storage.local.set(values),
  },
  managedDomains: SITE_EXCEPTION_REGISTRY.filter((record) => record.enabled && record.pause).map((record) => record.domain),
});
let baiduSafetyEpoch = 0;

let tabSessionController: ReturnType<typeof createTabSessionController>;
const senderDocumentsByTab = new Map<number, Map<number, string>>();

function rememberSenderDocument(sender: chrome.runtime.MessageSender): void {
  const tabId = typeof sender.tab?.id === "number" ? sender.tab.id : undefined;
  const documentId = typeof sender.documentId === "string" && sender.documentId ? sender.documentId : undefined;
  if (tabId === undefined || !documentId) return;
  const documents = senderDocumentsByTab.get(tabId) ?? new Map<number, string>();
  documents.set(typeof sender.frameId === "number" ? sender.frameId : 0, documentId);
  senderDocumentsByTab.set(tabId, documents);
}

function senderDocumentIsCurrent(sender: chrome.runtime.MessageSender): boolean {
  const tabId = typeof sender.tab?.id === "number" ? sender.tab.id : undefined;
  const documentId = typeof sender.documentId === "string" && sender.documentId ? sender.documentId : undefined;
  if (tabId === undefined || !documentId) return true;
  return senderDocumentsByTab.get(tabId)?.get(typeof sender.frameId === "number" ? sender.frameId : 0) === documentId;
}

function clearSenderDocuments(tabId: number): void {
  senderDocumentsByTab.delete(tabId);
}

const providerRuntimes = createProviderRuntimeManager({
  fake: fakeTranslationAdapter,
  baidu: baiduTranslationAdapter,
  create: (adapter) => {
    const scheduler = createTranslationScheduler({
      adapter,
      usage: translationUsageController,
      diagnostics: translationDiagnosticsController,
      submissionGate: adapter === baiduTranslationAdapter ? baiduSubmissionGate : undefined,
    });
    const handler = createTranslationMessageHandler({
      adapter,
      hasHostPermission: (origin) => chrome.permissions.contains({ origins: [origin] }),
      isDomainEnabled: (domain) => siteSettingsController.isDomainEnabled(domain),
      permitsSession: async (sender, sessionId, targetLanguage) => {
        const tabId = await tabIdFromSender(sender as chrome.runtime.MessageSender);
        return tabId === undefined ? false : tabSessionController.permits(tabId, sessionId, targetLanguage);
      },
      scheduler,
      preflight: async (sender, identity, session, targetLanguage) => {
        if (typeof sender.tab !== "object" || sender.tab === null || !("id" in sender.tab) || typeof sender.tab.id !== "number") return { ok: false, error: "SESSION_STOPPED" };
        if (!await tabSessionController.permits(sender.tab.id, session.id, targetLanguage)) return { ok: false, error: "SESSION_STOPPED" };
        try {
          const response = await chrome.tabs.sendMessage(sender.tab.id, { type: "translation.preflight", session, payload: identity }, typeof sender.frameId === "number" ? { frameId: sender.frameId } : {});
          if (typeof response === "object" && response !== null && "ok" in response && (response.ok === true || (response.ok === false && (response.error === "SESSION_STOPPED" || response.error === "STALE_TASK" || response.error === "NOT_VISIBLE")))) return response;
          return { ok: false, error: "SESSION_STOPPED" };
        } catch {
          return { ok: false, error: "SESSION_STOPPED" };
        }
      },
    });
    return { adapter, scheduler, handler };
  },
});
function tabSite(url: string | undefined): { domain: string; origin: string } | undefined {
  return siteIdentityFromUrl(url);
}

async function tabIdFromSender(sender: chrome.runtime.MessageSender): Promise<number | undefined> {
  return typeof sender.tab?.id === "number" ? sender.tab.id : undefined;
}

async function isFocusedActiveTab(tabId: number): Promise<boolean> {
  try {
    const [tab, window] = await Promise.all([chrome.tabs.get(tabId), chrome.windows.getLastFocused()]);
    return Boolean(tab.active && tab.windowId === window.id && window.focused);
  } catch {
    return false;
  }
}

tabSessionController = createTabSessionController({
  provider: () => ({ adapter: providerRuntimes.current().adapter.id, version: providerRuntimes.current().adapter.version }),
  getTabSite: async (tabId) => tabSite((await chrome.tabs.get(tabId)).url),
  isTabActive: isFocusedActiveTab,
  hasHostPermission: (origin) => chrome.permissions.contains({ origins: [origin] }),
  isDomainCompatibilityPaused: (domain) => compatibilityPauseController.isPaused(domain),
  getSettings: (domain) => siteSettingsController.settingsForDomain(domain),
});
const pageSessionSettingsHandler = createPageSessionSettingsHandler({
  connect: (tabId) => tabSessionController.connect(tabId),
  isCurrent: (tabId, sessionId) => tabSessionController.isCurrent(tabId, sessionId),
  getTextColor: async () => (await translationAppearanceController.get()).textColor,
  pause: (tabId, sessionId) => {
    const paused = tabSessionController.pause(tabId, sessionId);
    if (paused) providerRuntimes.current().handler.clearTabSession(tabId, paused.session.id);
  },
});
async function pauseTabSession(tabId: number): Promise<void> {
  const paused = tabSessionController.pause(tabId);
  clearSenderDocuments(tabId);
  if (!paused) return;
  providerRuntimes.current().handler.clearTabSession(tabId, paused.session.id);
  await chrome.tabs.sendMessage(tabId, { type: SITE_MESSAGE_TYPES.pause, payload: paused }).catch(() => undefined);
}

async function pauseKnownSessionsExcept(tabId: number): Promise<void> {
  const paused = tabSessionController.pauseAllExcept(tabId);
  await Promise.all(paused.map(async ({ tabId: pausedTabId, session, reason }) => {
    clearSenderDocuments(pausedTabId);
    providerRuntimes.current().handler.clearTabSession(pausedTabId, session.id);
    await chrome.tabs.sendMessage(pausedTabId, { type: SITE_MESSAGE_TYPES.pause, payload: { session, reason } }).catch(() => undefined);
  }));
}

async function broadcastPausedSessions(paused: readonly { tabId: number; session: { id: string }; reason: "background" }[]): Promise<void> {
  await Promise.all(paused.map(async ({ tabId, session, reason }) => {
    await chrome.tabs.sendMessage(tabId, { type: SITE_MESSAGE_TYPES.pause, payload: { session, reason } }).catch(() => undefined);
  }));
}

/**
 * Publish only after old sessions/scopes have been synchronously invalidated.
 * In-flight work retains the old concrete runtime adapter and can never be
 * retargeted to Baidu during this transition.
 */
async function switchProvider(adapter: typeof fakeTranslationAdapter | typeof baiduTranslationAdapter): Promise<void> {
  const previous = providerRuntimes.current();
  if (previous.adapter === adapter) return;
  // A Baidu-to-Fake transition is a security invalidation, not a normal
  // routing update: leave no old controller running after its session scope
  // has been cleared. The reverse switch deliberately does not abort, so the
  // successful manual smoke that authorizes it is never retroactively killed.
  if (previous.adapter === baiduTranslationAdapter && adapter === fakeTranslationAdapter) baiduTranslationAdapter.abortAll();
  const next = providerRuntimes.create(adapter);
  const paused = tabSessionController.pauseAllExcept(-1);
  for (const { tabId } of paused) clearSenderDocuments(tabId);
  previous.handler.clearAll();
  providerRuntimes.publish(next);
  void broadcastPausedSessions(paused);
  // Runtime publication is already complete above. Best-effort foreground
  // reconciliation must never turn a successful manual smoke into a hanging
  // options request when the browser query is briefly unavailable.
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (typeof activeTab?.id === "number") await notifyForeground(activeTab.id);
  } catch {
    // The next activation/update reconnects through the published runtime.
  }
}

function isTrustedOptionsSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.url === `chrome-extension://${chrome.runtime.id}/options.html`;
}

/**
 * A trusted configuration mutation must invalidate before it enters the
 * serialized storage queue. Otherwise a pending smoke can occupy that queue
 * for the whole transport timeout while still retaining its authorization.
 */
function beginBaiduSafetyInvalidation(): void {
  baiduSafetyEpoch += 1;
  baiduManualSmokeController.abortInFlight();
  baiduTranslationAdapter.abortAll();
  void switchProvider(fakeTranslationAdapter);
}

/**
 * A tab can host authorized child frames from a different domain. Broadcast
 * the hostname-scoped stop to every injected frame and let each content script
 * filter against its own location, rather than looking only at a tab's top URL.
 */
async function stopTabsForDomains(domains: readonly string[], reason: "site-disabled" | "permission-revoked"): Promise<void> {
  const normalizedDomains = [...new Set(domains.map((domain) => domain.toLowerCase()))];
  if (!normalizedDomains.length) return;
  const matchingTabs = (await chrome.tabs.query({})).filter((tab): tab is chrome.tabs.Tab & { id: number } => typeof tab.id === "number");
  const stop: PageSessionMessage = { type: SITE_MESSAGE_TYPES.stopSession, payload: { reason, scope: { kind: "domains", domains: normalizedDomains } } };
  await Promise.all(matchingTabs.map((tab) => chrome.tabs.sendMessage(tab.id, stop).catch(() => undefined)));
}

async function notifyForeground(tabId: number): Promise<void> {
  if (!await isFocusedActiveTab(tabId)) return;
  await pauseKnownSessionsExcept(tabId);
  const session = await tabSessionController.connect(tabId);
  if (!session.ok) return;
  if (!await tabSessionController.isCurrent(tabId, session.session.id)) return;
  await chrome.tabs.sendMessage(tabId, { type: SITE_MESSAGE_TYPES.foreground, payload: session }).catch(() => undefined);
}

function isSuccessfulSiteSettingsResult(value: unknown): value is { ok: true } {
  return typeof value === "object" && value !== null && "ok" in value && value.ok === true;
}
const storageIsolation = createStorageIsolationGate({
  setTrustedContexts: () => chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
});

async function reconcileSiteScripts(): Promise<void> {
  const enabled = await siteSettingsController.enabledDomains();
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const expected = new Set(enabled.map(siteScriptId));
  const stale = registered.map((script) => script.id).filter((id) => id.startsWith("site-") && !expected.has(id));
  if (stale.length) await chrome.scripting.unregisterContentScripts({ ids: stale });
  for (const domain of enabled) {
    const id = siteScriptId(domain);
    const current = registered.find((script) => script.id === id);
    const matches: string[] = [];
    for (const origin of siteMatchPatterns(domain)) if (await chrome.permissions.contains({ origins: [origin] })) matches.push(origin);
    if (!matches.length) {
      if (current) await chrome.scripting.unregisterContentScripts({ ids: [id] });
      continue;
    }
    const next = { id, js: ["content-script.js"], matches, allFrames: true, runAt: "document_idle" as const, persistAcrossSessions: true };
    if (current) {
      const oldMatches = [...(current.matches ?? [])].sort();
      if (oldMatches.join("|") !== [...matches].sort().join("|") || current.allFrames !== true) await chrome.scripting.updateContentScripts([next]);
    } else await chrome.scripting.registerContentScripts([next]);
  }
}
async function bootstrapWorker(): Promise<void> {
  const initialized = await storageIsolation.runIfReady(async () => {
    await compatibilityPauseController.reconcileManaged(SITE_EXCEPTION_REGISTRY);
    if (await baiduManualSmokeController.hasCurrentReadiness()) {
      providerRuntimes.publish(providerRuntimes.create(baiduTranslationAdapter));
    }
    await reconcileSiteScripts();
  });
  if (!initialized) throw new Error("Worker bootstrap unavailable");
}

const workerBootstrap = createWorkerBootstrapGate(bootstrapWorker);
chrome.runtime.onInstalled.addListener(() => { void workerBootstrap.runIfReady(reconcileSiteScripts); });
chrome.runtime.onStartup.addListener(() => { void workerBootstrap.runIfReady(reconcileSiteScripts); });

function handleRuntimeMessage(message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void): void {
  if (isPageSessionCompatibilityFailureMessage(message)) {
    void (async () => {
      const tabId = await tabIdFromSender(sender);
      if (tabId === undefined || !tabSite(sender.url) || !senderDocumentIsCurrent(sender) || !await tabSessionController.isCurrent(tabId, message.payload.session.id)) {
        sendResponse({ ok: false, error: "STALE_SESSION" });
        return;
      }
      // The async session check can yield to navigation. Re-check the
      // document/frame identity immediately before the synchronous pause so a
      // stale event cannot revoke the replacement document's stay.
      if (!senderDocumentIsCurrent(sender)) {
        sendResponse({ ok: false, error: "STALE_SESSION" });
        return;
      }
      const paused = tabSessionController.pause(tabId, message.payload.session.id);
      if (!paused) {
        sendResponse({ ok: false, error: "STALE_SESSION" });
        return;
      }
      providerRuntimes.current().handler.clearTabSession(tabId, paused.session.id);
      await chrome.tabs.sendMessage(tabId, { type: SITE_MESSAGE_TYPES.pause, payload: paused }).catch(() => undefined);
      sendResponse({ ok: true });
    })();
    return;
  }
  // A settings handshake is the document's authority to join/rejoin the tab
  // stay. Do not let late translation cancellations or arbitrary old-frame
  // messages overwrite the current document identity.
  if (isPageSessionSettingsMessage(message)) rememberSenderDocument(sender);
  if (isPageSessionRouteChangedMessage(message)) {
    void (async () => {
      const tabId = await tabIdFromSender(sender);
      const current = tabId !== undefined && tabSite(sender.url) && await tabSessionController.isCurrent(tabId, message.payload.session.id);
      if (current && tabId !== undefined) providerRuntimes.current().handler.clearFramePageReuse(tabId, typeof sender.frameId === "number" ? sender.frameId : 0);
      sendResponse({ ok: Boolean(current) });
    })();
    return;
  }
  if (isPageSessionDecisionMessage(message)) {
    void (async () => {
      const tabId = await tabIdFromSender(sender);
      if (tabId === undefined || !tabSite(sender.url)) {
        sendResponse({ ok: false, error: "UNAVAILABLE" });
        return;
      }
      const result = await tabSessionController.decide(tabId, message.payload.session.id, message.payload.decision);
      if (result.ok && result.disposition === "allowed") {
        const descriptor = await tabSessionController.connect(tabId);
        if (descriptor.ok && descriptor.disposition === "allowed") {
          // No frameId broadcasts the single tab stay to every already-injected
          // frame; late frames receive the same descriptor from settings.get.
          await chrome.tabs.sendMessage(tabId, { type: SITE_MESSAGE_TYPES.foreground, payload: descriptor }).catch(() => undefined);
        }
      }
      sendResponse(result);
    })();
    return;
  }
  if (isTranslationCancellationMessage(message)) {
    providerRuntimes.current().scheduler.cancel(message.payload, translationSenderScope(sender, message.session.id));
    sendResponse({ ok: true });
    return;
  }
  if (isTranslationUsageMessage(message)) {
    const usageMutation = message.type === "translation-usage.update";
    // Only the exact options page is authorized to make this safety-sensitive
    // mutation. Do not let an arbitrary extension frame turn this into a DoS.
    if (usageMutation && isTrustedOptionsSender(sender)) beginBaiduSafetyInvalidation();
    const operation = async () => {
      const result = await translationUsageController.handle(message, sender, chrome.runtime.id);
      if (message.type === "translation-usage.update" && result.ok) {
        await baiduManualSmokeController.invalidate();
        await switchProvider(fakeTranslationAdapter);
      }
      return result;
    };
    void (usageMutation ? workerSafetyOperations.run(operation) : operation())
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: "STORAGE_FAILURE" }));
    return;
  }
  if (isTranslationAppearanceMessage(message)) {
    void translationAppearanceController.handle(message, sender, chrome.runtime.id)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: "STORAGE_FAILURE" }));
    return;
  }
  if (isPageSessionSettingsMessage(message)) {
    void pageSessionSettingsHandler.handle(sender).then(sendResponse);
    return;
  }
  if (isTranslationMessage(message)) {
    void providerRuntimes.current().handler.handle(message, sender).then(sendResponse);
    return;
  }
  if (isBaiduManualSmokeMessage(message)) {
    const operation = async () => {
      const operationSafetyEpoch = baiduSafetyEpoch;
      const result = await baiduManualSmokeController.handle(message, sender, chrome.runtime.id);
      if (message.type === BAIDU_MANUAL_SMOKE_MESSAGE_TYPES.run && result.ok) {
        // A trusted config mutation can arrive after the controller's final
        // readiness write but before this queued operation publishes Baidu.
        // Do not revive that just-revoked authorization for even one turn.
        if (operationSafetyEpoch !== baiduSafetyEpoch) {
          await baiduManualSmokeController.invalidate();
          return { ok: false, error: "CONFIRMATION_EXPIRED" };
        }
        await switchProvider(baiduTranslationAdapter);
      }
      return result;
    };
    void workerSafetyOperations.run(operation).then(sendResponse).catch(() => sendResponse({ ok: false, error: "WORKER_OPERATION_FAILURE" }));
    return;
  }
  const handler = isSiteSettingsMessage(message) ? siteSettingsController : controller;
  const credentialMutation = isCredentialMessage(message) && (message.type === CREDENTIAL_MESSAGE_TYPES.save || message.type === CREDENTIAL_MESSAGE_TYPES.clear);
  // The controller repeats this sender check before touching storage; do it
  // here too because this invalidation is intentionally synchronous.
  if (credentialMutation && isTrustedOptionsSender(sender)) beginBaiduSafetyInvalidation();
  const operation = async () => {
    const result = await handler.handle(message, sender, chrome.runtime.id);
    if (isSiteSettingsMessage(message) && message.type === SITE_MESSAGE_TYPES.setEnabled && message.payload.enabled === false && isSuccessfulSiteSettingsResult(result)) {
      for (const invalidated of tabSessionController.invalidateDomain(message.payload.domain)) providerRuntimes.current().handler.clearTabSession(invalidated.tabId, invalidated.session.id);
      await stopTabsForDomains([message.payload.domain], "site-disabled");
    }
    if (isSiteSettingsMessage(message) && message.type === SITE_MESSAGE_TYPES.setTargetLanguage && isSuccessfulSiteSettingsResult(result)) {
      tabSessionController.updateDomainTargetLanguage(message.payload.domain, message.payload.targetLanguage);
    }
    if (isCredentialMessage(message) &&
      (message.type === CREDENTIAL_MESSAGE_TYPES.save || message.type === CREDENTIAL_MESSAGE_TYPES.clear) &&
      "ok" in result && result.ok) {
      await baiduManualSmokeController.invalidate();
      await switchProvider(fakeTranslationAdapter);
    }
    return result;
  };
  void (credentialMutation ? workerSafetyOperations.run(operation) : operation()).then(sendResponse).catch(() => {
    if (isCredentialMessage(message)) {
      sendResponse(message.type === CREDENTIAL_MESSAGE_TYPES.status ? { configured: false } : { ok: false, error: "STORAGE_FAILURE" });
      return;
    }
    sendResponse({ ok: false, error: "UNAVAILABLE" });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void workerBootstrap.runIfReady(() => handleRuntimeMessage(message, sender, sendResponse)).then((result) => {
    if (!result.ready) sendResponse({ ok: false, error: "UNAVAILABLE" });
  });
  return true;
});

chrome.permissions.onRemoved.addListener(({ origins = [] }) => {
  const broadProviderRemoval = origins.includes("https://*/*") || origins.includes("*://*/*");
  if (broadProviderRemoval || origins.includes(BAIDU_PROVIDER_ORIGIN_PATTERN)) beginBaiduSafetyInvalidation();
  void workerBootstrap.runIfReady(() => workerSafetyOperations.run(async () => {
    const exactProviderPermission = await chrome.permissions.contains({ origins: [BAIDU_PROVIDER_ORIGIN_PATTERN] }).catch(() => false);
    const providerPermissionRemoved = broadProviderRemoval || origins.includes(BAIDU_PROVIDER_ORIGIN_PATTERN) || !exactProviderPermission;
    if (providerPermissionRemoved) {
      beginBaiduSafetyInvalidation();
      await baiduManualSmokeController.invalidate();
      await switchProvider(fakeTranslationAdapter);
    }
    await siteSettingsController.disableDomains(origins);
    const domains = [...new Set(origins.map((origin) => siteIdentityFromUrl(origin.endsWith("/*") ? origin.slice(0, -2) : origin)?.domain).filter((domain): domain is string => Boolean(domain)))];
    if (!domains.length) return;
    for (const domain of domains) {
      for (const invalidated of tabSessionController.invalidateDomain(domain)) providerRuntimes.current().handler.clearTabSession(invalidated.tabId, invalidated.session.id);
    }
    await Promise.all(domains.map((domain) => chrome.scripting.unregisterContentScripts({ ids: [siteScriptId(domain)] }).catch(() => undefined)));
    await stopTabsForDomains(domains, "permission-revoked");
  }));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void workerBootstrap.runIfReady(async () => {
    clearSenderDocuments(tabId);
    await pauseTabSession(tabId);
    providerRuntimes.current().handler.clearPageReuse(tabId);
  });
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void workerBootstrap.runIfReady(() => notifyForeground(tabId));
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  void workerBootstrap.runIfReady(async () => {
    if (changeInfo.status === "loading") {
      // Navigation invalidates document-scoped cache, not the tab's foreground
      // stay. History API navigations also emit loading; pausing here would turn
      // one visible stay into a fresh consent prompt and revoke valid work.
      providerRuntimes.current().handler.clearPageReuse(tabId);
      clearSenderDocuments(tabId);
    }
    if (changeInfo.status === "complete" && tab.active) await notifyForeground(tabId);
  });
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  void workerBootstrap.runIfReady(async () => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      await pauseKnownSessionsExcept(-1);
      return;
    }
    const [activeTab] = await chrome.tabs.query({ active: true, windowId });
    if (typeof activeTab?.id === "number") await notifyForeground(activeTab.id);
  });
});
