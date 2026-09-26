// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  document.documentElement.innerHTML = "";
  delete (globalThis as typeof globalThis & { __webTranslationContentState?: unknown }).__webTranslationContentState;
  delete (globalThis as typeof globalThis & { __webTranslationContentInstance?: unknown }).__webTranslationContentInstance;
  delete (globalThis as typeof globalThis & { __webTranslationDynamicController?: unknown }).__webTranslationDynamicController;
  vi.resetModules();
});

describe("页面会话停止范围", () => {
  it("撤销 A 的权限不会停止 B，只有当前 hostname 命中才停止", async () => {
    let listener: ((message: unknown) => void) | undefined;
    vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, targetLanguage: "zh", provider: { adapter: "fake", version: "fake-v1" }, session: { id: "stay-test" }, disposition: "allowed" }), onMessage: { addListener: (value: (message: unknown) => void) => { listener = value; } } } });
    await import("../../src/content/content-script");
    const marker = document.querySelector<HTMLElement>("[data-web-translation-extension-shell]")!;
    await vi.waitFor(() => expect(marker.dataset.pageSession).toBe("idle"));

    listener?.({ type: "page-session.stop", payload: { reason: "permission-revoked", scope: { kind: "domains", domains: ["other.example.test"] } } });
    expect(marker.dataset.pageSession).toBe("idle");
    listener?.({ type: "page-session.stop", payload: { reason: "permission-revoked", scope: { kind: "domains", domains: [location.hostname] } } });
    expect(marker.dataset.pageSession).toBe("stopped");
    listener?.({ type: "page-session.target-language-changed", payload: { targetLanguage: "jp", scope: { kind: "current-document" } } });
    expect(marker.dataset.pageSession).toBe("stopped");
  });

  it("关闭网站翻译的 hostname 范围会清理命中文档，异域消息不影响当前阅读页", async () => {
    let listener: ((message: unknown) => void) | undefined;
    vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, targetLanguage: "zh", provider: { adapter: "fake", version: "fake-v1" }, session: { id: "stay-test" }, disposition: "allowed" }), onMessage: { addListener: (value: (message: unknown) => void) => { listener = value; } } } });
    await import("../../src/content/content-script");
    const marker = document.querySelector<HTMLElement>("[data-web-translation-extension-shell]")!;
    await vi.waitFor(() => expect(marker.dataset.pageSession).toBe("idle"));

    listener?.({ type: "page-session.stop", payload: { reason: "site-disabled", scope: { kind: "domains", domains: ["other.example.test"] } } });
    expect(marker.dataset.pageSession).toBe("idle");
    listener?.({ type: "page-session.stop", payload: { reason: "site-disabled", scope: { kind: "domains", domains: [location.hostname] } } });
    expect(marker.dataset.pageSession).toBe("stopped");
  });
});
