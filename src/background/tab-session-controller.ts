import type { BaiduLanguageCode } from "../shared/languages";
import type {
  PageSessionDecisionResult,
  PageSessionDescriptor,
  PageSessionDisposition,
  PageSessionIdentity,
  PageSessionSettingsResult,
} from "../shared/messages";
import type { SiteSettings } from "../shared/site-settings";
import type { TranslationAdapterId, TranslationAdapterVersion } from "../shared/translation";

export type TabSessionIdentity = PageSessionIdentity;
export type TabSessionDescriptor = PageSessionDescriptor;
export type TabSessionResult = PageSessionSettingsResult;
export type TabSessionDecisionResult = PageSessionDecisionResult;

export interface TabSessionSite {
  readonly domain: string;
  readonly origin: string;
}

export interface TabSessionController {
  /** Starts one new foreground stay after all enabled-site checks succeed. */
  foreground(tabId: number): Promise<TabSessionResult>;
  /** Reconnects a newly loaded content script to the current tab stay. */
  connect(tabId: number): Promise<TabSessionResult>;
  /** Removes the current stay and returns the identity that must be paused. */
  pause(tabId: number, expectedSessionId?: string): { session: TabSessionIdentity; reason: "background" } | undefined;
  /** Invalidates all known stays other than the tab becoming foreground. */
  pauseAllExcept(tabId: number): readonly { tabId: number; session: TabSessionIdentity; reason: "background" }[];
  decide(tabId: number, sessionId: string, decision: "accept" | "reject"): Promise<TabSessionDecisionResult>;
  /** Fail-closed gate used at every worker-side submit/preflight boundary. */
  permits(tabId: number, sessionId: string, targetLanguage?: BaiduLanguageCode): Promise<boolean>;
  /** True only while the supplied session remains the current active tab stay. */
  isCurrent(tabId: number, sessionId: string): Promise<boolean>;
  /** Drops active stays for an enabled-site shutdown without retaining page data. */
  invalidateDomain(domain: string): readonly { tabId: number; session: TabSessionIdentity }[];
  /** Keeps live stays aligned with the hostname-scoped language setting. */
  updateDomainTargetLanguage(domain: string, targetLanguage: BaiduLanguageCode): void;
}

interface Dependencies {
  readonly provider:
    | { adapter: TranslationAdapterId; version: TranslationAdapterVersion }
    | (() => { adapter: TranslationAdapterId; version: TranslationAdapterVersion });
  readonly getTabSite: (tabId: number) => Promise<TabSessionSite | undefined>;
  readonly isTabActive: (tabId: number) => Promise<boolean>;
  readonly hasHostPermission: (origin: string) => Promise<boolean>;
  readonly getSettings: (domain: string) => Promise<SiteSettings | undefined>;
  /** Persistent compatibility pauses are fail-closed and cannot be bypassed by a page session. */
  readonly isDomainCompatibilityPaused?: (domain: string) => Promise<boolean>;
  readonly createSessionId?: () => string;
}

interface StoredSession {
  readonly id: string;
  readonly domain: string;
  targetLanguage: BaiduLanguageCode;
  readonly provider: { adapter: TranslationAdapterId; version: TranslationAdapterVersion };
  disposition: PageSessionDisposition;
}

function descriptor(session: StoredSession): TabSessionDescriptor {
  return {
    session: { id: session.id },
    disposition: session.disposition,
    targetLanguage: session.targetLanguage,
    provider: session.provider,
  };
}

function defaultSessionIdFactory(): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `stay-${sequence}-${crypto.randomUUID()}`;
  };
}

/**
 * In-memory authority for a tab's foreground stay. It intentionally stores
 * only a hostname, settings snapshot and opaque stay identity — never a URL,
 * source text, translation output or credential.
 */
