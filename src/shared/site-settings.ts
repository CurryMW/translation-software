import type { BaiduLanguageCode } from "./languages";

export const DEFAULT_TARGET_LANGUAGE: BaiduLanguageCode = "zh";

export interface SiteSettings {
  enabled: boolean;
  targetLanguage: BaiduLanguageCode;
}

export type SiteSettingsResult =
  | { ok: true; settings: SiteSettings }
  | {
      ok: false;
      error: "INVALID_DOMAIN" | "UNTRUSTED_SENDER" | "STORAGE_FAILURE";
    };
