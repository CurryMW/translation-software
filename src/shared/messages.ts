import type {
  BaiduCredentialsInput,
  CredentialMutationResult,
  CredentialStatus,
} from "./credential-types";
import type {
  BaiduAccountReview,
  BaiduManualSmokePreparation,
  BaiduManualSmokeRunResult,
} from "./baidu-manual-smoke";
import { isBaiduAccountReview } from "./baidu-manual-smoke";
import type {
  SiteSettingsResult,
} from "./site-settings";
import { isBaiduLanguageCode, isTranslationSourceLanguage, type BaiduLanguageCode } from "./languages";
import type { TranslationAdapterId, TranslationAdapterVersion, TranslationResult, TranslationTask } from "./translation";
import { isTranslationUsageSettings, type TranslationUsageResult, type TranslationUsageSettings } from "./translation-usage";
import { isTranslationAppearanceSettings, type TranslationAppearanceSettings, type TranslationTextColorId } from "./translation-appearance";

export const CREDENTIAL_MESSAGE_TYPES = {
  clear: "credentials.clear",
  save: "credentials.save",
  status: "credentials.status",
} as const;

export type CredentialMessage =
  | { type: typeof CREDENTIAL_MESSAGE_TYPES.status }
  | {
    type: typeof CREDENTIAL_MESSAGE_TYPES.save;
    payload: BaiduCredentialsInput;
  }
  | { type: typeof CREDENTIAL_MESSAGE_TYPES.clear };

export type CredentialMessageResponse<T extends CredentialMessage> =
  T["type"] extends typeof CREDENTIAL_MESSAGE_TYPES.status
  ? CredentialStatus
  : CredentialMutationResult;

export const BAIDU_MANUAL_SMOKE_MESSAGE_TYPES = {
  prepare: "baidu.manual-smoke.prepare",
  run: "baidu.manual-smoke.run",
} as const;

export type BaiduManualSmokeMessage =
  | { type: typeof BAIDU_MANUAL_SMOKE_MESSAGE_TYPES.prepare; payload: BaiduAccountReview }
  | { type: typeof BAIDU_MANUAL_SMOKE_MESSAGE_TYPES.run; payload: { confirmationToken: string } };

export type BaiduManualSmokeMessageResponse<T extends BaiduManualSmokeMessage> =
  T["type"] extends typeof BAIDU_MANUAL_SMOKE_MESSAGE_TYPES.prepare
    ? BaiduManualSmokePreparation
    : BaiduManualSmokeRunResult;

export const SITE_MESSAGE_TYPES = {
  compatibilityFailure: "page-session.compatibility-failure",
  foreground: "page-session.foreground",
  get: "site-settings.get",
  getPageSessionSettings: "page-session.settings.get",
  pause: "page-session.pause",
  routeChanged: "page-session.route-changed",
  sessionDecision: "page-session.decision",
  setEnabled: "site-settings.set-enabled",
  setTargetLanguage: "site-settings.set-target-language",
  stopSession: "page-session.stop",
  targetLanguageChanged: "page-session.target-language-changed",
} as const;

export interface PageSessionIdentity {
  id: string;
}

export type PageSessionDisposition = "awaiting-decision" | "allowed" | "rejected";

export interface PageSessionDescriptor {
  targetLanguage: BaiduLanguageCode;
  textColor?: TranslationTextColorId;
  provider: { adapter: TranslationAdapterId; version: TranslationAdapterVersion };
  session: PageSessionIdentity;
  disposition: PageSessionDisposition;
}

export type PageCompatibilityFailureReason = "layout-breakage" | "scroll-breakage" | "interaction-breakage" | "unsafe-page";

export type SiteSettingsMessage =
  | {
    type: typeof SITE_MESSAGE_TYPES.get;
    payload: { domain: string };
  }
  | {
    type: typeof SITE_MESSAGE_TYPES.setEnabled;
    payload: { domain: string; enabled: boolean };
  }
  | {
    type: typeof SITE_MESSAGE_TYPES.setTargetLanguage;
    payload: { domain: string; targetLanguage: BaiduLanguageCode };
  };