export function createTabSessionController(dependencies: Dependencies): TabSessionController {
  const sessions = new Map<number, StoredSession>();
  const connecting = new Map<number, Promise<TabSessionResult>>();
  const tabEpochs = new Map<number, number>();
  const domainEpochs = new Map<string, number>();
  const createSessionId = dependencies.createSessionId ?? defaultSessionIdFactory();
  const currentProvider = () => typeof dependencies.provider === "function" ? dependencies.provider() : dependencies.provider;

  const tabEpoch = (tabId: number) => tabEpochs.get(tabId) ?? 0;
  const advanceTabEpoch = (tabId: number) => {
    const next = tabEpoch(tabId) + 1;
    tabEpochs.set(tabId, next);
    return next;
  };
  const domainEpoch = (domain: string) => domainEpochs.get(domain.toLowerCase()) ?? 0;
  const advanceDomainEpoch = (domain: string) => {
    const normalized = domain.toLowerCase();
    domainEpochs.set(normalized, domainEpoch(normalized) + 1);
  };

  async function enabledCurrentSite(tabId: number): Promise<{ site: TabSessionSite; settings: SiteSettings } | undefined> {
    try {
      if (!await dependencies.isTabActive(tabId)) return undefined;
      const site = await dependencies.getTabSite(tabId);
      if (!site) return undefined;
      if (dependencies.isDomainCompatibilityPaused && await dependencies.isDomainCompatibilityPaused(site.domain)) return undefined;
      const expectedDomainEpoch = domainEpoch(site.domain);
      const [permitted, settings] = await Promise.all([
        dependencies.hasHostPermission(site.origin),
        dependencies.getSettings(site.domain),
      ]);
      if (!permitted || !settings?.enabled || !await dependencies.isTabActive(tabId)) return undefined;
      const latestSite = await dependencies.getTabSite(tabId);
      return latestSite?.domain === site.domain && latestSite.origin === site.origin && domainEpoch(site.domain) === expectedDomainEpoch ? { site, settings } : undefined;
    } catch {
      return undefined;
    }
  }

  function createForegroundSession(tabId: number, current: { site: TabSessionSite; settings: SiteSettings }): TabSessionResult {
    const next: StoredSession = {
      id: createSessionId(),
      domain: current.site.domain,
      targetLanguage: current.settings.targetLanguage,
      provider: { ...currentProvider() },
      disposition: "awaiting-decision",
    };
    sessions.set(tabId, next);
    return { ok: true, ...descriptor(next) };
  }

  async function newForegroundSession(tabId: number): Promise<TabSessionResult> {
    const expectedTabEpoch = advanceTabEpoch(tabId);
    const current = await enabledCurrentSite(tabId);
    return current && tabEpoch(tabId) === expectedTabEpoch ? createForegroundSession(tabId, current) : { ok: false, error: "UNAVAILABLE" };
  }

  async function readCurrentForegroundSession(tabId: number): Promise<TabSessionResult> {
    const expectedTabEpoch = tabEpoch(tabId);
    const current = await enabledCurrentSite(tabId);
    if (!current || tabEpoch(tabId) !== expectedTabEpoch) return { ok: false, error: "UNAVAILABLE" };
    const stored = sessions.get(tabId);
    if (stored?.domain === current.site.domain) {
      // Target language is a hostname setting, not consent. A reconnect after
      // a route change must see its latest value without creating a new stay.
      stored.targetLanguage = current.settings.targetLanguage;
      return { ok: true, ...descriptor(stored) };
    }
    return createForegroundSession(tabId, current);
  }

  function currentForegroundSession(tabId: number): Promise<TabSessionResult> {
    const existing = connecting.get(tabId);
    if (existing) return existing;
    const next = readCurrentForegroundSession(tabId).finally(() => {
      if (connecting.get(tabId) === next) connecting.delete(tabId);
    });
    connecting.set(tabId, next);
    return next;
  }

  async function isCurrentSession(tabId: number, sessionId: string): Promise<boolean> {
    const stored = sessions.get(tabId);
    if (!stored || stored.id !== sessionId) return false;
    const current = await enabledCurrentSite(tabId);
    return sessions.get(tabId) === stored && current?.site.domain === stored.domain;
  }

  async function permitsSession(tabId: number, sessionId: string, targetLanguage?: BaiduLanguageCode): Promise<boolean> {
    const stored = sessions.get(tabId);
    if (!stored || stored.id !== sessionId || stored.disposition !== "allowed") return false;
    if (!await isCurrentSession(tabId, sessionId)) return false;
    const current = sessions.get(tabId);
    return Boolean(
      current &&
      current.id === sessionId &&
      current.disposition === "allowed" &&
      (targetLanguage === undefined || current.targetLanguage === targetLanguage),
    );
  }

  async function decideSession(tabId: number, sessionId: string, decision: "accept" | "reject"): Promise<TabSessionDecisionResult> {
    const stored = sessions.get(tabId);
    if (!stored || stored.id !== sessionId) return { ok: false, error: "STALE_SESSION" };
    if (!await isCurrentSession(tabId, sessionId)) {
      sessions.delete(tabId);
      return { ok: false, error: "UNAVAILABLE" };
    }
    if (stored.disposition === "awaiting-decision") stored.disposition = decision === "accept" ? "allowed" : "rejected";
    return { ok: true, disposition: stored.disposition === "allowed" ? "allowed" : "rejected" };
  }

  return {
    foreground: newForegroundSession,
    connect: currentForegroundSession,
    pause(tabId, expectedSessionId) {
      const stored = sessions.get(tabId);
      if (!stored) {
        if (expectedSessionId === undefined) advanceTabEpoch(tabId);
        return undefined;
      }
      if (expectedSessionId !== undefined && stored.id !== expectedSessionId) return undefined;
      advanceTabEpoch(tabId);
      sessions.delete(tabId);
      connecting.delete(tabId);
      return { session: { id: stored.id }, reason: "background" };
    },
    pauseAllExcept(tabId) {
      const paused: Array<{ tabId: number; session: TabSessionIdentity; reason: "background" }> = [];
      const knownTabs = new Set([...sessions.keys(), ...connecting.keys()]);
      for (const otherTabId of knownTabs) {
        if (otherTabId === tabId) continue;
        advanceTabEpoch(otherTabId);
        const stored = sessions.get(otherTabId);
        if (!stored) continue;
        sessions.delete(otherTabId);
        connecting.delete(otherTabId);
        paused.push({ tabId: otherTabId, session: { id: stored.id }, reason: "background" });
      }
      return paused;
    },
    decide: decideSession,
    permits: permitsSession,
    isCurrent: isCurrentSession,
    invalidateDomain(domain) {
      const normalized = domain.toLowerCase();
      advanceDomainEpoch(normalized);
      const invalidated: Array<{ tabId: number; session: TabSessionIdentity }> = [];
      for (const [tabId, stored] of sessions) {
        if (stored.domain !== normalized) continue;
        advanceTabEpoch(tabId);
        sessions.delete(tabId);
        connecting.delete(tabId);
        invalidated.push({ tabId, session: { id: stored.id } });
      }
      return invalidated;
    },
    updateDomainTargetLanguage(domain, targetLanguage) {
      const normalized = domain.toLowerCase();
      for (const stored of sessions.values()) if (stored.domain === normalized) stored.targetLanguage = targetLanguage;
    },
  };
}
