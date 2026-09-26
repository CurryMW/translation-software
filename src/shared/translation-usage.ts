export const BAIDU_PLAN_OPTIONS = [
  { id: "standard", label: "标准版" },
  { id: "advanced", label: "高级版" },
] as const;

export type BaiduPlanId = (typeof BAIDU_PLAN_OPTIONS)[number]["id"];

export interface BaiduPlanLimits {
  readonly maxConcurrency: number;
  readonly qps: number;
  readonly safeRequestCharacters: number;
}

export const BAIDU_PLAN_LIMITS: Readonly<Record<BaiduPlanId, BaiduPlanLimits>> = {
  standard: { maxConcurrency: 1, qps: 1, safeRequestCharacters: 1_000 },
  advanced: { maxConcurrency: 10, qps: 10, safeRequestCharacters: 6_000 },
};

export interface TranslationUsageSettings {
  plan: BaiduPlanId;
  monthlyCharacterBudget: number;
}

export const DEFAULT_TRANSLATION_USAGE_SETTINGS: Readonly<TranslationUsageSettings> = {
  plan: "standard",
  monthlyCharacterBudget: 50_000,
};

export interface TranslationUsageSnapshot {
  settings: TranslationUsageSettings;
  periodKey: string;
  submittedCharacters: number;
  remainingCharacters: number;
}

export type TranslationUsageResult =
  | { ok: true; snapshot: TranslationUsageSnapshot }
  | { ok: false; error: "INVALID_SETTINGS" | "UNTRUSTED_SENDER" | "STORAGE_FAILURE" };

export function isBaiduPlanId(value: unknown): value is BaiduPlanId {
  return value === "standard" || value === "advanced";
}

export function isTranslationUsageSettings(value: unknown): value is TranslationUsageSettings {
  if (typeof value !== "object" || value === null) return false;
  const settings = value as Partial<TranslationUsageSettings>;
  return (
    isBaiduPlanId(settings.plan) &&
    Number.isSafeInteger(settings.monthlyCharacterBudget) &&
    (settings.monthlyCharacterBudget ?? -1) >= 0
  );
}

export function countSourceCharacters(text: string): number {
  return [...text].length;
}
