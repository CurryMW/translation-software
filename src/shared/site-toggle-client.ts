import type { PageSessionMessage } from "./messages";
import { SITE_MESSAGE_TYPES } from "./messages";
import type { BaiduLanguageCode } from "./languages";
import type { SiteSettings, SiteSettingsResult } from "./site-settings";
import { siteMatchPatterns, siteScriptId } from "./site-script-registration";
import { siteIdentityFromUrl } from "./site-identity";

export type SiteStatus =
  | { kind: "unsupported" }
  | { kind: "not-authorized"; domain: string }
  | { kind: "authorized"; domain: string; settings: SiteSettings };

export type SiteToggleResult =
  | { ok: true; status: SiteStatus }
  | { ok: false; error: "PERMISSION_DENIED" | "SITE_SETTINGS_FAILURE" | "INJECTION_FAILURE" };

export interface SiteToggleClient {
  status(): Promise<SiteStatus>;
  enable(): Promise<SiteToggleResult>;
  disable(): Promise<SiteToggleResult>;
  setTargetLanguage(targetLanguage: BaiduLanguageCode): Promise<SiteToggleResult>;
}

interface CurrentSite {
  tabId: number;
  domain: string;
  origin: string;
}

function currentSiteFromTab(tab: chrome.tabs.Tab | undefined): CurrentSite | undefined {
  if (typeof tab?.id !== "number") return undefined;
  const identity = siteIdentityFromUrl(tab.url);
  return identity && { tabId: tab.id, ...identity };
}

async function activeSite(): Promise<CurrentSite | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return currentSiteFromTab(tab);
}

let lastPopupSite: CurrentSite | undefined;

async function popupSite(): Promise<CurrentSite | undefined> {
  if (lastPopupSite) return lastPopupSite;
  const current = await activeSite();
  if (current) lastPopupSite = current;
  return current;
}

async function currentPopupSite(): Promise<CurrentSite | undefined> {
  const current = await activeSite();
  if (current) lastPopupSite = current;
  return current;
}

async function settingFor(domain: string): Promise<SiteSettingsResult> {
  return chrome.runtime.sendMessage({ type: SITE_MESSAGE_TYPES.get, payload: { domain } });
}

async function setEnabled(domain: string, enabled: boolean): Promise<SiteSettingsResult> {
  return chrome.runtime.sendMessage({ type: SITE_MESSAGE_TYPES.setEnabled, payload: { domain, enabled } });
}

async function statusFor(site: CurrentSite): Promise<SiteStatus> {
  const granted = await chrome.permissions.contains({ origins: [site.origin] });
  if (!granted) return { kind: "not-authorized", domain: site.domain };

  const result = await settingFor(site.domain);
  if (!result.ok) throw new Error("网站设置不可用");
  return { kind: "authorized", domain: site.domain, settings: result.settings };
}

async function grantedMatches(domain: string, knownGrantedOrigin?: string): Promise<string[]> {
  const candidates = siteMatchPatterns(domain);
  const results = await Promise.all(candidates.map(async (origin) => (
    origin === knownGrantedOrigin || await chrome.permissions.contains({ origins: [origin] }) ? origin : undefined
  )));
  return results.filter((origin): origin is string => Boolean(origin));
}

async function registerForDomain(domain: string, previous: chrome.scripting.RegisteredContentScript[], knownGrantedOrigin?: string): Promise<void> {
  const id = siteScriptId(domain);
  const matches = await grantedMatches(domain, knownGrantedOrigin);
  if (!matches.length) throw new Error("缺少网站权限");
  const script = { id, js: ["content-script.js"], matches, allFrames: true, runAt: "document_idle" as const, persistAcrossSessions: true };
  if (previous.length) await chrome.scripting.updateContentScripts([script]);
  else await chrome.scripting.registerContentScripts([script]);
}

async function restoreRegistration(id: string, previous: chrome.scripting.RegisteredContentScript[]): Promise<void> {
  if (previous.length) await chrome.scripting.updateContentScripts(previous);
  else await chrome.scripting.unregisterContentScripts({ ids: [id] });
}

function frameOriginPattern(url: string): string | undefined {
  return siteIdentityFromUrl(url)?.origin;
}

/**
 * An atomic allFrames request can fail because one document is outside the
 * current host grants. Retain the top-level enablement in that case, then use
 * the browser's current frame inventory to inject each independently granted
 * child. The same inventory pass also covers Chromium's safe-skip behavior
 * when an allFrames request resolves without reaching a denied child. Frame
 * URLs are intentionally used only inside this function to form a
 * host-permission query; none are returned, cached, or logged.
 */
async function injectCurrentSite(tabId: number): Promise<void> {
  const injectedFrameIds = new Set<number>();
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content-script.js"] });
    for (const result of results ?? []) injectedFrameIds.add(result.frameId);
  } catch {
    const results = await chrome.scripting.executeScript({ target: { tabId }, files: ["content-script.js"] });
    for (const result of results ?? []) injectedFrameIds.add(result.frameId);
    injectedFrameIds.add(0);
  }

  let frames: chrome.webNavigation.GetAllFrameResultDetails[] | null;
  try {
    frames = await chrome.webNavigation.getAllFrames({ tabId });
  } catch {
    return;
  }
  if (!frames) return;

  for (const frame of frames) {
    if (frame.frameId === 0 || injectedFrameIds.has(frame.frameId)) continue;
    const origin = frameOriginPattern(frame.url);
    if (!origin) continue;
    try {
      if (!await chrome.permissions.contains({ origins: [origin] })) continue;
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [frame.frameId] }, files: ["content-script.js"] });
    } catch {
      // A navigation or per-frame access failure must not roll back top-level enablement.
    }
  }
}

