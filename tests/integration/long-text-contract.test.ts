import { describe, expect, it } from "vitest";
import { FakeTranslationAdapter } from "../../src/background/fake-translation-adapter";
import { TranslationAdapterError, TRANSLATION_PROVIDER_ERROR_CODES } from "../../src/shared/translation";
import { normalizeTranslationSourceText } from "../../src/shared/text-normalization";

describe("长文本与页面内复用共享契约", () => {
  it("适配器公开稳定版本，供页面级成功结果缓存隔离", () => {
    const adapter = new FakeTranslationAdapter();

    expect(adapter.id).toBe("fake");
    expect(adapter.version).toBe("fake-v1");
    expect(adapter.version).not.toContain(" ");
  });

  it("适配器故障契约只携带脱敏类别、供应商码和可选等待", () => {
    const error = new TranslationAdapterError({
      error: TRANSLATION_PROVIDER_ERROR_CODES.rateLimited,
      providerCode: "54003",
      retryAfterMs: 1_000,
    });

    expect(error.failure).toEqual({ error: "RATE_LIMITED", providerCode: "54003", retryAfterMs: 1_000 });
    expect(error.message).not.toContain("request");
    expect(error.message).not.toContain("response");
  });

  it("内容候选身份与页面复用键共用同一段落规范化契约", () => {
    expect(normalizeTranslationSourceText("  First\r\n\r\n  Second\t part  \n \nThird  ")).toBe("First\n\nSecond part\n\nThird");
    expect(normalizeTranslationSourceText(" \n\n ")).toBe("");
  });
});
