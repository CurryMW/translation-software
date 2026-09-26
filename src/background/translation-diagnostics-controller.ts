import { TRANSLATION_PROVIDER_ERROR_CODES, type TranslationAdapterFailure, type TranslationProviderErrorCode } from "../shared/translation";

const DIAGNOSTICS_KEY = "translationProviderDiagnostics";
const DEFAULT_MAXIMUM_ENTRIES = 20;
const PROVIDER_ERROR_CODES = new Set<string>(Object.values(TRANSLATION_PROVIDER_ERROR_CODES));

interface DiagnosticsStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

export interface ProviderDiagnostic {
  category: TranslationProviderErrorCode;
  providerCode?: string;
  occurredAt: number;
}

export interface TranslationDiagnosticsController {
  record(failure: TranslationAdapterFailure): Promise<void>;
}

function safeProviderCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,64}$/u.test(value) ? value : undefined;
}

function recordFrom(failure: TranslationAdapterFailure, now: number): ProviderDiagnostic {
  const providerCode = safeProviderCode(failure.providerCode);
  const occurredAt = Number.isSafeInteger(now) && now >= 0 ? now : 0;
  return providerCode ? { category: failure.error, providerCode, occurredAt } : { category: failure.error, occurredAt };
}

function recordsFrom(value: unknown): ProviderDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (typeof candidate !== "object" || candidate === null) return [];
    const record = candidate as Partial<ProviderDiagnostic>;
    const occurredAt = record.occurredAt;
    if (typeof record.category !== "string" || !PROVIDER_ERROR_CODES.has(record.category) || typeof occurredAt !== "number" || !Number.isSafeInteger(occurredAt) || occurredAt < 0) return [];
    const providerCode = safeProviderCode(record.providerCode);
    return [providerCode ? { category: record.category as TranslationProviderErrorCode, providerCode, occurredAt } : { category: record.category as TranslationProviderErrorCode, occurredAt }];
  });
}

export function createTranslationDiagnosticsController({ storage, now = () => Date.now(), maximumEntries = DEFAULT_MAXIMUM_ENTRIES }: { storage: DiagnosticsStorage; now?: () => number; maximumEntries?: number }): TranslationDiagnosticsController {
  const boundedMaximum = Number.isSafeInteger(maximumEntries) && maximumEntries > 0 ? maximumEntries : DEFAULT_MAXIMUM_ENTRIES;
  let mutation = Promise.resolve();

  return {
    record(failure) {
      const operation = mutation.then(async () => {
        const current = await storage.get(DIAGNOSTICS_KEY);
        const records = recordsFrom(current[DIAGNOSTICS_KEY]);
        const next = [...records, recordFrom(failure, now())].slice(-boundedMaximum);
        await storage.set({ [DIAGNOSTICS_KEY]: next });
      });
      const safeOperation = operation.catch(() => undefined);
      mutation = safeOperation;
      return safeOperation;
    },
  };
}
