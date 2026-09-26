import type { TranslationMessage, TranslationPreflightResult, TranslationTaskIdentity } from "../shared/messages";
import { TranslationAdapterError, type TranslationResult, type TranslationServiceAdapter } from "../shared/translation";
import { isBaiduMvpDirection } from "../shared/languages";
import { normalizeTranslationSourceText } from "../shared/text-normalization";
import type { TranslationScheduler } from "./translation-scheduler";
import { siteIdentityFromUrl } from "../shared/site-identity";

interface TranslationSender {
  tab?: unknown;
  url?: string;
  frameId?: number;
  documentId?: string;
}

interface TranslationMessageHandlerDependencies {
  adapter: TranslationServiceAdapter;
  hasHostPermission(origin: string): Promise<boolean>;
  isDomainEnabled(domain: string): Promise<boolean>;
  permitsSession(sender: TranslationSender, sessionId: string, targetLanguage: TranslationMessage["payload"]["targetLanguage"]): Promise<boolean>;
  scheduler?: TranslationScheduler;
  preflight?(sender: TranslationSender, identity: TranslationTaskIdentity, session: TranslationMessage["session"], targetLanguage: TranslationMessage["payload"]["targetLanguage"]): Promise<TranslationPreflightResult>;
}

function failed(message: TranslationMessage): TranslationResult {
  return { ok: false, requestId: message.payload.requestId, blockId: message.payload.blockId, error: "TRANSLATION_FAILED" };
}

function senderSite(sender: TranslationSender): { domain: string; origin: string } | undefined {
  return sender.tab ? siteIdentityFromUrl(sender.url) : undefined;
}

function senderTabId(sender: TranslationSender): number | undefined {
  return typeof sender.tab === "object" && sender.tab !== null && "id" in sender.tab && typeof sender.tab.id === "number" ? sender.tab.id : undefined;
}

function senderFrameKey(sender: TranslationSender): string | undefined {
  const tabId = senderTabId(sender);
  return tabId === undefined ? undefined : `${tabId}:${typeof sender.frameId === "number" ? sender.frameId : 0}`;
}

function senderScope(sender: TranslationSender, sessionId: string, documentId = typeof sender.documentId === "string" && sender.documentId ? sender.documentId : "unknown"): string | undefined {
  const tabId = senderTabId(sender);
  return tabId === undefined ? undefined : `tab:${tabId}/frame:${typeof sender.frameId === "number" ? sender.frameId : 0}/document:${documentId}/session:${sessionId}`;
}

export function translationSenderScope(sender: TranslationSender, sessionId: string): string | undefined {
  return senderScope(sender, sessionId);
}

