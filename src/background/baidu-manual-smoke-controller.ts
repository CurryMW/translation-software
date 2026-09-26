import {
  isBaiduAccountReview,
  type BaiduAccountReview,
  type BaiduManualSmokePreparation,
  type BaiduManualSmokeRunResult,
} from "../shared/baidu-manual-smoke";
import { BAIDU_MANUAL_SMOKE_MESSAGE_TYPES, isBaiduManualSmokeMessage } from "../shared/messages";
import { countSourceCharacters, type TranslationUsageSnapshot } from "../shared/translation-usage";
import { TranslationAdapterError, type TranslationAdapterOutput, type TranslationInput } from "../shared/translation";
import { createBaiduSubmissionGate, type BaiduSubmissionGate } from "./baidu-submission-gate";

const READINESS_KEY = "baiduManualSmokeReadiness";
const CONFIRMATION_LIFETIME_MS = 60_000;
const MAX_PENDING_CONFIRMATIONS = 10;
const MANUAL_SMOKE_SOURCE = "Baidu safety smoke.";
const MANUAL_SMOKE_SOURCE_CHARACTER_COUNT = countSourceCharacters(MANUAL_SMOKE_SOURCE);

interface Sender { url?: string }

interface Credentials {
  appId: string;
  secret: string;
  revision: string;
}

interface Usage {
  snapshot(): Promise<TranslationUsageSnapshot>;
  reserveForPlanBeforeSubmit(characterCount: number, reviewedPlan: BaiduAccountReview["plan"]): Promise<{ ok: true; snapshot: { periodKey: string } } | { ok: false; error: "BUDGET_EXHAUSTED" | "STORAGE_FAILURE" | "ACCOUNT_REVIEW_REQUIRED" }>;
  releaseReservedCharacters(characterCount: number, periodKey: string): Promise<void>;
}