export type SiteSettingsMessageResponse<
  _T extends SiteSettingsMessage = SiteSettingsMessage,
> = SiteSettingsResult;

export type PageSessionMessage =
  | {
    type: typeof SITE_MESSAGE_TYPES.compatibilityFailure;
    payload: {
      session: PageSessionIdentity;
      reason: PageCompatibilityFailureReason;
    };
  }
  | {
    type: typeof SITE_MESSAGE_TYPES.foreground;
    payload: PageSessionDescriptor;
  }
  | {
    type: typeof SITE_MESSAGE_TYPES.pause;
    payload: {
      session: PageSessionIdentity;
      reason: "background";
    };
  }
  | {
    type: typeof SITE_MESSAGE_TYPES.stopSession;
    payload: {
      reason: "site-disabled";
      scope: { kind: "current-document" };
    };
  }
  | {
    type: typeof SITE_MESSAGE_TYPES.stopSession;
    payload: {
      reason: "site-disabled" | "permission-revoked";
      scope: { kind: "domains"; domains: string[] };
    };
  }
  | {
    type: typeof SITE_MESSAGE_TYPES.targetLanguageChanged;
    payload: {
      targetLanguage: BaiduLanguageCode;
      scope: { kind: "current-document" };
    };
  };

export type PageSessionSettingsMessage = {
  type: typeof SITE_MESSAGE_TYPES.getPageSessionSettings;
};

/** Content-to-worker invalidation signal. It deliberately carries no URL. */
export type PageSessionRouteChangedMessage = {
  type: typeof SITE_MESSAGE_TYPES.routeChanged;
  payload: { session: PageSessionIdentity };
};

export type PageSessionCompatibilityFailureMessage = {
  type: typeof SITE_MESSAGE_TYPES.compatibilityFailure;
  payload: { session: PageSessionIdentity; reason: PageCompatibilityFailureReason };
};

export type PageSessionDecisionMessage = {
  type: typeof SITE_MESSAGE_TYPES.sessionDecision;
  payload: {
    session: PageSessionIdentity;
    decision: "accept" | "reject";
  };
};

export type PageSessionDecisionResult =
  | { ok: true; disposition: "allowed" | "rejected" }
  | { ok: false; error: "UNAVAILABLE" | "STALE_SESSION" };

export type PageSessionSettingsResult =
  | ({ ok: true } & PageSessionDescriptor)
  | { ok: false; error: "UNAVAILABLE" };

export const TRANSLATION_MESSAGE_TYPES = {
  cancel: "translation.cancel",
  preflight: "translation.preflight",
  translate: "translation.translate",
} as const;

export type TranslationMessage = {
  type: typeof TRANSLATION_MESSAGE_TYPES.translate;
  session: PageSessionIdentity;
  payload: TranslationTask;
};

export type TranslationMessageResponse = TranslationResult;

export interface TranslationTaskIdentity {
  requestId: string;
  blockId: string;
}

export type TranslationCancellationMessage = {
  type: typeof TRANSLATION_MESSAGE_TYPES.cancel;
  session: PageSessionIdentity;
  payload: TranslationTaskIdentity;
};

export type TranslationPreflightMessage = {
  type: typeof TRANSLATION_MESSAGE_TYPES.preflight;
  session: PageSessionIdentity;
  payload: TranslationTaskIdentity;
};

export type TranslationPreflightResult =
  | { ok: true }
  | { ok: false; error: "SESSION_STOPPED" | "STALE_TASK" | "NOT_VISIBLE" };

export const USAGE_MESSAGE_TYPES = {
  get: "translation-usage.get",
  update: "translation-usage.update",
} as const;

export type TranslationUsageMessage =
  | { type: typeof USAGE_MESSAGE_TYPES.get }
  | { type: typeof USAGE_MESSAGE_TYPES.update; payload: TranslationUsageSettings };

