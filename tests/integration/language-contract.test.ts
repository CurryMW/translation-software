import { describe, expect, it } from "vitest";
import {
  BAIDU_MVP_LANGUAGES,
  isBaiduLanguageCode,
  isBaiduMvpDirection,
} from "../../src/shared/languages";
import {
  isPageSessionSettingsMessage,
  isSiteSettingsMessage,
  isTranslationMessage,
} from "../../src/shared/messages";

describe("语言共享契约", () => {
  it("只公开当前 MVP 固定验证的百度语言代码与方向", () => {
    expect(BAIDU_MVP_LANGUAGES.map(({ code }) => code)).toEqual(["zh", "en", "jp", "kor", "spa"]);
    expect(isBaiduLanguageCode("fra")).toBe(false);
    expect(isBaiduMvpDirection("auto", "zh")).toBe(true);
    expect(isBaiduMvpDirection("en", "en")).toBe(false);
  });

  it("只接受受支持的网站目标语言与页面会话设置查询", () => {
    expect(isSiteSettingsMessage({ type: "site-settings.set-target-language", payload: { domain: "example.test", targetLanguage: "jp" } })).toBe(true);
    expect(isSiteSettingsMessage({ type: "site-settings.set-target-language", payload: { domain: "example.test", targetLanguage: "auto" } })).toBe(false);
    expect(isPageSessionSettingsMessage({ type: "page-session.settings.get" })).toBe(true);
  });

  it("翻译任务在运行时拒绝未支持的源语言或目标语言", () => {
    const payload = { requestId: "request", blockId: "block", text: "Synthetic text.", sourceLanguage: "en", targetLanguage: "zh" };
    const session = { id: "stay-1" };
    expect(isTranslationMessage({ type: "translation.translate", session, payload })).toBe(true);
    expect(isTranslationMessage({ type: "translation.translate", payload })).toBe(false);
    expect(isTranslationMessage({ type: "translation.translate", session, payload: { ...payload, sourceLanguage: "fra" } })).toBe(false);
    expect(isTranslationMessage({ type: "translation.translate", session, payload: { ...payload, targetLanguage: "auto" } })).toBe(false);
  });
});
