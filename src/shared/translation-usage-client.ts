import { USAGE_MESSAGE_TYPES } from "./messages";
import type { TranslationUsageResult, TranslationUsageSettings } from "./translation-usage";

export interface TranslationUsageClient {
  get(): Promise<TranslationUsageResult>;
  update(settings: TranslationUsageSettings): Promise<TranslationUsageResult>;
}

export const chromeTranslationUsageClient: TranslationUsageClient = {
  async get() {
    return chrome.runtime.sendMessage({ type: USAGE_MESSAGE_TYPES.get });
  },
  async update(settings) {
    return chrome.runtime.sendMessage({ type: USAGE_MESSAGE_TYPES.update, payload: settings });
  },
};
