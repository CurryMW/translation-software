import {
  DEFAULT_TRANSLATION_USAGE_SETTINGS,
  isTranslationUsageSettings,
  type TranslationUsageResult,
  type TranslationUsageSettings,
  type TranslationUsageSnapshot,
} from "../shared/translation-usage";
import type { BaiduPlanId } from "../shared/translation-usage";
import { isTranslationUsageMessage, type TranslationUsageMessage } from "../shared/messages";

const SETTINGS_KEY = "translationUsageSettings";
const LEDGER_KEY = "translationUsageLedger";

interface UsageStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

interface UsageLedger {
  periodKey: string;
  submittedCharacters: number;
}

interface UsageSender { url?: string }

export type ReservationResult =
  | { ok: true; snapshot: TranslationUsageSnapshot }
  | { ok: false; error: "BUDGET_EXHAUSTED" | "STORAGE_FAILURE" };

export type PlanBoundReservationResult =
  | ReservationResult
  | { ok: false; error: "ACCOUNT_REVIEW_REQUIRED" };

export interface TranslationUsageController {
  handle(message: unknown, sender: UsageSender, extensionId: string): Promise<TranslationUsageResult>;
  snapshot(): Promise<TranslationUsageSnapshot>;
  reserveBeforeSubmit(characterCount: number): Promise<ReservationResult>;
  /** Atomically confirms the reviewed plan while reserving manual-smoke budget. */
  reserveForPlanBeforeSubmit(characterCount: number, reviewedPlan: BaiduPlanId): Promise<PlanBoundReservationResult>;
  releaseReservedCharacters(characterCount: number, periodKey: string): Promise<void>;
}

function periodFor(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function trustedExtensionPage(sender: UsageSender, extensionId: string): boolean {
  return typeof sender.url === "string" && sender.url.startsWith(`chrome-extension://${extensionId}/`);
}

function trustedOptionsPage(sender: UsageSender, extensionId: string): boolean {
  return sender.url === `chrome-extension://${extensionId}/options.html`;
}

function settingsFrom(value: unknown): TranslationUsageSettings {
  return isTranslationUsageSettings(value) ? value : { ...DEFAULT_TRANSLATION_USAGE_SETTINGS };
}

function ledgerFrom(value: unknown, periodKey: string): UsageLedger {
  if (typeof value !== "object" || value === null) return { periodKey, submittedCharacters: 0 };
  const ledger = value as Partial<UsageLedger>;
  if (ledger.periodKey !== periodKey || !Number.isSafeInteger(ledger.submittedCharacters) || (ledger.submittedCharacters ?? -1) < 0) {
    return { periodKey, submittedCharacters: 0 };
  }
  return { periodKey, submittedCharacters: ledger.submittedCharacters! };
}

function snapshot(settings: TranslationUsageSettings, ledger: UsageLedger): TranslationUsageSnapshot {
  return {
    settings,
    periodKey: ledger.periodKey,
    submittedCharacters: ledger.submittedCharacters,
    remainingCharacters: Math.max(0, settings.monthlyCharacterBudget - ledger.submittedCharacters),
  };
}

export function createTranslationUsageController({ storage, now = () => new Date() }: { storage: UsageStorage; now?: () => Date }): TranslationUsageController {
  let mutation = Promise.resolve();

  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutation.then(operation, operation);
    mutation = result.then(() => undefined, () => undefined);
    return result;
  }

  async function current(): Promise<{ settings: TranslationUsageSettings; ledger: UsageLedger }> {
    const stored = await storage.get(SETTINGS_KEY);
    const settings = settingsFrom(stored[SETTINGS_KEY]);
    const ledgerStored = await storage.get(LEDGER_KEY);
    const ledger = ledgerFrom(ledgerStored[LEDGER_KEY], periodFor(now()));
    return { settings, ledger };
  }

  async function persist(settings: TranslationUsageSettings, ledger: UsageLedger): Promise<void> {
    await storage.set({ [SETTINGS_KEY]: settings, [LEDGER_KEY]: ledger });
  }

  return {
    async handle(message, sender, extensionId) {
      if (!isTranslationUsageMessage(message)) return { ok: false, error: "INVALID_SETTINGS" };
      if (!trustedExtensionPage(sender, extensionId)) return { ok: false, error: "UNTRUSTED_SENDER" };
      // Reading usage is safe from an extension page, but changing plan or
      // budget invalidates real-provider authorization and is options-only.
      if (message.type === "translation-usage.update" && !trustedOptionsPage(sender, extensionId)) return { ok: false, error: "UNTRUSTED_SENDER" };
      return serial(async () => {
        try {
          const { settings: storedSettings, ledger } = await current();
          const settings = message.type === "translation-usage.update" ? message.payload : storedSettings;
          if (!isTranslationUsageSettings(settings)) return { ok: false, error: "INVALID_SETTINGS" };
          await persist(settings, ledger);
          return { ok: true, snapshot: snapshot(settings, ledger) };
        } catch {
          return { ok: false, error: "STORAGE_FAILURE" };
        }
      });
    },

    async snapshot() {
      return serial(async () => {
        const { settings, ledger } = await current();
        await persist(settings, ledger);
        return snapshot(settings, ledger);
      });
    },

    async reserveBeforeSubmit(characterCount) {
      if (!Number.isSafeInteger(characterCount) || characterCount < 0) return { ok: false, error: "BUDGET_EXHAUSTED" };
      return serial(async () => {
        try {
          const { settings, ledger } = await current();
          if (characterCount > settings.monthlyCharacterBudget - ledger.submittedCharacters) return { ok: false, error: "BUDGET_EXHAUSTED" };
          const next = { ...ledger, submittedCharacters: ledger.submittedCharacters + characterCount };
          await persist(settings, next);
          return { ok: true, snapshot: snapshot(settings, next) };
        } catch {
          return { ok: false, error: "STORAGE_FAILURE" };
        }
      });
    },

    async reserveForPlanBeforeSubmit(characterCount, reviewedPlan) {
      if (!Number.isSafeInteger(characterCount) || characterCount < 0) return { ok: false, error: "BUDGET_EXHAUSTED" };
      return serial(async () => {
        try {
          const { settings, ledger } = await current();
          if (settings.plan !== reviewedPlan) return { ok: false, error: "ACCOUNT_REVIEW_REQUIRED" };
          if (characterCount > settings.monthlyCharacterBudget - ledger.submittedCharacters) return { ok: false, error: "BUDGET_EXHAUSTED" };
          const next = { ...ledger, submittedCharacters: ledger.submittedCharacters + characterCount };
          await persist(settings, next);
          return { ok: true, snapshot: snapshot(settings, next) };
        } catch {
          return { ok: false, error: "STORAGE_FAILURE" };
        }
      });
    },

    async releaseReservedCharacters(characterCount, periodKey) {
      if (!Number.isSafeInteger(characterCount) || characterCount < 0) return;
      await serial(async () => {
        const { settings, ledger } = await current();
        if (ledger.periodKey !== periodKey) return;
        const next = { ...ledger, submittedCharacters: Math.max(0, ledger.submittedCharacters - characterCount) };
        await persist(settings, next);
      });
    },
  };
}
