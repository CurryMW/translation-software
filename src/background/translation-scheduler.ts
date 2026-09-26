import { BAIDU_PLAN_LIMITS, countSourceCharacters, type TranslationUsageSnapshot } from "../shared/translation-usage";
import { TranslationAdapterError, type TranslationAdapterFailure, type TranslationAdapterOutput, type TranslationOutput, type TranslationTask, type TranslationResult, type TranslationServiceAdapter } from "../shared/translation";
import type { TranslationPreflightResult, TranslationTaskIdentity } from "../shared/messages";
import type { BaiduSubmissionGate } from "./baidu-submission-gate";

interface UsageGate {
  snapshot(): Promise<TranslationUsageSnapshot>;
  reserveBeforeSubmit(characterCount: number): Promise<{ ok: true; snapshot: Pick<TranslationUsageSnapshot, "periodKey"> } | { ok: false; error: "BUDGET_EXHAUSTED" | "STORAGE_FAILURE" }>;
  releaseReservedCharacters(characterCount: number, periodKey: string): Promise<void>;
}

export interface TranslationScheduler {
  enqueue(task: TranslationTask, checks?: { scope?: string; validate?: () => Promise<boolean>; preflight?: (identity: TranslationTaskIdentity) => Promise<TranslationPreflightResult> }): Promise<TranslationResult>;
  cancel(identity: TranslationTaskIdentity, scope?: string): void;
  clearScope(scope: string): void;
}

type Checks = NonNullable<Parameters<TranslationScheduler["enqueue"]>[1]>;
type TranslationFailureError = Extract<TranslationResult, { ok: false }>["error"];

const MAX_AUTOMATIC_RETRIES = 2;
const RETRY_DELAY_MS = 250;

interface ParentJob {
  key: string;
  task: TranslationTask;
  checks: Checks;
  canceled: boolean;
  settled: boolean;
  remaining: number;
  results: Array<{ path: readonly number[]; prefix: string; translatedText: string }>;
  resolve(result: TranslationResult): void;
}

interface FragmentJob {
  parent: ParentJob;
  path: readonly number[];
  prefix: string;
  text: string;
  submit?: () => Promise<TranslationAdapterOutput>;
}

type StartResult =
  | { kind: "submit" }
  | { kind: "resplit"; fragments: readonly { prefix: string; text: string }[] }
  | { kind: "failure"; error: TranslationFailureError };

interface SubmissionPreparableAdapter extends TranslationServiceAdapter {
  prepareSubmission(input: TranslationTask): Promise<() => Promise<TranslationAdapterOutput>>;
}

function supportsPreparedSubmission(adapter: TranslationServiceAdapter): adapter is SubmissionPreparableAdapter {
  return "prepareSubmission" in adapter && typeof adapter.prepareSubmission === "function";
}

function failure(task: TranslationTask, error: TranslationFailureError): TranslationResult {
  return { ok: false, requestId: task.requestId, blockId: task.blockId, error };
}

function jobKey(identity: TranslationTaskIdentity, scope = "unknown"): string {
  return `${scope}\u0000${identity.requestId}\u0000${identity.blockId}`;
}

function comparePath(left: readonly number[], right: readonly number[]): number {
  const commonLength = Math.min(left.length, right.length);
  for (let index = 0; index < commonLength; index += 1) if (left[index] !== right[index]) return left[index]! - right[index]!;
  return left.length - right.length;
}

/** Splits only at paragraph and sentence boundaries; a too-long sentence is unsafe to submit. */
function splitAtSafeBoundaries(text: string, maximumCharacters: number): readonly { prefix: string; text: string }[] | undefined {
  const paragraphs = text.replace(/\r\n?/gu, "\n").split(/\n\s*\n+/gu).map((paragraph) => paragraph.replace(/\s+/gu, " ").trim()).filter(Boolean);
  if (!paragraphs.length) return undefined;
  const fragments: Array<{ prefix: string; text: string }> = [];
  for (const paragraph of paragraphs) {
    const paragraphPrefix = fragments.length ? "\n\n" : "";
    if (countSourceCharacters(paragraph) <= maximumCharacters) {
      fragments.push({ prefix: paragraphPrefix, text: paragraph });
      continue;
    }
    const sentences = paragraph.match(/[^.!?…。！？]+[.!?…。！？]+\s*|[^.!?…。！？]+$/gu)?.filter(Boolean);
    if (!sentences?.length) return undefined;
    let combined = "";
    let prefix = paragraphPrefix;
    for (const sentence of sentences) {
      if (countSourceCharacters(sentence) > maximumCharacters) return undefined;
      const next = `${combined}${sentence}`;
      if (countSourceCharacters(next) <= maximumCharacters) {
        combined = next;
        continue;
      }
      fragments.push({ prefix, text: combined });
      prefix = "";
      combined = sentence;
    }
    if (!combined) return undefined;
    fragments.push({ prefix, text: combined });
  }
  return fragments;
}