export type TranslationUsageMessageResponse = TranslationUsageResult;

export const TRANSLATION_APPEARANCE_MESSAGE_TYPES = {
  get: "translation-appearance.get",
  update: "translation-appearance.update",
} as const;

export type TranslationAppearanceMessage =
  | { type: typeof TRANSLATION_APPEARANCE_MESSAGE_TYPES.get }
  | { type: typeof TRANSLATION_APPEARANCE_MESSAGE_TYPES.update; payload: TranslationAppearanceSettings };

export type TranslationAppearanceResult =
  | { ok: true; settings: TranslationAppearanceSettings }
  | { ok: false; error: "INVALID_SETTINGS" | "UNTRUSTED_SENDER" | "STORAGE_FAILURE" };

export type RuntimeMessage =
  | CredentialMessage
  | BaiduManualSmokeMessage
  | SiteSettingsMessage
  | PageSessionSettingsMessage
  | PageSessionDecisionMessage
  | PageSessionRouteChangedMessage
  | PageSessionCompatibilityFailureMessage
  | TranslationMessage
  | TranslationCancellationMessage
  | TranslationPreflightMessage
  | TranslationUsageMessage
  | TranslationAppearanceMessage;

function isTranslationTaskIdentity(value: unknown): value is TranslationTaskIdentity {
  if (typeof value !== "object" || value === null) return false;
  const identity = value as Partial<TranslationTaskIdentity>;
  return typeof identity.requestId === "string" && typeof identity.blockId === "string";
}

function isPageSessionIdentity(value: unknown): value is PageSessionIdentity {
  if (typeof value !== "object" || value === null) return false;
  const identity = value as Partial<PageSessionIdentity>;
  return typeof identity.id === "string" && identity.id.length > 0 && identity.id.length <= 128;
}

export function isTranslationCancellationMessage(value: unknown): value is TranslationCancellationMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "session" in value &&
    "payload" in value &&
    value.type === TRANSLATION_MESSAGE_TYPES.cancel &&
    isPageSessionIdentity(value.session) &&
    isTranslationTaskIdentity(value.payload)
  );
}

export function isTranslationPreflightMessage(value: unknown): value is TranslationPreflightMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "session" in value &&
    "payload" in value &&
    value.type === TRANSLATION_MESSAGE_TYPES.preflight &&
    isPageSessionIdentity(value.session) &&
    isTranslationTaskIdentity(value.payload)
  );
}

export function isTranslationUsageMessage(value: unknown): value is TranslationUsageMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  if (value.type === USAGE_MESSAGE_TYPES.get) return true;
  return value.type === USAGE_MESSAGE_TYPES.update && "payload" in value && isTranslationUsageSettings(value.payload);
}

export function isTranslationAppearanceMessage(value: unknown): value is TranslationAppearanceMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  if (value.type === TRANSLATION_APPEARANCE_MESSAGE_TYPES.get) return true;
  return value.type === TRANSLATION_APPEARANCE_MESSAGE_TYPES.update && "payload" in value && isTranslationAppearanceSettings(value.payload);
}

export function isPageSessionSettingsMessage(value: unknown): value is PageSessionSettingsMessage {
  return typeof value === "object" && value !== null && "type" in value && value.type === SITE_MESSAGE_TYPES.getPageSessionSettings;
}

export function isPageSessionRouteChangedMessage(value: unknown): value is PageSessionRouteChangedMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "payload" in value &&
    value.type === SITE_MESSAGE_TYPES.routeChanged &&
    typeof value.payload === "object" &&
    value.payload !== null &&
    "session" in value.payload &&
    isPageSessionIdentity(value.payload.session)
  );
}

