import {
  DEFAULT_TRANSLATION_APPEARANCE,
  isTranslationAppearanceSettings,
  type TranslationAppearanceSettings,
} from "../shared/translation-appearance";
import { isTranslationAppearanceMessage, type TranslationAppearanceResult } from "../shared/messages";

const STORAGE_KEY = "translationAppearanceSettings";

interface AppearanceStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

interface AppearanceSender {
  url?: string;
}

function trustedExtensionPage(sender: AppearanceSender, extensionId: string): boolean {
  return typeof sender.url === "string" && sender.url.startsWith(`chrome-extension://${extensionId}/`);
}

function trustedWebPage(sender: AppearanceSender): boolean {
  try {
    const url = new URL(sender.url ?? "");
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function storedSettings(value: unknown): TranslationAppearanceSettings {
  return isTranslationAppearanceSettings(value) ? value : { ...DEFAULT_TRANSLATION_APPEARANCE };
}

export interface TranslationAppearanceController {
  handle(message: unknown, sender: AppearanceSender, extensionId: string): Promise<TranslationAppearanceResult>;
  get(): Promise<TranslationAppearanceSettings>;
}

export function createTranslationAppearanceController({ storage }: { storage: AppearanceStorage }): TranslationAppearanceController {
  return {
    async get() {
      try {
        const stored = await storage.get(STORAGE_KEY);
        return storedSettings(stored[STORAGE_KEY]);
      } catch {
        return { ...DEFAULT_TRANSLATION_APPEARANCE };
      }
    },
    async handle(message, sender, extensionId) {
      if (!isTranslationAppearanceMessage(message)) return { ok: false, error: "INVALID_SETTINGS" };
      const isGet = message.type === "translation-appearance.get";
      const authorized = isGet
        ? trustedExtensionPage(sender, extensionId) || trustedWebPage(sender)
        : trustedExtensionPage(sender, extensionId) && sender.url === `chrome-extension://${extensionId}/options.html`;
      if (!authorized) return { ok: false, error: "UNTRUSTED_SENDER" };
      try {
        const stored = await storage.get(STORAGE_KEY);
        const settings = isGet ? storedSettings(stored[STORAGE_KEY]) : message.payload;
        if (!isTranslationAppearanceSettings(settings)) return { ok: false, error: "INVALID_SETTINGS" };
        if (!isGet) await storage.set({ [STORAGE_KEY]: settings });
        return { ok: true, settings };
      } catch {
        return { ok: false, error: "STORAGE_FAILURE" };
      }
    },
  };
}