export function createTranslationScheduler({ adapter, usage, diagnostics, submissionGate, now = () => Date.now(), wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)) }: { adapter: TranslationServiceAdapter; usage: UsageGate; diagnostics?: { record(failure: TranslationAdapterFailure): Promise<void> }; submissionGate?: BaiduSubmissionGate; now?: () => number; wait?: (milliseconds: number) => Promise<void> }): TranslationScheduler {
  const pending: FragmentJob[] = [];
  const parents = new Map<string, ParentJob>();
  let running = 0;
  let pumping = false;
  let lastSubmissionStartedAt = Number.NEGATIVE_INFINITY;
  let startGate = Promise.resolve();
  let rateRecovery: Promise<void> | undefined;
  const pausedScopes = new Map<string, TranslationFailureError>();

  function adapterFailure(error: unknown): TranslationAdapterFailure | undefined {
    return error instanceof TranslationAdapterError ? error.failure : undefined;
  }

  function retryable(failure: TranslationAdapterFailure): boolean {
    return failure.error === "NETWORK_ERROR" || failure.error === "TIMEOUT" || failure.error === "SERVICE_UNAVAILABLE" || failure.error === "RATE_LIMITED";
  }

  async function waitForRateRecovery(milliseconds: number): Promise<void> {
    if (!rateRecovery) {
      rateRecovery = wait(milliseconds).finally(() => { rateRecovery = undefined; });
    }
    await rateRecovery;
  }

  function settle(parent: ParentJob, result: TranslationResult): void {
    if (parent.settled) return;
    parent.settled = true;
    if (parents.get(parent.key) === parent) parents.delete(parent.key);
    parent.resolve(result);
  }

  function discardPending(parent: ParentJob): void {
    for (let index = pending.length - 1; index >= 0; index -= 1) if (pending[index]!.parent === parent) pending.splice(index, 1);
  }

  function fail(parent: ParentJob, error: TranslationFailureError): void {
    parent.canceled = true;
    discardPending(parent);
    settle(parent, failure(parent.task, error));
  }

  function pauseScope(scope: string | undefined, error: TranslationFailureError): void {
    if (!scope) return;
    pausedScopes.set(scope, error);
    for (const parent of [...parents.values()]) {
      if (parent.checks.scope !== scope) continue;
      parent.canceled = true;
      discardPending(parent);
      settle(parent, failure(parent.task, error));
    }
  }

  function isProviderScopeFailure(error: TranslationFailureError): boolean {
    return error === "AUTHENTICATION_FAILED" || error === "PROVIDER_QUOTA_EXHAUSTED" || error === "SERVICE_UNAVAILABLE";
  }

  function serialStart<T>(operation: () => Promise<T>): Promise<T> {
    const result = startGate.then(operation, operation);
    startGate = result.then(() => undefined, () => undefined);
    return result;
  }

  async function prepare(fragment: FragmentJob): Promise<StartResult> {
    return serialStart(async () => {
      const { parent } = fragment;
      while (true) {
        if (parent.canceled) return { kind: "failure", error: "CANCELED" };
        let snapshot: TranslationUsageSnapshot;
        try { snapshot = await usage.snapshot(); } catch { return { kind: "failure", error: "TRANSLATION_FAILED" }; }
        const limits = BAIDU_PLAN_LIMITS[snapshot.settings.plan];
        const characterCount = countSourceCharacters(fragment.text);
        if (characterCount > limits.safeRequestCharacters) {
          const fragments = splitAtSafeBoundaries(fragment.text, limits.safeRequestCharacters);
          return fragments ? { kind: "resplit", fragments } : { kind: "failure", error: "TEXT_TOO_LONG" };
        }
        const earliestStart = lastSubmissionStartedAt + 1_000 / limits.qps;
        if (now() < earliestStart) {
          await wait(earliestStart - now());
          continue;
        }
        const reservation = await usage.reserveBeforeSubmit(characterCount);
        if (!reservation.ok) return { kind: "failure", error: reservation.error === "BUDGET_EXHAUSTED" ? "BUDGET_EXHAUSTED" : "TRANSLATION_FAILED" };
        const release = () => usage.releaseReservedCharacters(characterCount, reservation.snapshot.periodKey);
        if (parent.canceled) { await release(); return { kind: "failure", error: "CANCELED" }; }
        if (parent.checks.validate && !await parent.checks.validate()) { await release(); return { kind: "failure", error: "SESSION_UNAVAILABLE" }; }
        if (parent.checks.preflight) {
          const result = await parent.checks.preflight({ requestId: parent.task.requestId, blockId: parent.task.blockId });
          if (!result.ok) { await release(); return { kind: "failure", error: "CANCELED" }; }
        }
        if (parent.canceled) { await release(); return { kind: "failure", error: "CANCELED" }; }
        try {
          const latest = await usage.snapshot();
          const latestLimits = BAIDU_PLAN_LIMITS[latest.settings.plan];
          if (characterCount > latestLimits.safeRequestCharacters) {
            await release();
            const fragments = splitAtSafeBoundaries(fragment.text, latestLimits.safeRequestCharacters);
            return fragments ? { kind: "resplit", fragments } : { kind: "failure", error: "TEXT_TOO_LONG" };
          }
          if (now() < lastSubmissionStartedAt + 1_000 / latestLimits.qps) { await release(); continue; }
          fragment.submit = undefined;
          if (supportsPreparedSubmission(adapter)) {
            try {
              fragment.submit = await adapter.prepareSubmission({ text: fragment.text, sourceLanguage: parent.task.sourceLanguage, targetLanguage: parent.task.targetLanguage, requestId: parent.task.requestId, blockId: parent.task.blockId });
            } catch (error) {
              await release();
              return { kind: "failure", error: adapterFailure(error)?.error ?? "TRANSLATION_FAILED" };
            }
            if (parent.canceled) { await release(); return { kind: "failure", error: "CANCELED" }; }
          }
          if (submissionGate) {
            try {
              await submissionGate.waitForTurn(latest.settings.plan);
            } catch {
              await release();
              return { kind: "failure", error: "TRANSLATION_FAILED" };
            }
            if (parent.canceled) { await release(); return { kind: "failure", error: "CANCELED" }; }
          }
        } catch {
          await release();
          return { kind: "failure", error: "TRANSLATION_FAILED" };
        }
        lastSubmissionStartedAt = now();
        return { kind: "submit" };
      }
    });
  }

  function combinedOutput(parent: ParentJob): TranslationOutput {
    return { translatedText: [...parent.results].sort((left, right) => comparePath(left.path, right.path)).map((result) => `${result.prefix}${result.translatedText}`).join(""), sourceLanguage: parent.task.sourceLanguage, targetLanguage: parent.task.targetLanguage, adapter: adapter.id, adapterVersion: adapter.version };
  }

  async function execute(fragment: FragmentJob): Promise<void> {
    const { parent } = fragment;
    try {
      for (let retryCount = 0; ; retryCount += 1) {
        if (rateRecovery) await rateRecovery;
        const preparation = await prepare(fragment);
        if (preparation.kind === "resplit") {
          if (parent.canceled || parent.settled) return;
          parent.remaining += preparation.fragments.length - 1;
          pending.unshift(...preparation.fragments.map((next, index) => ({ parent, path: [...fragment.path, index], prefix: index === 0 ? `${fragment.prefix}${next.prefix}` : next.prefix, text: next.text })));
          return;
        }
        if (preparation.kind === "failure") {
          if (isProviderScopeFailure(preparation.error)) pauseScope(parent.checks.scope, preparation.error);
          if (!parent.settled) fail(parent, preparation.error);
          return;
        }
        try {
          const output = fragment.submit
            ? await fragment.submit()
            : await adapter.translate({ text: fragment.text, sourceLanguage: parent.task.sourceLanguage, targetLanguage: parent.task.targetLanguage });
          if (parent.canceled || parent.settled) return;
          parent.results.push({ path: fragment.path, prefix: fragment.prefix, translatedText: output.translatedText });
          parent.remaining -= 1;
          if (parent.remaining === 0) settle(parent, { ok: true, requestId: parent.task.requestId, blockId: parent.task.blockId, output: combinedOutput(parent) });
          return;
        } catch (error) {
          // Runtime invalidation clears the scope before aborting its concrete
          // adapter. The rejection from that aborted transport is therefore a
          // terminal cancellation, never a retryable network failure.
          if (parent.canceled || parent.settled) return;
          const failure = adapterFailure(error);
          if (failure) void diagnostics?.record(failure).catch(() => undefined);
          if (!failure || !retryable(failure) || retryCount >= MAX_AUTOMATIC_RETRIES) {
            if (failure && isProviderScopeFailure(failure.error)) pauseScope(parent.checks.scope, failure.error);
            if (!parent.settled) fail(parent, failure?.error ?? "TRANSLATION_FAILED");
            return;
          }
          const delay = Math.max(failure.retryAfterMs ?? 0, RETRY_DELAY_MS * (2 ** retryCount));
          if (failure.error === "RATE_LIMITED") await waitForRateRecovery(delay);
          else await wait(delay);
        }
      }
    } finally {
      running -= 1;
      void pump();
    }
  }

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (pending.length) {
        let snapshot: TranslationUsageSnapshot;
        try { snapshot = await usage.snapshot(); } catch {
          const unavailable = pending.shift();
          if (unavailable) fail(unavailable.parent, "TRANSLATION_FAILED");
          continue;
        }
        if (running >= BAIDU_PLAN_LIMITS[snapshot.settings.plan].maxConcurrency) return;
        const fragment = pending.shift();
        if (!fragment || fragment.parent.canceled || fragment.parent.settled) continue;
        running += 1;
        void execute(fragment);
      }
    } finally { pumping = false; }
  }

  return {
    enqueue(task, checks = {}) {
      return new Promise<TranslationResult>((resolve) => {
        void (async () => {
          const key = jobKey(task, checks.scope);
          if (parents.has(key)) return resolve(failure(task, "CANCELED"));
          const paused = checks.scope ? pausedScopes.get(checks.scope) : undefined;
          if (paused) return resolve(failure(task, paused));
          const parent: ParentJob = { key, task, checks, canceled: false, settled: false, remaining: 0, results: [], resolve };
          parents.set(parent.key, parent);
          try {
            if (checks.validate && !await checks.validate()) return fail(parent, "SESSION_UNAVAILABLE");
            if (checks.preflight) {
              const preflight = await checks.preflight({ requestId: task.requestId, blockId: task.blockId });
              if (!preflight.ok) return fail(parent, "CANCELED");
            }
            if (parent.canceled || parent.settled) return;
            const snapshot = await usage.snapshot();
            const fragments = splitAtSafeBoundaries(task.text, BAIDU_PLAN_LIMITS[snapshot.settings.plan].safeRequestCharacters);
            if (!fragments) return fail(parent, "TEXT_TOO_LONG");
            if (checks.validate && !await checks.validate()) return fail(parent, "SESSION_UNAVAILABLE");
            if (checks.preflight) {
              const preflight = await checks.preflight({ requestId: task.requestId, blockId: task.blockId });
              if (!preflight.ok) return fail(parent, "CANCELED");
            }
            if (parent.canceled || parent.settled) return;
            parent.remaining = fragments.length;
            pending.push(...fragments.map((fragment, index) => ({ parent, path: [index], ...fragment })));
            void pump();
          } catch { fail(parent, "TRANSLATION_FAILED"); }
        })();
      });
    },
    cancel(identity, scope) {
      const parent = parents.get(jobKey(identity, scope));
      if (!parent) return;
      parent.canceled = true;
      discardPending(parent);
      settle(parent, failure(parent.task, "CANCELED"));
    },
    clearScope(scope) {
      pausedScopes.delete(scope);
      for (const parent of [...parents.values()]) {
        if (parent.checks.scope !== scope) continue;
        parent.canceled = true;
        discardPending(parent);
        adapter.abortRequest?.(parent.task.requestId);
        settle(parent, failure(parent.task, "CANCELED"));
      }
    },
  };
}
