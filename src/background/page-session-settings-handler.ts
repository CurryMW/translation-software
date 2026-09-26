import type { PageSessionSettingsResult } from "../shared/messages";
import type { TranslationTextColorId } from "../shared/translation-appearance";

interface PageSessionSettingsSender {
  tab?: unknown;
  url?: string;
}

interface PageSessionSettingsDependencies {
  connect(tabId: number): Promise<PageSessionSettingsResult>;
  /** Re-checks that an asynchronously read descriptor still belongs to the foreground stay. */
  isCurrent(tabId: number, sessionId: string): Promise<boolean>;
  /** Idempotently abandons only the descriptor that was just read. */
  pause(tabId: number, sessionId: string): void;
  getTextColor?(): Promise<TranslationTextColorId>;
}

function contentTabId(sender: PageSessionSettingsSender): number | undefined {
  if (!sender.tab || !sender.url || typeof sender.tab !== "object" || sender.tab === null || !("id" in sender.tab) || typeof sender.tab.id !== "number") return undefined;
  try {
    const url = new URL(sender.url);
    return url.protocol === "http:" || url.protocol === "https:" ? sender.tab.id : undefined;
  } catch {
    return undefined;
  }
}

/** Public service-worker seam for one content script's current page session. */
export function createPageSessionSettingsHandler(dependencies: PageSessionSettingsDependencies) {
  return {
    async handle(sender: PageSessionSettingsSender): Promise<PageSessionSettingsResult> {
      const tabId = contentTabId(sender);
      if (tabId === undefined) return { ok: false, error: "UNAVAILABLE" };
      const result = await dependencies.connect(tabId);
      if (!result.ok) return result;
      if (await dependencies.isCurrent(tabId, result.session.id)) {
        const textColor = await dependencies.getTextColor?.();
        return textColor ? { ...result, textColor } : result;
      }
      dependencies.pause(tabId, result.session.id);
      return { ok: false, error: "UNAVAILABLE" };
    },
  };
}