interface Storage {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

interface Adapter {
  translateWithCredentials(input: TranslationInput, credentials: Credentials): Promise<TranslationAdapterOutput>;
}

interface ReadyConfirmation {
  state: "ready" | "used";
  expiresAt: number;
  credentialRevision: string;
  review: BaiduAccountReview;
}

interface StoredReadiness {
  credentialRevision: string;
  review: BaiduAccountReview;
}

function trustedOptionsPage(sender: Sender, extensionId: string): boolean {
  return sender.url === `chrome-extension://${extensionId}/options.html`;
}

function storedReadiness(value: unknown): value is StoredReadiness {
  if (typeof value !== "object" || value === null) return false;
  const readiness = value as Partial<StoredReadiness>;
  return typeof readiness.credentialRevision === "string" && readiness.credentialRevision.length > 0 && isBaiduAccountReview(readiness.review);
}

export interface BaiduManualSmokeController {
  handle(message: unknown, sender: Sender, extensionId: string): Promise<BaiduManualSmokePreparation | BaiduManualSmokeRunResult>;
  /** Synchronously invalidates a pending manual request before a safety mutation. */
  abortInFlight(): void;
  hasCurrentReadiness(): Promise<boolean>;
  invalidate(): Promise<void>;
}

/**
 * The only direct entrypoint to the real service. It is deliberately
 * independent from page translation: a short-lived, one-shot confirmation is
 * required and the source text, translation response, request fields and
 * credentials never leave this service-worker-only boundary.
 */
export function createBaiduManualSmokeController({
  adapter,
  credentials,
  usage,
  hasProviderPermission,
  storage,
  now = () => Date.now(),
  submissionGate = createBaiduSubmissionGate({ now }),
  createToken = () => crypto.randomUUID(),
}: {
  adapter: Adapter;
  credentials: () => Promise<Credentials | undefined>;
  usage: Usage;
  hasProviderPermission: () => Promise<boolean>;
  storage: Storage;
  now?: () => number;
  submissionGate?: BaiduSubmissionGate;
  createToken?: () => string;
}): BaiduManualSmokeController {
  const confirmations = new Map<string, ReadyConfirmation>();
  let invalidationEpoch = 0;

  function cleanupConfirmations() {
    const currentTime = now();
    for (const [token, confirmation] of confirmations) {
      if (confirmation.expiresAt <= currentTime) confirmations.delete(token);
    }
    // Preserve the newest ready confirmations first. A discarded token is
    // indistinguishable from an expired one and can never submit a request.
    while (confirmations.size >= MAX_PENDING_CONFIRMATIONS) {
      const ready = Array.from(confirmations).find(([, confirmation]) => confirmation.state === "ready");
      const oldest = ready ?? confirmations.entries().next().value;
      if (!oldest) break;
      confirmations.delete(oldest[0]);
    }
  }

  async function current(review: BaiduAccountReview): Promise<"NOT_CONFIGURED" | "ACCOUNT_REVIEW_REQUIRED" | "PERMISSION_REQUIRED" | "CREDENTIAL_STORAGE_FAILURE" | "USAGE_STORAGE_FAILURE" | Credentials> {
    let currentCredentials: Credentials | undefined;
    try {
      currentCredentials = await credentials();
    } catch {
      return "CREDENTIAL_STORAGE_FAILURE";
    }
    let snapshot: TranslationUsageSnapshot;
    try {
      snapshot = await usage.snapshot();
    } catch {
      return "USAGE_STORAGE_FAILURE";
    }
    let permitted: boolean;
    try {
      permitted = await hasProviderPermission();
    } catch {
      // A permissions API failure is fail-closed, but it is not a storage
      // failure. Keep the options page actionable: the user can re-grant the
      // provider origin without mistaking this for lost local credentials.
      return "PERMISSION_REQUIRED";
    }
    if (!currentCredentials) return "NOT_CONFIGURED";
    if (snapshot.settings.plan !== review.plan) return "ACCOUNT_REVIEW_REQUIRED";
    if (!permitted) return "PERMISSION_REQUIRED";
    return currentCredentials;
  }

  async function prepare(review: unknown): Promise<BaiduManualSmokePreparation> {
    if (!isBaiduAccountReview(review)) return { ok: false, error: "ACCOUNT_REVIEW_REQUIRED" };
    try {
      const configuration = await current(review);
      if (typeof configuration === "string") return { ok: false, error: configuration };
      cleanupConfirmations();
      let confirmationToken: string;
      try {
        confirmationToken = createToken();
      } catch {
        return { ok: false, error: "TOKEN_GENERATION_FAILURE" };
      }
      confirmations.set(confirmationToken, {
        state: "ready",
        expiresAt: now() + CONFIRMATION_LIFETIME_MS,
        credentialRevision: configuration.revision,
        review,
      });
      return { ok: true, confirmationToken, sourceCharacterCount: MANUAL_SMOKE_SOURCE_CHARACTER_COUNT };
    } catch {
      return { ok: false, error: "PREPARE_INTERNAL_FAILURE" };
    }
  }

  async function run(token: unknown): Promise<BaiduManualSmokeRunResult> {
    if (typeof token !== "string" || !token) return { ok: false, error: "CONFIRMATION_EXPIRED" };
    const confirmation = confirmations.get(token);
    if (!confirmation || confirmation.expiresAt <= now()) {
      confirmations.delete(token);
      return { ok: false, error: "CONFIRMATION_EXPIRED" };
    }
    if (confirmation.state === "used") return { ok: false, error: "CONFIRMATION_USED" };
    confirmation.state = "used";
    const runEpoch = invalidationEpoch;
    try {
      const configuration = await current(confirmation.review);
      if (typeof configuration === "string") return { ok: false, error: configuration === "NOT_CONFIGURED" ? "CONFIRMATION_EXPIRED" : configuration };
      if (configuration.revision !== confirmation.credentialRevision) return { ok: false, error: "CONFIRMATION_EXPIRED" };
      const reservation = await usage.reserveForPlanBeforeSubmit(MANUAL_SMOKE_SOURCE_CHARACTER_COUNT, confirmation.review.plan);
      if (!reservation.ok) {
        return {
          ok: false,
          error: reservation.error === "STORAGE_FAILURE" ? "USAGE_RESERVATION_FAILURE" : reservation.error,
        };
      }
      // A save/clear or plan mutation can arrive after reservation. Re-check
      // before transport and release the local reservation if it invalidated
      // the reviewed snapshot; never submit with a superseded credential.
      const beforeSubmit = await current(confirmation.review);
      if (typeof beforeSubmit === "string" || beforeSubmit.revision !== confirmation.credentialRevision) {
        await usage.releaseReservedCharacters(MANUAL_SMOKE_SOURCE_CHARACTER_COUNT, reservation.snapshot.periodKey);
        return { ok: false, error: typeof beforeSubmit === "string" && beforeSubmit !== "NOT_CONFIGURED" ? beforeSubmit : "CONFIRMATION_EXPIRED" };
      }
      if (runEpoch !== invalidationEpoch) {
        await usage.releaseReservedCharacters(MANUAL_SMOKE_SOURCE_CHARACTER_COUNT, reservation.snapshot.periodKey);
        return { ok: false, error: "CONFIRMATION_EXPIRED" };
      }
      // This worker-lifetime gate is shared with normal Baidu page work. It
      // records a start even if a subsequent abort happens, so no runtime
      // switch can turn one account's QPS limit into a completion-based race.
      await submissionGate.waitForTurn(confirmation.review.plan);
      if (
        runEpoch !== invalidationEpoch ||
        confirmation.expiresAt <= now()
      ) {
        await usage.releaseReservedCharacters(MANUAL_SMOKE_SOURCE_CHARACTER_COUNT, reservation.snapshot.periodKey);
        return { ok: false, error: "CONFIRMATION_EXPIRED" };
      }
      // No asynchronous storage or permission read is allowed after the gate:
      // its timestamp is the provider's submission start. Trusted mutations
      // synchronously advance invalidationEpoch before they touch storage.
      await adapter.translateWithCredentials({ text: MANUAL_SMOKE_SOURCE, sourceLanguage: "auto", targetLanguage: "zh" }, beforeSubmit);
      if (runEpoch !== invalidationEpoch) return { ok: false, error: "CONFIRMATION_EXPIRED" };
      try {
        await storage.set({ [READINESS_KEY]: { credentialRevision: beforeSubmit.revision, review: confirmation.review } satisfies StoredReadiness });
      } catch {
        // Transport has already completed successfully. Do not claim that no
        // request was sent, and do not release usage that the provider saw.
        return { ok: false, error: "READINESS_STORAGE_FAILURE" };
      }
      if (runEpoch !== invalidationEpoch) {
        await storage.remove(READINESS_KEY).catch(() => undefined);
        return { ok: false, error: "CONFIRMATION_EXPIRED" };
      }
      return { ok: true, provider: "baidu", submittedCharacters: MANUAL_SMOKE_SOURCE_CHARACTER_COUNT };
    } catch (error) {
      if (error instanceof TranslationAdapterError) return { ok: false, error: error.failure.error };
      return { ok: false, error: "RUN_INTERNAL_FAILURE" };
    }
  }

  return {
    async handle(message, sender, extensionId) {
      if (!trustedOptionsPage(sender, extensionId)) return { ok: false, error: "UNTRUSTED_SENDER" };
      if (typeof message === "object" && message !== null && "type" in message && message.type === BAIDU_MANUAL_SMOKE_MESSAGE_TYPES.prepare && "payload" in message) return prepare(message.payload);
      if (!isBaiduManualSmokeMessage(message)) return { ok: false, error: "UNTRUSTED_SENDER" };
      if (message.type === BAIDU_MANUAL_SMOKE_MESSAGE_TYPES.run) return run(message.payload.confirmationToken);
      return { ok: false, error: "UNTRUSTED_SENDER" };
    },
    abortInFlight() {
      invalidationEpoch += 1;
      confirmations.clear();
    },
    async hasCurrentReadiness() {
      try {
        const stored = await storage.get(READINESS_KEY);
        const readiness = stored[READINESS_KEY];
        if (!storedReadiness(readiness)) return false;
        const configuration = await current(readiness.review);
        return typeof configuration !== "string" && configuration.revision === readiness.credentialRevision;
      } catch {
        return false;
      }
    },
    async invalidate() {
      invalidationEpoch += 1;
      confirmations.clear();
      await storage.remove(READINESS_KEY).catch(() => undefined);
    },
  };
}
