import { describe, expect, it } from "vitest";
import { FakeTranslationAdapter } from "../../src/background/fake-translation-adapter";
import { TranslationAdapterError, TRANSLATION_PROVIDER_ERROR_CODES } from "../../src/shared/translation";

describe("Fake 翻译服务适配器", () => {
  it("为可视文本内容块返回独立人工写定的固定译文", async () => {
    const adapter = new FakeTranslationAdapter();

    await expect(adapter.translate({
      text: "This source text must remain unchanged in the page.",
      sourceLanguage: "auto",
      targetLanguage: "zh",
    })).resolves.toEqual({
      translatedText: "这是可见文本块的固定中文译文。",
      sourceLanguage: "auto",
      targetLanguage: "zh",
      adapter: "fake",
    });
  });

  it.each([
    ["网络", "network", "NETWORK_ERROR"],
    ["超时", "timeout", "TIMEOUT"],
    ["限流", "rate-limited", "RATE_LIMITED"],
    ["鉴权", "authentication", "AUTHENTICATION_FAILED"],
    ["配额", "quota-exhausted", "PROVIDER_QUOTA_EXHAUSTED"],
    ["不支持语言", "unsupported-language", "UNSUPPORTED_LANGUAGE"],
    ["无效参数", "invalid-request", "INVALID_REQUEST"],
    ["内容风险", "content-risk", "CONTENT_RISK"],
    ["临时服务", "service-unavailable", "SERVICE_UNAVAILABLE"],
  ] as const)("脚本化 Fake 稳定返回%s脱敏故障类别", async (_label, scenario, expected) => {
    const adapter = new FakeTranslationAdapter({ scenarios: [{ kind: scenario, providerCode: "test-code" }] });

    await expect(adapter.translate({ text: "Local fixture only.", sourceLanguage: "auto", targetLanguage: "zh" })).rejects.toMatchObject({
      name: TranslationAdapterError.name,
      failure: { error: expected, providerCode: "test-code" },
    });
    expect(Object.values(TRANSLATION_PROVIDER_ERROR_CODES)).toContain(expected);
  });

  it("脚本化慢响应由可注入等待控制，之后仍可按顺序成功", async () => {
    const waits: number[] = [];
    const adapter = new FakeTranslationAdapter({
      scenarios: [{ kind: "slow", delayMs: 800 }, { kind: "success", translatedText: "后续成功" }],
      wait: async (milliseconds) => { waits.push(milliseconds); },
    });

    await expect(adapter.translate({ text: "First.", sourceLanguage: "auto", targetLanguage: "zh" })).resolves.toMatchObject({ translatedText: "这是可见文本块的固定中文译文。" });
    await expect(adapter.translate({ text: "Second.", sourceLanguage: "auto", targetLanguage: "zh" })).resolves.toMatchObject({ translatedText: "后续成功" });
    expect(waits).toEqual([800, 300]);
  });
});
