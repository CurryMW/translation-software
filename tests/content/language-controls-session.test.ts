// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  document.documentElement.innerHTML = "";
  delete (globalThis as typeof globalThis & { __webTranslationContentState?: unknown }).__webTranslationContentState;
  vi.unstubAllGlobals();
  vi.resetModules();
});

function makeVisible(element: Element): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ top: 20, right: 600, bottom: 80, left: 20, width: 580, height: 60 }),
  });
}

describe("页面会话语言控制", () => {
  it("从 service worker 取得当前网站目标语言，并对同目标内容零请求", async () => {
    document.body.innerHTML = "<p>これは読みやすい日本語の文章です。</p>";
    makeVisible(document.querySelector("p")!);
    const sendMessage = vi.fn((message: { type: string }) => Promise.resolve(
      message.type === "page-session.settings.get"
        ? { ok: true, targetLanguage: "jp", provider: { adapter: "fake", version: "fake-v1" }, session: { id: "stay-test" }, disposition: "allowed" }
        : { ok: true },
    ));
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    await import("../../src/content/content-script");
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: "page-session.settings.get" }));

    expect(sendMessage.mock.calls.filter(([message]) => message.type === "translation.translate")).toHaveLength(0);
    expect(document.querySelector("[data-web-translation-translation='root']")).toBeNull();
  });

  it("页面设置不可用时不创建检查期加载容器且零翻译请求", async () => {
    document.body.innerHTML = "<p>This is a readable English sentence.</p>";
    makeVisible(document.querySelector("p")!);
    let resolveSettings: ((result: unknown) => void) | undefined;
    const sendMessage = vi.fn((_message: { type: string }) => new Promise((resolve) => { resolveSettings = resolve; }));
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    await import("../../src/content/content-script");
    expect(document.querySelector("[data-web-translation-translation='root']")).toBeNull();
    resolveSettings?.({ ok: false, error: "UNAVAILABLE" });
    await vi.waitFor(() => expect(document.querySelector("[data-web-translation-translation='root']")).toBeNull());
    expect(sendMessage.mock.calls.filter(([message]) => message.type === "translation.translate")).toHaveLength(0);
  });

  it("等待页面设置期间变为隐藏的内容不会创建加载容器或翻译请求", async () => {
    document.body.innerHTML = "<p>This is a readable English sentence.</p>";
    const source = document.querySelector("p")!;
    makeVisible(source);
    let resolveSettings: ((result: unknown) => void) | undefined;
    const sendMessage = vi.fn((_message: { type: string }) => new Promise((resolve) => { resolveSettings = resolve; }));
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    await import("../../src/content/content-script");
    expect(document.querySelector("[data-web-translation-translation='root']")).toBeNull();
    source.setAttribute("hidden", "");
    resolveSettings?.({ ok: true, targetLanguage: "zh", provider: { adapter: "fake", version: "fake-v1" }, session: { id: "stay-test" }, disposition: "allowed" });
    await vi.waitFor(() => expect(document.querySelector("[data-web-translation-translation='root']")).toBeNull());
    expect(sendMessage.mock.calls.filter(([message]) => message.type === "translation.translate")).toHaveLength(0);
  });


  it("纯中文内容在英语目标下会穿过发现层并提交自动翻译", async () => {
    document.body.innerHTML = "<p>这是一段可以翻译为其他目标语言的阅读内容。</p>";
    makeVisible(document.querySelector("p")!);
    const sendMessage = vi.fn((message: { type: string; payload?: unknown }) => Promise.resolve(
      message.type === "page-session.settings.get"
        ? { ok: true, targetLanguage: "en", provider: { adapter: "fake", version: "fake-v1" }, session: { id: "stay-test" }, disposition: "allowed" }
        : { ok: true, requestId: "first-visible-static-block", blockId: "first-visible-static-block", output: { translatedText: "Fixed translation", sourceLanguage: "auto", targetLanguage: "en", adapter: "fake", adapterVersion: "fake-v1" } },
    ));
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    await import("../../src/content/content-script");
    await vi.waitFor(() => expect(sendMessage.mock.calls.filter(([message]) => message.type === "translation.translate")).toHaveLength(1));
    expect(sendMessage.mock.calls.at(-1)?.[0]).toMatchObject({ payload: { sourceLanguage: "auto", targetLanguage: "en" } });
  });

  it("无法可靠识别时只显示当前内容块的手动入口，用户指定源语言后才重试", async () => {
    document.body.innerHTML = "<p>这是一段中文内容 Bonjour monde</p><p>This is a readable English sentence.</p>";
    for (const element of Array.from(document.querySelectorAll("p"))) makeVisible(element);
    const sendMessage = vi.fn((message: { type: string; payload?: { sourceLanguage?: string } }) => Promise.resolve(
      message.type === "page-session.settings.get"
        ? { ok: true, targetLanguage: "zh", provider: { adapter: "fake", version: "fake-v1" }, session: { id: "stay-test" }, disposition: "allowed" }
        : { ok: true, requestId: "static-content-2", blockId: "static-content-2", output: { translatedText: "固定译文", sourceLanguage: message.payload?.sourceLanguage ?? "auto", targetLanguage: "zh", adapter: "fake", adapterVersion: "fake-v1" } },
    ));
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    await import("../../src/content/content-script");
    const manualHost = document.querySelector("p")!.nextElementSibling as HTMLElement;
    await vi.waitFor(() => expect(manualHost.shadowRoot?.textContent).toContain("无法自动识别"));
    expect(sendMessage.mock.calls.filter(([message]) => message.type === "translation.translate")).toHaveLength(1);

    const selector = manualHost.shadowRoot?.querySelector<HTMLSelectElement>("select")!;
    expect(Array.from(selector.options).map((option) => option.value)).not.toContain("zh");
    selector.value = "en";
    selector.dispatchEvent(new Event("change", { bubbles: true }));
    manualHost.shadowRoot?.querySelector<HTMLButtonElement>("button")?.click();
    await vi.waitFor(() => expect(sendMessage.mock.calls.filter(([message]) => message.type === "translation.translate")).toHaveLength(2));
    expect(sendMessage.mock.calls.at(-1)?.[0]).toMatchObject({ payload: { sourceLanguage: "en", targetLanguage: "zh" } });
  });

  it("自动翻译结果只展示译文，不暴露原文语言更正控件", async () => {
    document.body.innerHTML = "<p>This is a readable English sentence.</p>";
    makeVisible(document.querySelector("p")!);
    const sendMessage = vi.fn((message: { type: string; payload?: { requestId?: string; blockId?: string; sourceLanguage?: string } }) => Promise.resolve(
      message.type === "page-session.settings.get"
        ? { ok: true, targetLanguage: "zh", provider: { adapter: "fake", version: "fake-v1" }, session: { id: "stay-test" }, disposition: "allowed" }
        : { ok: true, requestId: message.payload?.requestId, blockId: message.payload?.blockId, output: { translatedText: "固定译文", sourceLanguage: message.payload?.sourceLanguage ?? "auto", targetLanguage: "zh", adapter: "fake", adapterVersion: "fake-v1" } },
    ));
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    await import("../../src/content/content-script");
    const host = document.querySelector("p")!.nextElementSibling as HTMLElement;
    await vi.waitFor(() => expect(host.shadowRoot?.querySelector(".translation__text")?.textContent).toBe("固定译文"));
    expect(host.shadowRoot?.querySelector("select[aria-label='更正原文语言']")).toBeNull();
    expect(host.shadowRoot?.textContent).not.toContain("更正原文语言");
    expect(host.shadowRoot?.textContent).not.toContain("按所选原文语言重试");
    expect(sendMessage.mock.calls.filter(([message]) => message.type === "translation.translate")).toHaveLength(1);
  });

  it("目标语言改变会清理旧展示、重扫当前可视块，并且旧响应不能显示", async () => {
    document.body.innerHTML = "<p>This is a readable English sentence.</p>";
    makeVisible(document.querySelector("p")!);
    const pending: Array<(result: unknown) => void> = [];
    let listener: ((message: unknown) => void) | undefined;
    const sendMessage = vi.fn((message: { type: string; payload?: { targetLanguage?: string; requestId?: string; blockId?: string } }) => (
      message.type === "page-session.settings.get"
        ? Promise.resolve({ ok: true, targetLanguage: "zh", provider: { adapter: "fake", version: "fake-v1" }, session: { id: "stay-test" }, disposition: "allowed" })
        : message.type === "translation.cancel"
          ? Promise.resolve({ ok: true })
        : new Promise((resolve) => pending.push(resolve))
    ));
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: (value: (message: unknown) => void) => { listener = value; } } } });

    await import("../../src/content/content-script");
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    listener?.({ type: "page-session.target-language-changed", payload: { targetLanguage: "fra", scope: { kind: "current-document" } } });
    expect(pending).toHaveLength(1);
    listener?.({ type: "page-session.target-language-changed", payload: { targetLanguage: "jp", scope: { kind: "current-document" } } });
    await vi.waitFor(() => expect(pending).toHaveLength(2));

    const identities = sendMessage.mock.calls.filter(([message]) => message.type === "translation.translate").map(([message]) => message.payload!);
    expect(identities[1]?.requestId).not.toBe(identities[0]?.requestId);
    expect(identities[1]?.blockId).toBe(identities[0]?.blockId);
    pending[0]?.({ ok: true, requestId: identities[0]?.requestId, blockId: identities[0]?.blockId, output: { translatedText: "旧译文", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake", adapterVersion: "fake-v1" } });
    pending[1]?.({ ok: true, requestId: identities[1]?.requestId, blockId: identities[1]?.blockId, output: { translatedText: "新译文", sourceLanguage: "auto", targetLanguage: "jp", adapter: "fake", adapterVersion: "fake-v1" } });
    const host = document.querySelector("[data-web-translation-translation='root']") as HTMLElement;
    await vi.waitFor(() => expect(host.shadowRoot?.textContent).toContain("新译文"));
    expect(host.shadowRoot?.textContent).not.toContain("旧译文");
    expect(sendMessage.mock.calls.filter(([message]) => message.type === "translation.translate").map(([message]) => message.payload?.targetLanguage)).toEqual(["zh", "jp"]);
  });
});
