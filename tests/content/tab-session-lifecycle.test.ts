// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  document.documentElement.innerHTML = "";
  delete (globalThis as typeof globalThis & { __webTranslationContentState?: unknown }).__webTranslationContentState;
  delete (globalThis as typeof globalThis & { __webTranslationContentInstance?: unknown }).__webTranslationContentInstance;
  delete (globalThis as typeof globalThis & { __webTranslationDynamicController?: unknown }).__webTranslationDynamicController;
  delete (globalThis as typeof globalThis & { __webTranslationReconcileVisible?: unknown }).__webTranslationReconcileVisible;
  delete (document as unknown as { visibilityState?: unknown }).visibilityState;
  vi.unstubAllGlobals();
  vi.resetModules();
});

function makeVisible(element: Element): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ top: 20, right: 600, bottom: 80, left: 20, width: 580, height: 60 }),
  });
}

function translations(sendMessage: ReturnType<typeof vi.fn>) {
  return sendMessage.mock.calls.filter(([message]) => message.type === "translation.translate");
}

describe("标签页切入翻译确认", () => {
  it("待确认的当前标签页显示可访问确认且在明确继续前绝不创建翻译任务", async () => {
    document.body.innerHTML = "<p>This is a readable English sentence.</p>";
    makeVisible(document.querySelector("p")!);
    const sendMessage = vi.fn((message: { type: string; payload?: { requestId?: string; blockId?: string } }) => {
      if (message.type === "page-session.settings.get") return Promise.resolve({
        ok: true,
        targetLanguage: "zh",
        provider: { adapter: "fake", version: "fake-v1" },
        session: { id: "stay-a" },
        disposition: "awaiting-decision",
      });
      if (message.type === "page-session.decision") return Promise.resolve({ ok: true, disposition: "allowed" });
      return Promise.resolve({
        ok: true,
        requestId: message.payload?.requestId,
        blockId: message.payload?.blockId,
        output: { translatedText: "固定译文", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake", adapterVersion: "fake-v1" },
      });
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    await import("../../src/content/content-script");

    await vi.waitFor(() => expect(document.querySelector<HTMLElement>("[data-web-translation-tab-session-prompt]"))?.not.toBeNull());
    const prompt = document.querySelector<HTMLElement>("[data-web-translation-tab-session-prompt]")!;
    const continueButton = prompt.shadowRoot?.querySelector<HTMLButtonElement>("button[data-action='accept']");
    const postponeButton = prompt.shadowRoot?.querySelector<HTMLButtonElement>("button[data-action='reject']");
    expect(continueButton?.textContent).toContain("继续翻译");
    expect(postponeButton?.textContent).toContain("暂不翻译");
    expect(translations(sendMessage)).toHaveLength(0);
    expect(document.querySelector("[data-web-translation-translation='root']")).toBeNull();

    continueButton?.click();

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      type: "page-session.decision",
      payload: { session: { id: "stay-a" }, decision: "accept" },
    }));
    await vi.waitFor(() => expect(translations(sendMessage)).toHaveLength(1));
  });

  it("关闭或 ESC 等同暂不翻译，且拒绝与后台化都保留已有成功译文并阻止动态新增", async () => {
    document.body.innerHTML = "<p id='first'>This is a readable English sentence.</p>";
    makeVisible(document.querySelector("#first")!);
    let listener: ((message: unknown) => void) | undefined;
    const sendMessage = vi.fn((message: { type: string; payload?: { requestId?: string; blockId?: string } }) => {
      if (message.type === "page-session.settings.get") return Promise.resolve({
        ok: true,
        targetLanguage: "zh",
        provider: { adapter: "fake", version: "fake-v1" },
        session: { id: "stay-a" },
        disposition: "allowed",
      });
      if (message.type === "page-session.decision") return Promise.resolve({ ok: true, disposition: "rejected" });
      if (message.type === "translation.cancel") return Promise.resolve({ ok: true });
      return Promise.resolve({
        ok: true,
        requestId: message.payload?.requestId,
        blockId: message.payload?.blockId,
        output: { translatedText: "已有译文", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake", adapterVersion: "fake-v1" },
      });
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: (value: (message: unknown) => void) => { listener = value; } } } });

    await import("../../src/content/content-script");
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>("[data-web-translation-translation='root']")?.shadowRoot?.textContent).toContain("已有译文"));
    const submittedBeforeForeground = translations(sendMessage).length;
    listener?.({
      type: "page-session.foreground",
      payload: {
        targetLanguage: "zh",
        provider: { adapter: "fake", version: "fake-v1" },
        session: { id: "stay-b" },
        disposition: "awaiting-decision",
      },
    });
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>("[data-web-translation-tab-session-prompt]")?.shadowRoot?.activeElement?.getAttribute("data-action")).toBe("accept"));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      type: "page-session.decision",
      payload: { session: { id: "stay-b" }, decision: "reject" },
    }));
    expect(document.querySelector<HTMLElement>("[data-web-translation-translation='root']")?.shadowRoot?.textContent).toContain("已有译文");
    listener?.({ type: "page-session.pause", payload: { session: { id: "stay-b" }, reason: "background" } });
    const dynamic = document.createElement("p");
    dynamic.textContent = "This newly visible dynamic sentence must not submit.";
    makeVisible(dynamic);
    document.body.append(dynamic);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(translations(sendMessage)).toHaveLength(submittedBeforeForeground);
    expect(document.querySelector<HTMLElement>("[data-web-translation-translation='root']")?.shadowRoot?.textContent).toContain("已有译文");
  });

  it("后台化会使已提交请求的迟到结果失去写回资格", async () => {
    document.body.innerHTML = "<p>This is a readable English sentence.</p>";
    makeVisible(document.querySelector("p")!);
    let listener: ((message: unknown) => void) | undefined;
    let resolveTranslation: ((value: unknown) => void) | undefined;
    const sendMessage = vi.fn((message: { type: string; payload?: { requestId?: string; blockId?: string } }) => {
      if (message.type === "page-session.settings.get") return Promise.resolve({
        ok: true,
        targetLanguage: "zh",
        provider: { adapter: "fake", version: "fake-v1" },
        session: { id: "stay-a" },
        disposition: "allowed",
      });
      if (message.type === "translation.cancel") return Promise.resolve({ ok: true });
      return new Promise((resolve) => { resolveTranslation = resolve; });
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: (value: (message: unknown) => void) => { listener = value; } } } });

    await import("../../src/content/content-script");
    await vi.waitFor(() => expect(translations(sendMessage)).toHaveLength(1));
    const task = translations(sendMessage)[0]![0].payload;
    listener?.({ type: "page-session.pause", payload: { session: { id: "stay-a" }, reason: "background" } });
    resolveTranslation?.({
      ok: true,
      requestId: task.requestId,
      blockId: task.blockId,
      output: { translatedText: "迟到结果", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake", adapterVersion: "fake-v1" },
    });

    await vi.waitFor(() => expect(document.querySelector("[data-web-translation-translation='root']")).toBeNull());
  });

  it("文档先变为 hidden 时不依赖 worker 暂停消息，也不会写回迟到结果或提交新增内容", async () => {
    document.body.innerHTML = "<p>This is a readable English sentence.</p>";
    makeVisible(document.querySelector("p")!);
    let visibility: "visible" | "hidden" = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    let resolveTranslation: ((value: unknown) => void) | undefined;
    const sendMessage = vi.fn((message: { type: string; payload?: { requestId?: string; blockId?: string } }) => {
      if (message.type === "page-session.settings.get") return Promise.resolve({
        ok: true,
        targetLanguage: "zh",
        provider: { adapter: "fake", version: "fake-v1" },
        session: { id: "stay-a" },
        disposition: "allowed",
      });
      if (message.type === "translation.cancel") return Promise.resolve({ ok: true });
      return new Promise((resolve) => { resolveTranslation = resolve; });
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    await import("../../src/content/content-script");
    await vi.waitFor(() => expect(translations(sendMessage)).toHaveLength(1));
    const task = translations(sendMessage)[0]![0].payload!;
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    resolveTranslation?.({
      ok: true,
      requestId: task.requestId,
      blockId: task.blockId,
      output: { translatedText: "不可写回的隐藏页结果", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake", adapterVersion: "fake-v1" },
    });
    const dynamic = document.createElement("p");
    dynamic.textContent = "This newly visible sentence arrived after the document became hidden.";
    makeVisible(dynamic);
    document.body.append(dynamic);

    await vi.waitFor(() => expect(document.querySelector("[data-web-translation-translation='root']")).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(translations(sendMessage)).toHaveLength(1);
  });
});