export function createTranslationMessageHandler(dependencies: TranslationMessageHandlerDependencies) {
  const successfulPageResults = new Map<string, TranslationResult & { ok: true }>();
  const documentByFrame = new Map<string, string>();
  const scopesByTab = new Map<number, Set<string>>();
  const rememberScope = (sender: TranslationSender, scope: string | undefined): void => {
    const tabId = senderTabId(sender);
    if (tabId === undefined || !scope) return;
    const scopes = scopesByTab.get(tabId) ?? new Set<string>();
    scopes.add(scope);
    scopesByTab.set(tabId, scopes);
  };
  const forgetScope = (tabId: number | undefined, scope: string | undefined): void => {
    if (tabId === undefined || !scope) return;
    const scopes = scopesByTab.get(tabId);
    scopes?.delete(scope);
    if (scopes?.size === 0) scopesByTab.delete(tabId);
  };
  const forgetDocument = (documentId: string) => {
    for (const key of successfulPageResults.keys()) if (key.startsWith(`${documentId}\u0000`)) successfulPageResults.delete(key);
  };
  const reuseKey = (message: TranslationMessage, sender: TranslationSender): string | undefined => {
    if (typeof sender.documentId !== "string" || !sender.documentId) return undefined;
    const normalizedText = normalizeTranslationSourceText(message.payload.text);
    return `${sender.documentId}\u0000${dependencies.adapter.id}\u0000${dependencies.adapter.version}\u0000${message.payload.sourceLanguage}\u0000${message.payload.targetLanguage}\u0000${normalizedText}`;
  };
  async function authorized(message: TranslationMessage, sender: TranslationSender): Promise<boolean> {
    const site = senderSite(sender);
    return Boolean(
      site &&
      await dependencies.hasHostPermission(site.origin) &&
      await dependencies.isDomainEnabled(site.domain) &&
      await dependencies.permitsSession(sender, message.session.id, message.payload.targetLanguage) &&
      isBaiduMvpDirection(message.payload.sourceLanguage, message.payload.targetLanguage),
    );
  }

  return {
    async handle(message: TranslationMessage, sender: TranslationSender): Promise<TranslationResult> {
      if (!await authorized(message, sender)) return failed(message);
      const scope = translationSenderScope(sender, message.session.id);
      rememberScope(sender, scope);
      const frame = senderFrameKey(sender);
      if (frame && typeof sender.documentId === "string" && sender.documentId) {
        const previous = documentByFrame.get(frame);
        if (previous && previous !== sender.documentId) {
          forgetDocument(previous);
          const previousScope = senderScope(sender, message.session.id, previous);
          dependencies.scheduler?.clearScope(previousScope!);
          forgetScope(senderTabId(sender), previousScope);
        }
        const unknownScope = senderScope(sender, message.session.id, "unknown");
        if (unknownScope && unknownScope !== scope) {
          dependencies.scheduler?.clearScope(unknownScope);
          forgetScope(senderTabId(sender), unknownScope);
        }
        documentByFrame.set(frame, sender.documentId);
      }
      const key = reuseKey(message, sender);
      const cached = key ? successfulPageResults.get(key) : undefined;
      if (cached) return { ok: true, requestId: message.payload.requestId, blockId: message.payload.blockId, output: cached.output };
      if (dependencies.scheduler) {
        if (!scope) return failed(message);
        const result = await dependencies.scheduler.enqueue(message.payload, {
          scope,
          validate: () => authorized(message, sender),
          preflight: dependencies.preflight ? (identity) => dependencies.preflight!(sender, identity, message.session, message.payload.targetLanguage) : undefined,
        });
        if (key && result.ok) successfulPageResults.set(key, result);
        return result;
      }
      try {
        const adapterOutput = await dependencies.adapter.translate(message.payload);
        const result = {
          ok: true as const,
          requestId: message.payload.requestId,
          blockId: message.payload.blockId,
          output: { ...adapterOutput, adapter: dependencies.adapter.id, adapterVersion: dependencies.adapter.version },
        };
        if (key) successfulPageResults.set(key, result);
        return result;
      } catch (error) {
        return error instanceof TranslationAdapterError
          ? { ok: false, requestId: message.payload.requestId, blockId: message.payload.blockId, error: error.failure.error }
          : failed(message);
      }
    },
    clearPageReuse(tabId: number): void {
      for (const [frame, documentId] of documentByFrame) {
        if (!frame.startsWith(`${tabId}:`)) continue;
        documentByFrame.delete(frame);
        forgetDocument(documentId);
      }
      for (const scope of scopesByTab.get(tabId) ?? []) dependencies.scheduler?.clearScope(scope);
      scopesByTab.delete(tabId);
    },
    /** A child-frame navigation must not evict sibling frame or host results. */
    clearFramePageReuse(tabId: number, frameId: number): void {
      const frame = `${tabId}:${frameId}`;
      const documentId = documentByFrame.get(frame);
      documentByFrame.delete(frame);
      if (documentId) forgetDocument(documentId);
      const scopes = scopesByTab.get(tabId);
      if (!scopes) return;
      for (const scope of [...scopes]) {
        if (!scope.startsWith(`tab:${tabId}/frame:${frameId}/`)) continue;
        dependencies.scheduler?.clearScope(scope);
        forgetScope(tabId, scope);
      }
    },
    clearTabSession(tabId: number, sessionId: string): void {
      const scopes = scopesByTab.get(tabId);
      if (!scopes) return;
      for (const scope of [...scopes]) {
        if (!scope.endsWith(`/session:${sessionId}`)) continue;
        dependencies.scheduler?.clearScope(scope);
        forgetScope(tabId, scope);
      }
    },
    /** Cancels every runtime-owned queue and drops only ephemeral page reuse. */
    clearAll(): void {
      for (const scopes of scopesByTab.values()) {
        for (const scope of scopes) dependencies.scheduler?.clearScope(scope);
      }
      scopesByTab.clear();
      documentByFrame.clear();
      successfulPageResults.clear();
    },
  };
}
