import { TRANSLATION_APPEARANCE_MESSAGE_TYPES } from "./messages";
import type { TranslationAppearanceResult } from "./messages";
import type { TranslationAppearanceSettings } from "./translation-appearance";

export interface TranslationAppearanceClient {
  get(): Promise<TranslationAppearanceResult>;
  update(settings: TranslationAppearanceSettings): Promise<TranslationAppearanceResult>;
}

export const chromeTranslationAppearanceClient: TranslationAppearanceClient = {
  async get() {
    return chrome.runtime.sendMessage({ type: TRANSLATION_APPEARANCE_MESSAGE_TYPES.get });
  },
  async update(settings) {
    return chrome.runtime.sendMessage({ type: TRANSLATION_APPEARANCE_MESSAGE_TYPES.update, payload: settings });
  },
};
