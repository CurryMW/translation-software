import type { BaiduPlanId } from "./translation-usage";
import type { TranslationProviderErrorCode } from "./translation";

export interface BaiduAccountReview {
  plan: BaiduPlanId;
  quotaAndPricingConfirmed: boolean;
  qpsConfirmed: boolean;
  languageDirectionsConfirmed: boolean;
  singleRequestLengthConfirmed: boolean;
  dataTermsConfirmed: boolean;
}

export type BaiduManualSmokeError =
  | "UNTRUSTED_SENDER"
  | "NOT_CONFIGURED"
  | "ACCOUNT_REVIEW_REQUIRED"
  | "PERMISSION_REQUIRED"
  | "BUDGET_EXHAUSTED"
  | "CONFIRMATION_EXPIRED"
  | "CONFIRMATION_USED"
  | "CREDENTIAL_STORAGE_FAILURE"
  | "USAGE_STORAGE_FAILURE"
  | "TOKEN_GENERATION_FAILURE"
  | "PREPARE_INTERNAL_FAILURE"
  | "USAGE_RESERVATION_FAILURE"
  | "READINESS_STORAGE_FAILURE"
  | "RUN_INTERNAL_FAILURE"
  | "WORKER_OPERATION_FAILURE"
  | "STORAGE_FAILURE"
  | TranslationProviderErrorCode;

export type BaiduManualSmokePreparation =
  | { ok: true; confirmationToken: string; sourceCharacterCount: number }
  | { ok: false; error: BaiduManualSmokeError };

export type BaiduManualSmokeRunResult =
  | { ok: true; provider: "baidu"; submittedCharacters: number }
  | { ok: false; error: BaiduManualSmokeError };

export function isBaiduAccountReview(value: unknown): value is BaiduAccountReview {
  if (typeof value !== "object" || value === null) return false;
  const review = value as Partial<BaiduAccountReview>;
  return (
    (review.plan === "standard" || review.plan === "advanced") &&
    review.quotaAndPricingConfirmed === true &&
    review.qpsConfirmed === true &&
    review.languageDirectionsConfirmed === true &&
    review.singleRequestLengthConfirmed === true &&
    review.dataTermsConfirmed === true
  );
}
