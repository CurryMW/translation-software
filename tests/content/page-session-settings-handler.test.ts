import { describe, expect, it, vi } from "vitest";
import { createPageSessionSettingsHandler } from "../../src/background/page-session-settings-handler";

describe("页面会话设置行为接缝", () => {
  it("只向已授权且已开启的当前网页内容脚本交付该网站的目标语言", async () => {
    const handler = createPageSessionSettingsHandler({
      connect: vi.fn().mockResolvedValue({ ok: true, targetLanguage: "jp", provider: { adapter: "fake", version: "fake-v1" }, session: { id: "stay-1" }, disposition: "awaiting-decision" }),
      isCurrent: vi.fn().mockResolvedValue(true),
      pause: vi.fn(),
    });

    await expect(handler.handle({ tab: { id: 1 }, url: "https://article.example.test/" })).resolves.toEqual({
      ok: true,
      targetLanguage: "jp",
      provider: { adapter: "fake", version: "fake-v1" },
      session: { id: "stay-1" },
      disposition: "awaiting-decision",
    });
  });

  it("拒绝扩展页、未获权限或关闭的网站，避免内容脚本自行读取存储", async () => {
    const handler = createPageSessionSettingsHandler({
      connect: vi.fn().mockResolvedValue({ ok: false, error: "UNAVAILABLE" }),
      isCurrent: vi.fn(),
      pause: vi.fn(),
    });

    await expect(handler.handle({ tab: { id: 1 }, url: "chrome-extension://extension-id/popup.html" })).resolves.toEqual({ ok: false, error: "UNAVAILABLE" });
    await expect(handler.handle({ tab: { id: 1 }, url: "https://article.example.test/" })).resolves.toEqual({ ok: false, error: "UNAVAILABLE" });
  });

  it("后台标签页的会话控制器 fail closed 时不会交付会话设置", async () => {
    const handler = createPageSessionSettingsHandler({
      connect: vi.fn().mockResolvedValue({ ok: false, error: "UNAVAILABLE" }),
      isCurrent: vi.fn(),
      pause: vi.fn(),
    });

    await expect(handler.handle({ tab: { id: 1 }, url: "https://article.example.test/" })).resolves.toEqual({ ok: false, error: "UNAVAILABLE" });
  });

  it("设置读取期间切至后台时，不会把刚读取的会话交付给内容脚本", async () => {
    let resolveConnect: ((value: { ok: true; targetLanguage: "jp"; provider: { adapter: "fake"; version: "fake-v1" }; session: { id: "stay-1" }; disposition: "awaiting-decision" }) => void) | undefined;
    const connect = vi.fn(() => new Promise<typeof resolveConnect extends ((value: infer Result) => void) | undefined ? Result : never>((resolve) => { resolveConnect = resolve; }));
    const isCurrent = vi.fn().mockResolvedValue(false);
    const pause = vi.fn();
    const handler = createPageSessionSettingsHandler({ connect, isCurrent, pause });

    const result = handler.handle({ tab: { id: 1 }, url: "https://article.example.test/" });
    resolveConnect?.({ ok: true, targetLanguage: "jp", provider: { adapter: "fake", version: "fake-v1" }, session: { id: "stay-1" }, disposition: "awaiting-decision" });

    await expect(result).resolves.toEqual({ ok: false, error: "UNAVAILABLE" });
    expect(isCurrent).toHaveBeenCalledWith(1, "stay-1");
    expect(pause).toHaveBeenCalledWith(1, "stay-1");
  });
});
