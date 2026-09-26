import { DEFAULT_TARGET_LANGUAGE, type SiteSettings, type SiteSettingsResult } from "../shared/site-settings";
import { isSiteSettingsMessage, type SiteSettingsMessage } from "../shared/messages";
import { isBaiduLanguageCode } from "../shared/languages";

const STORAGE_KEY = "siteSettingsByDomain";

type Sender = {
  url?: string;
  tab?: unknown;
};

interface SiteSettingsStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

interface StoredSiteSettings {
  [domain: string]: SiteSettings;
}

export interface SiteSettingsController {
  handle(message: unknown, sender: Sender, extensionId: string): Promise<SiteSettingsResult>;
  disableDomains(domains: readonly string[]): Promise<void>;
  enabledDomains(): Promise<string[]>;
  isDomainEnabled(domain: string): Promise<boolean>;
  settingsForDomain(domain: string): Promise<SiteSettings | undefined>;
}

function isTrustedExtensionPage(sender: Sender, extensionId: string): boolean {
  return typeof sender.url === "string" && sender.url.startsWith(`chrome-extension://${extensionId}/`);
}

function isDomain(value: string): boolean {
  try {
    return new URL(`https://${value}`).hostname === value.toLowerCase();
  } catch {
    return false;
  }
}

function isSiteSettings(value: unknown): value is SiteSettings {
  if (typeof value !== "object" || value === null) return false;
  const settings = value as Partial<SiteSettings>;
  return typeof settings.enabled === "boolean" && isBaiduLanguageCode(settings.targetLanguage);
}

function storedSettings(value: unknown): StoredSiteSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, SiteSettings] => isSiteSettings(entry[1])),
  );
}

function defaultSettings(): SiteSettings {
  return { enabled: false, targetLanguage: DEFAULT_TARGET_LANGUAGE };
}

async function readSettings(storage: SiteSettingsStorage): Promise<StoredSiteSettings> {
  const stored = await storage.get(STORAGE_KEY);
  return storedSettings(stored[STORAGE_KEY]);
}

function domainFrom(message: SiteSettingsMessage): string {
  return message.payload.domain.toLowerCase();
}

function domainFromPermissionOrigin(origin: string): string | undefined {
  try {
    const url = new URL(origin.endsWith("/*") ? origin.slice(0, -2) : origin);
    return (url.protocol === "http:" || url.protocol === "https:") ? url.hostname : undefined;
  } catch {
    return undefined;
  }
}

export function createSiteSettingsController({ storage }: { storage: SiteSettingsStorage }): SiteSettingsController {
  return {
    async handle(message, sender, extensionId) {
      if (!isSiteSettingsMessage(message)) return { ok: false, error: "UNTRUSTED_SENDER" };
      if (!isTrustedExtensionPage(sender, extensionId)) return { ok: false, error: "UNTRUSTED_SENDER" };

      const domain = domainFrom(message);
      if (!isDomain(domain)) return { ok: false, error: "INVALID_DOMAIN" };

      try {
        const settings = await readSettings(storage);
        const current = settings[domain] ?? defaultSettings();
        if (message.type === "site-settings.get") return { ok: true, settings: current };

        const nextValue = message.type === "site-settings.set-enabled"
          ? { ...current, enabled: message.payload.enabled }
          : { ...current, targetLanguage: message.payload.targetLanguage };
        const next = { ...settings, [domain]: nextValue };
        await storage.set({ [STORAGE_KEY]: next });
        return { ok: true, settings: next[domain] };
      } catch {
        return { ok: false, error: "STORAGE_FAILURE" };
      }
    },

    async disableDomains(origins) {
      const domains = new Set(origins.map(domainFromPermissionOrigin).filter((domain): domain is string => Boolean(domain)));
      if (domains.size === 0) return;
      try {
        const settings = await readSettings(storage);
        let changed = false;
        for (const domain of domains) {
          const current = settings[domain];
          if (current?.enabled) {
            settings[domain] = { ...current, enabled: false };
            changed = true;
          }
        }
        if (changed) await storage.set({ [STORAGE_KEY]: settings });
      } catch {
        // 权限已由 Chrome 撤销；存储失败不能恢复页面会话。
      }
    },
    async enabledDomains() {
      try {
        return Object.entries(await readSettings(storage)).filter(([, settings]) => settings.enabled).map(([domain]) => domain);
      } catch { return []; }
    },
    async isDomainEnabled(domain) {
      if (!isDomain(domain.toLowerCase())) return false;
      try {
        return Boolean((await readSettings(storage))[domain.toLowerCase()]?.enabled);
      } catch { return false; }
    },
    async settingsForDomain(domain) {
      if (!isDomain(domain.toLowerCase())) return undefined;
      try {
        return (await readSettings(storage))[domain.toLowerCase()] ?? defaultSettings();
      } catch { return undefined; }
    },
  };
}
