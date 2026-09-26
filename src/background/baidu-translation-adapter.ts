import { isTranslationSourceLanguage } from "../shared/languages";
import {
  TranslationAdapterError,
  TRANSLATION_PROVIDER_ERROR_CODES,
  type TranslationAdapterFailure,
  type TranslationAdapterOutput,
  type TranslationInput,
  type TranslationServiceAdapter,
} from "../shared/translation";
import { baiduMd5Hex } from "./baidu-md5";
import { BAIDU_PROVIDER_ORIGIN_PATTERN } from "../shared/baidu-provider";

export const BAIDU_TRANSLATE_ENDPOINT = "https://fanyi-api.baidu.com/api/trans/vip/translate";
export { BAIDU_PROVIDER_ORIGIN_PATTERN };

export interface BaiduServiceWorkerCredentials {
  appId: string;
  secret: string;
}

export interface BaiduFormTransport {
  postForm(
    endpoint: string,
    fields: Readonly<Record<"q" | "from" | "to" | "appid" | "salt" | "sign", string>>,
    signal: AbortSignal,
  ): Promise<{ status: number; json(): Promise<unknown> }>;
}

export type PreparedBaiduSubmission = () => Promise<TranslationAdapterOutput>;

interface Timer {
  setTimeout(action: () => void, milliseconds: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

const PROVIDER_CODES: Readonly<Record<string, TranslationAdapterFailure["error"]>> = {
  "52003": TRANSLATION_PROVIDER_ERROR_CODES.authentication,
  "54001": TRANSLATION_PROVIDER_ERROR_CODES.authentication,
  "54003": TRANSLATION_PROVIDER_ERROR_CODES.rateLimited,
  "54004": TRANSLATION_PROVIDER_ERROR_CODES.quotaExhausted,
  "54000": TRANSLATION_PROVIDER_ERROR_CODES.invalidRequest,
  "54005": TRANSLATION_PROVIDER_ERROR_CODES.invalidRequest,
  "58000": TRANSLATION_PROVIDER_ERROR_CODES.authentication,
  "58001": TRANSLATION_PROVIDER_ERROR_CODES.unsupportedLanguage,
  "58002": TRANSLATION_PROVIDER_ERROR_CODES.serviceUnavailable,
  "90107": TRANSLATION_PROVIDER_ERROR_CODES.authentication,
};

function providerCode(value: unknown): string | undefined {
  if (typeof value === "string" && /^\d{1,8}$/u.test(value)) return value;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 99_999_999 ? String(value) : undefined;
}

function failureForProviderCode(code: string): TranslationAdapterFailure {
  return { error: PROVIDER_CODES[code] ?? TRANSLATION_PROVIDER_ERROR_CODES.serviceUnavailable, providerCode: code };
}

function failureForHttpStatus(status: number): TranslationAdapterFailure {
  if (status === 401 || status === 403) return { error: TRANSLATION_PROVIDER_ERROR_CODES.authentication };
  if (status === 429) return { error: TRANSLATION_PROVIDER_ERROR_CODES.rateLimited };
  if (status >= 500 && status <= 599) return { error: TRANSLATION_PROVIDER_ERROR_CODES.serviceUnavailable };
  return { error: TRANSLATION_PROVIDER_ERROR_CODES.invalidRequest };
}

function translatedTextFrom(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("trans_result" in value) || !Array.isArray(value.trans_result)) return undefined;
  const entries = value.trans_result;
  if (!entries.length || entries.some((entry) => typeof entry !== "object" || entry === null || !("dst" in entry) || typeof entry.dst !== "string")) return undefined;
  const text = entries.map((entry) => (entry as { dst: string }).dst).join("\n");
  return text.length > 0 ? text : undefined;
}

function detectedSourceLanguage(value: unknown, fallback: TranslationInput["sourceLanguage"]): TranslationInput["sourceLanguage"] {
  if (typeof value === "object" && value !== null && "from" in value && isTranslationSourceLanguage(value.from)) return value.from;
  return fallback;
}

/**
 * This adapter is constructed only by the service worker. Its transport is
 * injected so automated tests remain local and production can bind fetch at
 * the worker boundary without exposing credentials to page contexts.
 */
export class BaiduTranslationAdapter implements TranslationServiceAdapter {
  readonly id = "baidu" as const;
  readonly version = "baidu-v1";
  private readonly credentials: () => Promise<BaiduServiceWorkerCredentials | undefined>;
  private readonly postForm: BaiduFormTransport["postForm"];
  private readonly salt: () => string;
  private readonly timeoutMs: number;
  private readonly timer: Timer;
  private readonly activeControllers = new Set<AbortController>();
  private readonly activeControllersByRequest = new Map<string, Set<AbortController>>();

