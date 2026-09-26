import type { BaiduLanguageCode, TranslationSourceLanguage } from "./languages";

export type TranslationAdapterId = "fake" | "baidu";

/**
 * Stable implementation revision used to scope ephemeral translation reuse.
 * Changing request/response semantics must change this value so an existing
 * page cannot reuse a result produced by an incompatible adapter revision.
 */
export type TranslationAdapterVersion = string;

export const TRANSLATION_PROVIDER_ERROR_CODES = {
  network: "NETWORK_ERROR",
  timeout: "TIMEOUT",
  rateLimited: "RATE_LIMITED",
  authentication: "AUTHENTICATION_FAILED",
  quotaExhausted: "PROVIDER_QUOTA_EXHAUSTED",
  unsupportedLanguage: "UNSUPPORTED_LANGUAGE",
  invalidRequest: "INVALID_REQUEST",
  contentRisk: "CONTENT_RISK",
  serviceUnavailable: "SERVICE_UNAVAILABLE",
} as const;

export type TranslationProviderErrorCode =
  (typeof TRANSLATION_PROVIDER_ERROR_CODES)[keyof typeof TRANSLATION_PROVIDER_ERROR_CODES];

export interface TranslationAdapterFailure {
  /** A content-free category safe to expose across the extension boundary. */
  error: TranslationProviderErrorCode;
  /** Provider-native code only; never include its message, request, or response. */
  providerCode?: string;
  /** Optional provider guidance used by the scheduler's controlled rate wait. */
  retryAfterMs?: number;
}

/** Typed service-worker-only failure raised by translation adapters. */
export class TranslationAdapterError extends Error {
  readonly failure: TranslationAdapterFailure;

  constructor(failure: TranslationAdapterFailure) {
    super(`Translation adapter failure: ${failure.error}`);
    this.name = "TranslationAdapterError";
    this.failure = failure;
  }
}

export interface TranslationInput {
  text: string;
  sourceLanguage: TranslationSourceLanguage;
  targetLanguage: BaiduLanguageCode;
}

/** Raw adapter response before the trusted service-worker boundary stamps it. */
export interface TranslationAdapterOutput {
  translatedText: string;
  sourceLanguage: TranslationSourceLanguage;
  targetLanguage: BaiduLanguageCode;
  adapter: TranslationAdapterId;
}

/** Versioned success payload safe to compare before writing into a page. */
export interface TranslationOutput extends TranslationAdapterOutput {
  adapterVersion: TranslationAdapterVersion;
}

export interface TranslationTask extends TranslationInput {
  requestId: string;
  blockId: string;
}

export type TranslationResult =
  | {
      ok: true;
      requestId: string;
      blockId: string;
      output: TranslationOutput;
    }
  | {
      ok: false;
      requestId: string;
      blockId: string;
      error:
        | "TRANSLATION_FAILED"
        | "CANCELED"
        | "SESSION_UNAVAILABLE"
        | "BUDGET_EXHAUSTED"
        | "TEXT_TOO_LONG"
        | TranslationProviderErrorCode;
    };

export interface TranslationServiceAdapter {
  readonly id: TranslationAdapterId;
  readonly version: TranslationAdapterVersion;
  translate(input: TranslationInput): Promise<TranslationAdapterOutput>;
  /** Optional request-scoped cancellation seam for safety invalidation. */
  abortRequest?(requestId: string): void;
}