export function isPageSessionCompatibilityFailureMessage(value: unknown): value is PageSessionCompatibilityFailureMessage {
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    !("payload" in value) ||
    value.type !== SITE_MESSAGE_TYPES.compatibilityFailure ||
    typeof value.payload !== "object" ||
    value.payload === null
  ) return false;
  const payload = value.payload as { session?: unknown; reason?: unknown };
  return isPageSessionIdentity(payload.session) && (
    payload.reason === "layout-breakage" ||
    payload.reason === "scroll-breakage" ||
    payload.reason === "interaction-breakage" ||
    payload.reason === "unsafe-page"
  );
}

export function isPageSessionDecisionMessage(value: unknown): value is PageSessionDecisionMessage {
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    !("payload" in value) ||
    value.type !== SITE_MESSAGE_TYPES.sessionDecision ||
    typeof value.payload !== "object" ||
    value.payload === null
  ) {
    return false;
  }

  const payload = value.payload as { session?: unknown; decision?: unknown };
  return (
    isPageSessionIdentity(payload.session) &&
    (payload.decision === "accept" || payload.decision === "reject")
  );
}

export function isTranslationMessage(value: unknown): value is TranslationMessage {
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    !("session" in value) ||
    !("payload" in value)
  ) {
    return false;
  }

  const message = value as { type?: unknown; session?: unknown; payload?: Partial<TranslationTask> };
  const payload = message.payload;
  return (
    message.type === TRANSLATION_MESSAGE_TYPES.translate &&
    isPageSessionIdentity(message.session) &&
    typeof payload === "object" &&
    payload !== null &&
    typeof payload.requestId === "string" &&
    typeof payload.blockId === "string" &&
    typeof payload.text === "string" &&
    isTranslationSourceLanguage(payload.sourceLanguage) &&
    isBaiduLanguageCode(payload.targetLanguage)
  );
}

export function isSiteSettingsMessage(value: unknown): value is SiteSettingsMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }

  const message = value as {
    type?: unknown;
    payload?: Partial<{ domain: unknown; enabled: unknown; targetLanguage: unknown }>;
  };
  if (
    message.type !== SITE_MESSAGE_TYPES.get &&
    message.type !== SITE_MESSAGE_TYPES.setEnabled &&
    message.type !== SITE_MESSAGE_TYPES.setTargetLanguage
  ) {
    return false;
  }

  if (
    typeof message.payload !== "object" ||
    message.payload === null ||
    typeof message.payload.domain !== "string"
  ) {
    return false;
  }

  if (message.type === SITE_MESSAGE_TYPES.get) return true;
  if (message.type === SITE_MESSAGE_TYPES.setEnabled) return typeof message.payload.enabled === "boolean";
  return isBaiduLanguageCode(message.payload.targetLanguage);
}

export function isCredentialMessage(value: unknown): value is CredentialMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }

  const message = value as { type?: unknown; payload?: unknown };
  if (
    message.type === CREDENTIAL_MESSAGE_TYPES.status ||
    message.type === CREDENTIAL_MESSAGE_TYPES.clear
  ) {
    return true;
  }

  if (message.type !== CREDENTIAL_MESSAGE_TYPES.save) {
    return false;
  }

  if (typeof message.payload !== "object" || message.payload === null) {
    return false;
  }

  const payload = message.payload as Partial<BaiduCredentialsInput>;
  return typeof payload.appId === "string" && typeof payload.secret === "string";
}

export function isBaiduManualSmokeMessage(value: unknown): value is BaiduManualSmokeMessage {
  if (typeof value !== "object" || value === null || !("type" in value) || !("payload" in value)) return false;
  if (value.type === BAIDU_MANUAL_SMOKE_MESSAGE_TYPES.prepare) return isBaiduAccountReview(value.payload);
  return value.type === BAIDU_MANUAL_SMOKE_MESSAGE_TYPES.run &&
    typeof value.payload === "object" && value.payload !== null &&
    "confirmationToken" in value.payload && typeof value.payload.confirmationToken === "string" &&
    value.payload.confirmationToken.length > 0 && value.payload.confirmationToken.length <= 256;
}