  constructor({
    credentials,
    postForm,
    salt = () => String(Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000),
    timeoutMs = 15_000,
    // Native worker timers require the global receiver. Copying them onto
    // this object makes method calls throw "Illegal invocation" in Chrome.
    timer = {
      setTimeout: (action, milliseconds) => globalThis.setTimeout(action, milliseconds),
      clearTimeout: (handle) => globalThis.clearTimeout(handle),
    },
  }: {
    credentials: () => Promise<BaiduServiceWorkerCredentials | undefined>;
    postForm: BaiduFormTransport["postForm"];
    salt?: () => string;
    timeoutMs?: number;
    timer?: Timer;
  }) {
    this.credentials = credentials;
    this.postForm = postForm;
    this.salt = salt;
    this.timeoutMs = timeoutMs;
    this.timer = timer;
  }

  async translate(input: TranslationInput & { requestId?: string }): Promise<TranslationAdapterOutput> {
    return (await this.prepareSubmission(input))();
  }

  /**
   * Reads the credential snapshot before the worker's shared QPS gate. The
   * returned closure performs no storage I/O before synchronously entering
   * transport, so rate admission and the actual POST start stay aligned.
   */
  async prepareSubmission(input: TranslationInput & { requestId?: string }): Promise<PreparedBaiduSubmission> {
    const credentials = await this.credentials();
    if (!credentials) throw new TranslationAdapterError({ error: TRANSLATION_PROVIDER_ERROR_CODES.authentication });
    return () => this.translateWithCredentials(input, credentials);
  }

  /**
   * The manual safety gate passes the exact credential snapshot it reviewed.
   * This avoids a second storage read between that review and transport submit.
   */
  async translateWithCredentials(input: TranslationInput & { requestId?: string }, credentials: BaiduServiceWorkerCredentials): Promise<TranslationAdapterOutput> {
    const salt = this.salt();
    const fields = {
      q: input.text,
      from: input.sourceLanguage,
      to: input.targetLanguage,
      appid: credentials.appId,
      salt,
      sign: baiduMd5Hex(`${credentials.appId}${input.text}${salt}${credentials.secret}`),
    } as const;
    const controller = new AbortController();
    this.activeControllers.add(controller);
    if (input.requestId) {
      const controllers = this.activeControllersByRequest.get(input.requestId) ?? new Set<AbortController>();
      controllers.add(controller);
      this.activeControllersByRequest.set(input.requestId, controllers);
    }
    let timedOut = false;
    const timeout = this.timer.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      const response = await this.postForm(BAIDU_TRANSLATE_ENDPOINT, fields, controller.signal);
      if (response.status < 200 || response.status >= 300) throw new TranslationAdapterError(failureForHttpStatus(response.status));
      const body = await response.json().catch(() => undefined);
      const code = typeof body === "object" && body !== null && "error_code" in body ? providerCode(body.error_code) : undefined;
      if (code) throw new TranslationAdapterError(failureForProviderCode(code));
      const translatedText = translatedTextFrom(body);
      if (!translatedText) throw new TranslationAdapterError({ error: TRANSLATION_PROVIDER_ERROR_CODES.serviceUnavailable });
      return { translatedText, sourceLanguage: detectedSourceLanguage(body, input.sourceLanguage), targetLanguage: input.targetLanguage, adapter: this.id };
    } catch (error) {
      if (error instanceof TranslationAdapterError) throw error;
      throw new TranslationAdapterError({ error: timedOut ? TRANSLATION_PROVIDER_ERROR_CODES.timeout : TRANSLATION_PROVIDER_ERROR_CODES.network });
    } finally {
      this.timer.clearTimeout(timeout);
      this.activeControllers.delete(controller);
      if (input.requestId) {
        const controllers = this.activeControllersByRequest.get(input.requestId);
        controllers?.delete(controller);
        if (controllers?.size === 0) this.activeControllersByRequest.delete(input.requestId);
      }
    }
  }

  /** Stops in-flight worker transport after a safety-sensitive invalidation. */
  abortAll(): void {
    for (const controller of this.activeControllers) controller.abort();
  }

  abortRequest(requestId: string): void {
    for (const controller of this.activeControllersByRequest.get(requestId) ?? []) controller.abort();
  }
}
