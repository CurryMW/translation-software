// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeTranslationAdapter } from "../../src/background/fake-translation-adapter";

afterEach(() => {
  document.documentElement.innerHTML = "";
  delete (globalThis as typeof globalThis & { __webTranslationContentState?: unknown }).__webTranslationContentState;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const provider = { adapter: "fake" as const, version: "fake-v1" };
const allowedSession = (currentProvider = provider) => ({ ok: true as const, targetLanguage: "zh" as const, provider: currentProvider, session: { id: "stay-test" }, disposition: "allowed" as const });

function makeVisible(element: Element): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ top: 20, right: 600, bottom: 80, left: 20, width: 580, height: 60 }),
  });
}

function success(requestId: string, blockId: string, translatedText: string, adapterVersion = "fake-v1") {
  return {
    ok: true as const,
    requestId,
    blockId,
    output: { translatedText, sourceLanguage: "auto" as const, targetLanguage: "zh" as const, adapter: "fake" as const, adapterVersion },
  };
}

function translationCalls(sendMessage: ReturnType<typeof vi.fn>) {
  return sendMessage.mock.calls.filter(([message]) => message.type === "translation.translate");
}

describe("过期翻译结果保护", () => {
  it("Fake 适配器乱序完成时只写回稳定后的 B 结果", async () => {
    document.body.innerHTML = "<p>This is the original readable content.</p>";
    const source = document.querySelector<HTMLElement>("p")!;
    makeVisible(source);
    const waits: Array<{ delayMs: number; resolve: () => void }> = [];
    const adapter = new FakeTranslationAdapter({
      scenarios: [
        { kind: "slow", delayMs: 1_500, translatedText: "A 的延迟结果" },
        { kind: "success", translatedText: "B 的稳定结果" },
      ],
      wait: (delayMs) => new Promise((resolve) => { waits.push({ delayMs, resolve }); }),
    });
    const sendMessage = vi.fn(async (message: { type: string; payload?: { requestId: string; blockId: string; text: string; sourceLanguage: "auto"; targetLanguage: "zh" } }) => {
      if (message.type === "page-session.settings.get") return allowedSession();
      if (message.type === "translation.cancel") return { ok: true as const };
      const output = await adapter.translate(message.payload!);
      return { ok: true as const, requestId: message.payload!.requestId, blockId: message.payload!.blockId, output: { ...output, adapterVersion: adapter.version } };
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    await import("../../src/content/content-script");
    await vi.waitFor(() => expect(waits).toHaveLength(1));
    source.textContent = "This is the stable replacement readable content.";
    await vi.waitFor(() => expect(waits).toHaveLength(2), { timeout: 750 });

    waits.find((wait) => wait.delayMs === 300)?.resolve();
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>("[data-web-translation-translation='root']")?.shadowRoot?.textContent).toContain("B 的稳定结果"));
    waits.find((wait) => wait.delayMs === 1_500)?.resolve();
    await Promise.resolve();

    const host = document.querySelector<HTMLElement>("[data-web-translation-translation='root']");
    expect(host?.shadowRoot?.textContent).not.toContain("A 的延迟结果");
    expect(translationCalls(sendMessage)).toHaveLength(2);
  });

  it("A 在途期间文字改为 B 时立即移除旧容器，稳定后只让 B 写回", async () => {
    document.body.innerHTML = "<p>This is the original readable content.</p>";
    const source = document.querySelector<HTMLElement>("p")!;
    makeVisible(source);
    const pending: Array<(value: unknown) => void> = [];
    const sendMessage = vi.fn((message: { type: string; payload?: { requestId: string; blockId: string } }) => (
      message.type === "page-session.settings.get"
        ? Promise.resolve(allowedSession())
        : message.type === "translation.cancel"
          ? Promise.resolve({ ok: true })
          : new Promise((resolve) => pending.push(resolve))
    ));
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    await import("../../src/content/content-script");
    await vi.waitFor(() => expect(translationCalls(sendMessage)).toHaveLength(1));
    const first = translationCalls(sendMessage)[0]![0].payload!;
    source.textContent = "This is the replacement readable content.";
    await vi.waitFor(() => expect(document.querySelector("[data-web-translation-translation='root']")).toBeNull());
    await vi.waitFor(() => expect(translationCalls(sendMessage)).toHaveLength(2), { timeout: 750 });
    const second = translationCalls(sendMessage)[1]![0].payload!;
    pending[1]?.(success(second.requestId, second.blockId, "B 的新译文"));
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>("[data-web-translation-translation='root']")?.shadowRoot?.textContent).toContain("B 的新译文"));
    pending[0]?.(success(first.requestId, first.blockId, "A 的旧译文"));
    await Promise.resolve();
    const host = document.querySelector<HTMLElement>("[data-web-translation-translation='root']");
    expect(host?.shadowRoot?.textContent).not.toContain("A 的旧译文");
    expect(translationCalls(sendMessage)).toHaveLength(2);
  });

  it("供应商身份是结果写回条件：其他身份即使请求、块、文字和语言均相同也会被拒绝", async () => {
    document.body.innerHTML = "<p>This is a readable English sentence.</p>";
    makeVisible(document.querySelector("p")!);
    let resolveTranslation: ((value: unknown) => void) | undefined;
    const sendMessage = vi.fn((message: { type: string; payload?: { requestId: string; blockId: string } }) => (
      message.type === "page-session.settings.get"
        ? Promise.resolve(allowedSession())
        : message.type === "translation.cancel"
          ? Promise.resolve({ ok: true })
          : new Promise((resolve) => { resolveTranslation = resolve; })
    ));
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    await import("../../src/content/content-script");
    await vi.waitFor(() => expect(translationCalls(sendMessage)).toHaveLength(1));
    const task = translationCalls(sendMessage)[0]![0].payload!;
    resolveTranslation?.(success(task.requestId, task.blockId, "错误供应商结果", "fake-v2"));

    await vi.waitFor(() => expect(document.querySelector("[data-web-translation-translation='root']")).toBeNull());
    expect(translationCalls(sendMessage)).toHaveLength(1);
  });

  it.each([
    ["原文语言", { sourceLanguage: "en" as const }],
    ["目标语言", { targetLanguage: "jp" as const }],
  ])("结果%s不匹配时卸载加载容器且不自动重试", async (_identity, mismatch) => {
    document.body.innerHTML = "<p>This is a readable English sentence.</p>";
    makeVisible(document.querySelector("p")!);
    let resolveTranslation: ((value: unknown) => void) | undefined;
    const sendMessage = vi.fn((message: { type: string; payload?: { requestId: string; blockId: string } }) => (
      message.type === "page-session.settings.get"
        ? Promise.resolve(allowedSession())
        : message.type === "translation.cancel"
          ? Promise.resolve({ ok: true })
          : new Promise((resolve) => { resolveTranslation = resolve; })
    ));
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    await import("../../src/content/content-script");
    await vi.waitFor(() => expect(translationCalls(sendMessage)).toHaveLength(1));
    const task = translationCalls(sendMessage)[0]![0].payload!;
    const result = success(task.requestId, task.blockId, "不应写回的语言不匹配结果");
    resolveTranslation?.({ ...result, output: { ...result.output, ...mismatch } });

    await vi.waitFor(() => expect(document.querySelector("[data-web-translation-translation='root']")).toBeNull());
    expect(translationCalls(sendMessage)).toHaveLength(1);
  });

  it("提交时冻结供应商身份：当前会话版本变化后不得接受旧请求结果", async () => {
    document.body.innerHTML = "<p>This is a readable English sentence.</p>";
    makeVisible(document.querySelector("p")!);
    const sessionProvider = { adapter: "fake" as const, version: "fake-v1" };
    let resolveTranslation: ((value: unknown) => void) | undefined;
    const sendMessage = vi.fn((message: { type: string; payload?: { requestId: string; blockId: string } }) => (
      message.type === "page-session.settings.get"
        ? Promise.resolve(allowedSession(sessionProvider))
        : message.type === "translation.cancel"
          ? Promise.resolve({ ok: true })
          : new Promise((resolve) => { resolveTranslation = resolve; })
    ));
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    await import("../../src/content/content-script");
    await vi.waitFor(() => expect(translationCalls(sendMessage)).toHaveLength(1));
    const task = translationCalls(sendMessage)[0]![0].payload!;
    sessionProvider.version = "fake-v2";
    resolveTranslation?.(success(task.requestId, task.blockId, "不应写回的版本漂移结果", "fake-v2"));

    await vi.waitFor(() => expect(document.querySelector("[data-web-translation-translation='root']")).toBeNull());
    expect(translationCalls(sendMessage)).toHaveLength(1);
  });

  it("当前会话 provider 变化后，旧请求的失败结果也必须被丢弃", async () => {
    document.body.innerHTML = "<p>This is a readable English sentence.</p>";
    makeVisible(document.querySelector("p")!);
    const sessionProvider = { adapter: "fake" as const, version: "fake-v1" };
    let resolveTranslation: ((value: unknown) => void) | undefined;
    const sendMessage = vi.fn((message: { type: string; payload?: { requestId: string; blockId: string } }) => (
      message.type === "page-session.settings.get"
        ? Promise.resolve(allowedSession(sessionProvider))
        : message.type === "translation.cancel"
          ? Promise.resolve({ ok: true })
          : new Promise((resolve) => { resolveTranslation = resolve; })
    ));
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    await import("../../src/content/content-script");
    await vi.waitFor(() => expect(translationCalls(sendMessage)).toHaveLength(1));
    const task = translationCalls(sendMessage)[0]![0].payload!;
    sessionProvider.version = "fake-v2";
    resolveTranslation?.({ ok: false, requestId: task.requestId, blockId: task.blockId, error: "NETWORK_ERROR" });

    await vi.waitFor(() => expect(document.querySelector("[data-web-translation-translation='root']")).toBeNull());
    expect(translationCalls(sendMessage)).toHaveLength(1);
  });

  it("路由 reset 成功前不提交新路由翻译，成功后才重新取得会话设置", async () => {
    document.body.innerHTML = "<p>This is the first route content.</p>";
    makeVisible(document.querySelector("p")!);
    let resolveRouteReset: ((value: unknown) => void) | undefined;
    const sendMessage = vi.fn((message: { type: string; payload?: { requestId: string; blockId: string } }) => {
      if (message.type === "page-session.settings.get") return Promise.resolve(allowedSession());
      if (message.type === "page-session.route-changed") return new Promise((resolve) => { resolveRouteReset = resolve; });
      if (message.type === "translation.cancel") return Promise.resolve({ ok: true });
      return Promise.resolve(success(message.payload!.requestId, message.payload!.blockId, "当前路由译文"));
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    await import("../../src/content/content-script");
    await vi.waitFor(() => expect(translationCalls(sendMessage)).toHaveLength(1));
    document.body.innerHTML = "<p>This is the second route content.</p>";
    makeVisible(document.querySelector("p")!);
    window.dispatchEvent(new PopStateEvent("popstate"));

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: "page-session.route-changed", payload: { session: { id: "stay-test" } } }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(translationCalls(sendMessage)).toHaveLength(1);
    resolveRouteReset?.({ ok: true });
    await vi.waitFor(() => expect(translationCalls(sendMessage)).toHaveLength(2));
  });

  it("路由 ACK 失效时重新握手为待确认状态，不恢复旧会话的自动提交", async () => {
    document.body.innerHTML = "<p>This is the first route content.</p>";
    makeVisible(document.querySelector("p")!);
    let settingsReads = 0;
    const sendMessage = vi.fn((message: { type: string; payload?: { requestId: string; blockId: string } }) => {
      if (message.type === "page-session.settings.get") {
        settingsReads += 1;
        return Promise.resolve(settingsReads === 1
          ? allowedSession()
          : { ok: true as const, targetLanguage: "zh" as const, provider, session: { id: "stay-after-worker-restart" }, disposition: "awaiting-decision" as const });
      }
      if (message.type === "page-session.route-changed") return Promise.resolve({ ok: false });
      if (message.type === "translation.cancel") return Promise.resolve({ ok: true });
      return Promise.resolve(success(message.payload!.requestId, message.payload!.blockId, "首路由译文"));
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    await import("../../src/content/content-script");
    await vi.waitFor(() => expect(translationCalls(sendMessage)).toHaveLength(1));
    document.body.innerHTML = "<p>This is the second route content.</p>";
    makeVisible(document.querySelector("p")!);
    window.dispatchEvent(new PopStateEvent("popstate"));

    await vi.waitFor(() => expect(settingsReads).toBe(2));
    expect(document.querySelector("[data-web-translation-tab-session-prompt]")).not.toBeNull();
    expect(translationCalls(sendMessage)).toHaveLength(1);
  });
});