const stopMessage: PageSessionMessage = {
  type: SITE_MESSAGE_TYPES.stopSession,
  payload: { reason: "site-disabled", scope: { kind: "current-document" } },
};

function targetLanguageChangedMessage(targetLanguage: BaiduLanguageCode): PageSessionMessage {
  return {
    type: SITE_MESSAGE_TYPES.targetLanguageChanged,
    payload: { targetLanguage, scope: { kind: "current-document" } },
  };
}

const enableOperations = new Map<string, Promise<SiteToggleResult>>();

async function enableSite(site: CurrentSite): Promise<SiteToggleResult> {
  const id = siteScriptId(site.domain);
  const [permissionCheck, registrationSnapshot] = await Promise.allSettled([
    chrome.permissions.contains({ origins: [site.origin] }),
    chrome.scripting.getRegisteredContentScripts({ ids: [id] }),
  ]);
  if (registrationSnapshot.status === "rejected") return { ok: false, error: "INJECTION_FAILURE" };
  if (permissionCheck.status === "rejected") return { ok: false, error: "PERMISSION_DENIED" };
  const previous = registrationSnapshot.value;
  let granted = permissionCheck.value;
  try {
    if (!granted) granted = await chrome.permissions.request({ origins: [site.origin] });
  } catch {
    return { ok: false, error: "PERMISSION_DENIED" };
  }
  if (!granted) return { ok: false, error: "PERMISSION_DENIED" };

  const [registration, setting] = await Promise.allSettled([registerForDomain(site.domain, previous, site.origin), setEnabled(site.domain, true)]);
  const result = setting.status === "fulfilled" ? setting.value : undefined;
  if (registration.status !== "fulfilled" || !result?.ok) {
    if (registration.status === "fulfilled") await restoreRegistration(id, previous).catch(() => undefined);
    if (result?.ok) await setEnabled(site.domain, false).catch(() => undefined);
    return { ok: false, error: registration.status !== "fulfilled" ? "INJECTION_FAILURE" : "SITE_SETTINGS_FAILURE" };
  }
  try {
    await injectCurrentSite(site.tabId);
  } catch {
    await setEnabled(site.domain, false).catch(() => undefined);
    await restoreRegistration(id, previous).catch(() => undefined);
    return { ok: false, error: "INJECTION_FAILURE" };
  }
  return { ok: true, status: { kind: "authorized", domain: site.domain, settings: result.settings } };
}

export const chromeSiteToggleClient: SiteToggleClient = {
  async status() {
    const site = await currentPopupSite();
    return site ? statusFor(site) : { kind: "unsupported" };
  },

  async enable() {
    const site = await popupSite();
    if (!site) return { ok: false, error: "PERMISSION_DENIED" };
    const existing = enableOperations.get(site.domain);
    if (existing) return existing;
    const operation = enableSite(site).finally(() => {
      if (enableOperations.get(site.domain) === operation) enableOperations.delete(site.domain);
    });
    enableOperations.set(site.domain, operation);
    return operation;
  },

  async disable() {
    const site = await popupSite();
    if (!site) return { ok: false, error: "PERMISSION_DENIED" };

    const id = siteScriptId(site.domain);
    const previous = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
    try {
      if (previous.length) await chrome.scripting.unregisterContentScripts({ ids: [id] });
    } catch { return { ok: false, error: "INJECTION_FAILURE" }; }
    const result = await setEnabled(site.domain, false);
    if (!result.ok) {
      try {
        if (previous.length) await chrome.scripting.registerContentScripts(previous);
      } catch {
        let retry: SiteSettingsResult;
        try { retry = await setEnabled(site.domain, false); }
        catch { return { ok: false, error: "SITE_SETTINGS_FAILURE" }; }
        if (retry.ok) {
          await chrome.tabs.sendMessage(site.tabId, stopMessage).catch(() => undefined);
          return { ok: true, status: { kind: "authorized", domain: site.domain, settings: retry.settings } };
        }
      }
      return { ok: false, error: "SITE_SETTINGS_FAILURE" };
    }
    try {
      await chrome.tabs.sendMessage(site.tabId, stopMessage);
    } catch {
      // 当前页面尚未注入时没有接收者；设置已经安全地关闭。
    }
    return { ok: true, status: { kind: "authorized", domain: site.domain, settings: result.settings } };
  },

  async setTargetLanguage(targetLanguage) {
    const site = await popupSite();
    if (!site) return { ok: false, error: "PERMISSION_DENIED" };
    const granted = await chrome.permissions.contains({ origins: [site.origin] });
    if (!granted) return { ok: false, error: "PERMISSION_DENIED" };
    const result: SiteSettingsResult = await chrome.runtime.sendMessage({
      type: SITE_MESSAGE_TYPES.setTargetLanguage,
      payload: { domain: site.domain, targetLanguage },
    });
    if (!result.ok) return { ok: false, error: "SITE_SETTINGS_FAILURE" };
    if (result.settings.enabled) {
      try {
        await chrome.tabs.sendMessage(site.tabId, targetLanguageChangedMessage(result.settings.targetLanguage));
      } catch {
        // A newly opened enabled page can receive its setting during content-script startup.
      }
    }
    return { ok: true, status: { kind: "authorized", domain: site.domain, settings: result.settings } };
  },
};
