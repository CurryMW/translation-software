import { TranslationAdapterError, TRANSLATION_PROVIDER_ERROR_CODES, type TranslationAdapterOutput, type TranslationInput, type TranslationServiceAdapter } from "../shared/translation";

const FIXED_VISIBLE_BLOCK_TRANSLATION = "这是可见文本块的固定中文译文。";

export type FakeTranslationScenario =
  | { kind: "success"; translatedText?: string }
  | { kind: "slow"; delayMs?: number; translatedText?: string }
  | { kind: "network" | "timeout" | "rate-limited" | "authentication" | "quota-exhausted" | "unsupported-language" | "invalid-request" | "content-risk" | "service-unavailable"; providerCode?: string; retryAfterMs?: number };

const SCENARIO_ERROR_CODES = {
  network: TRANSLATION_PROVIDER_ERROR_CODES.network,
  timeout: TRANSLATION_PROVIDER_ERROR_CODES.timeout,
  "rate-limited": TRANSLATION_PROVIDER_ERROR_CODES.rateLimited,
  authentication: TRANSLATION_PROVIDER_ERROR_CODES.authentication,
  "quota-exhausted": TRANSLATION_PROVIDER_ERROR_CODES.quotaExhausted,
  "unsupported-language": TRANSLATION_PROVIDER_ERROR_CODES.unsupportedLanguage,
  "invalid-request": TRANSLATION_PROVIDER_ERROR_CODES.invalidRequest,
  "content-risk": TRANSLATION_PROVIDER_ERROR_CODES.contentRisk,
  "service-unavailable": TRANSLATION_PROVIDER_ERROR_CODES.serviceUnavailable,
} as const;

export class FakeTranslationAdapter implements TranslationServiceAdapter {
  readonly id = "fake" as const;
  readonly version = "fake-v1";
  private readonly scenarios: readonly FakeTranslationScenario[];
  private readonly wait: (milliseconds: number) => Promise<void>;
  private scenarioIndex = 0;

  constructor({ scenarios = [{ kind: "success" }], wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)) }: { scenarios?: readonly FakeTranslationScenario[]; wait?: (milliseconds: number) => Promise<void> } = {}) {
    this.scenarios = scenarios.length ? scenarios : [{ kind: "success" }];
    this.wait = wait;
  }

  async translate(input: TranslationInput): Promise<TranslationAdapterOutput> {
    const scenario = this.scenarios[Math.min(this.scenarioIndex, this.scenarios.length - 1)]!;
    this.scenarioIndex += 1;
    if (scenario.kind === "slow") await this.wait(scenario.delayMs ?? 1_500);
    else if (scenario.kind === "success") await this.wait(300);
    if (scenario.kind !== "success" && scenario.kind !== "slow") {
      throw new TranslationAdapterError({
        error: SCENARIO_ERROR_CODES[scenario.kind],
        providerCode: scenario.providerCode,
        retryAfterMs: scenario.retryAfterMs,
      });
    }
    return {
      translatedText: scenario.translatedText ?? FIXED_VISIBLE_BLOCK_TRANSLATION,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      adapter: this.id,
    };
  }
}
