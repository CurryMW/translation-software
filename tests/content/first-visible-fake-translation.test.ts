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

function pageSessionAware(translate: (message: { type: string; payload?: { requestId: string; blockId: string } }) => Promise<unknown>) {
  return vi.fn(async (message: { type: string; payload?: { requestId: string; blockId: string } }) => (
    message.type === "page-session.settings.get"
      ? { ok: true, targetLanguage: "zh", provider: { adapter: "fake", version: "fake-v1" }, session: { id: "stay-test" }, disposition: "allowed" }
      : message.type === "translation.cancel"
        ? { ok: true }
      : withProviderVersion(await translate(message))
  ));
}

function withProviderVersion(result: unknown): unknown {
  if (typeof result !== "object" || result === null || !("ok" in result) || result.ok !== true || !("output" in result)) return result;
  const output = result.output;
  return typeof output === "object" && output !== null ? { ...result, output: { ...output, adapterVersion: "fake-v1" } } : result;
}

function translationCalls(sendMessage: ReturnType<typeof vi.fn>) {
  return sendMessage.mock.calls.filter(([message]) => message.type === "translation.translate");
}

describe("首个可视文本内容块的 Fake 翻译任务", () => {
  it("成功译文只展示译文内容，不展示语言元数据或原文语言重试控件", async () => {
    document.body.innerHTML = '<p data-web-translation-static-block>This is a readable English sentence.</p>';
    makeVisible(document.querySelector("[data-web-translation-static-block]")!);
    const sendMessage = pageSessionAware(async (message) => ({
      ok: true,
      requestId: message.payload?.requestId,
      blockId: message.payload?.blockId,
      output: { translatedText: "只展示这段译文", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" },
    }));
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    await import("../../src/content/content-script");
    const host = document.querySelector("[data-web-translation-translation='root']") as HTMLElement;
    await vi.waitFor(() => expect(host.shadowRoot?.querySelector(".translation__text")?.textContent).toBe("只展示这段译文"));
    expect(host.shadowRoot?.querySelector(".translation__meta")).toBeNull();
    expect(host.shadowRoot?.querySelector(".translation__manual")).toBeNull();
    expect(host.shadowRoot?.querySelector("button")).toBeNull();
    expect(host.shadowRoot?.textContent).not.toContain("更正原文语言");
    expect(host.shadowRoot?.textContent).not.toContain("按所选原文语言重试");
  });

  it("立即在原文下方显示加载，成功后只展示译文且不重复翻译", async () => {
    document.body.innerHTML = '<p data-web-translation-static-block>This is a readable English sentence.</p>';
    makeVisible(document.querySelector("[data-web-translation-static-block]")!);
    let resolveTranslation: ((result: unknown) => void) | undefined;
    const sendMessage = pageSessionAware(() => new Promise((resolve) => { resolveTranslation = resolve; }));
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
        onMessage: { addListener: vi.fn() },
      },
    });

    await import("../../src/content/content-script");

    const source = document.querySelector("[data-web-translation-static-block]")!;
    await vi.waitFor(() => expect(source.nextElementSibling).not.toBeNull());
    const host = source.nextElementSibling as HTMLElement;
    expect(source.textContent).toBe("This is a readable English sentence.");
    expect(host.dataset.webTranslationTranslation).toBe("root");
    expect(host.shadowRoot?.textContent).toContain("正在翻译…");
    expect(translationCalls(sendMessage)).toHaveLength(1);

    resolveTranslation?.({
      ok: true,
      requestId: "first-visible-static-block",
      blockId: "first-visible-static-block",
      output: {
        translatedText: "这是可见文本块的固定中文译文。",
        sourceLanguage: "auto",
        targetLanguage: "zh",
        adapter: "fake",
      },
    });
    await vi.waitFor(() => expect(host.shadowRoot?.textContent).toContain("这是可见文本块的固定中文译文。"));

    expect(host.shadowRoot?.querySelector(".translation__text")?.textContent).toBe("这是可见文本块的固定中文译文。");
    expect(host.shadowRoot?.querySelector(".translation__meta")).toBeNull();
    expect(host.shadowRoot?.querySelector(".translation__manual")).toBeNull();
    expect(host.shadowRoot?.querySelector("button")).toBeNull();
    expect(translationCalls(sendMessage)).toHaveLength(1);
  });

  it("重复执行扫描时复用同一个页内译文容器", async () => {
    document.body.innerHTML = '<p data-web-translation-static-block>This is a readable English sentence.</p>';
    makeVisible(document.querySelector("[data-web-translation-static-block]")!);
    const sendMessage = pageSessionAware(async (message) => ({
      ok: true,
      requestId: message.payload?.requestId,
      blockId: message.payload?.blockId,
      output: { translatedText: "这是可见文本块的固定中文译文。", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" },
    }));
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    const contentScript = await import("../../src/content/content-script");
    contentScript.scanFirstVisibleStaticBlock();

    await vi.waitFor(() => expect(document.querySelectorAll("[data-web-translation-translation='root']")).toHaveLength(1));
    expect(translationCalls(sendMessage)).toHaveLength(1);
  });

  it("同一 document 被内容脚本再次执行时不重复绑定监听或提交译文", async () => {
    document.body.innerHTML = '<p data-web-translation-static-block>This is a readable English sentence.</p>';
    makeVisible(document.querySelector("[data-web-translation-static-block]")!);
    const addListener = vi.fn();
    const sendMessage = pageSessionAware(async (message) => ({
      ok: true,
      requestId: message.payload?.requestId,
      blockId: message.payload?.blockId,
      output: { translatedText: "这是可见文本块的固定中文译文。", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" },
    }));
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener } } });

    await import("../../src/content/content-script");
    await vi.waitFor(() => expect(translationCalls(sendMessage)).toHaveLength(1));
    vi.resetModules();
    await import("../../src/content/content-script");

    expect(addListener).toHaveBeenCalledTimes(1);
    expect(translationCalls(sendMessage)).toHaveLength(1);
    expect(document.querySelectorAll("[data-web-translation-translation='root']")).toHaveLength(1);
  });

  it("屏外静态文本内容块不会进入翻译会话", async () => {
    document.body.innerHTML = '<p data-web-translation-static-block>Offscreen source text.</p>';
    Object.defineProperty(document.querySelector("[data-web-translation-static-block]")!, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top: 1200, right: 600, bottom: 1260, left: 20, width: 580, height: 60 }),
    });
    const sendMessage = pageSessionAware(async () => undefined);
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    await import("../../src/content/content-script");

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: "page-session.settings.get" }));
    expect(translationCalls(sendMessage)).toHaveLength(0);
    expect(document.querySelector("[data-web-translation-translation='root']")).toBeNull();
  });

  it("页面级兼容性回退移除扩展 UI、取消在途任务并阻止后续新增请求", async () => {
    document.body.innerHTML = '<p data-web-translation-static-block>This is a readable English sentence.</p>';
    makeVisible(document.querySelector("[data-web-translation-static-block]")!);
    let listener: ((message: unknown) => void) | undefined;
    const pending: Array<(result: unknown) => void> = [];
    const sendMessage = pageSessionAware(() => new Promise((resolve) => pending.push(resolve)));
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: (callback: (message: unknown) => void) => { listener = callback; } } } });

    const contentScript = await import("../../src/content/content-script");
    await vi.waitFor(() => expect(translationCalls(sendMessage)).toHaveLength(1));
    expect(document.querySelector("[data-web-translation-translation='root']")).not.toBeNull();

    expect(contentScript.reportPageCompatibilityIssue("layout-breakage")).toBe(true);
    expect(document.querySelector("[data-web-translation-translation='root']")).toBeNull();
    expect(document.querySelector("[data-web-translation-compatibility-notice]")?.shadowRoot?.textContent).toContain("已暂停本页翻译");
    expect(document.querySelector("[data-web-translation-extension-shell]")?.getAttribute("data-page-session")).toBe("compatibility-paused");

    pending[0]?.({ ok: true, requestId: "first-visible-static-block", blockId: "first-visible-static-block", output: { translatedText: "迟到结果", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake", adapterVersion: "fake-v1" } });
    contentScript.scanStaticContentBlocks();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(translationCalls(sendMessage)).toHaveLength(1);
    listener?.({ type: "page-session.foreground", payload: { targetLanguage: "zh", provider: { adapter: "fake", version: "fake-v1" }, session: { id: "new-stay" }, disposition: "allowed" } });
    expect(translationCalls(sendMessage)).toHaveLength(1);
  });

  it("初始页面中的英文链接也会进入翻译；空白页不误报", async () => {
    document.body.innerHTML = '<p><a href="/account">Only an unsafe linked action.</a></p>';
    makeVisible(document.querySelector("p")!);
    const sendMessage = pageSessionAware(async () => undefined);
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    await import("../../src/content/content-script");
    await vi.waitFor(() => expect(translationCalls(sendMessage)).toHaveLength(1));
    expect(document.querySelector("[data-web-translation-compatibility-notice]")).toBeNull();
    expect(document.querySelector("[data-web-translation-extension-shell]")?.getAttribute("data-page-session")).not.toBe("compatibility-paused");

    document.documentElement.innerHTML = "";
    delete (globalThis as typeof globalThis & { __webTranslationContentState?: unknown }).__webTranslationContentState;
    delete (globalThis as typeof globalThis & { __webTranslationContentInstance?: unknown }).__webTranslationContentInstance;
    vi.resetModules();
    document.body.innerHTML = "";
    const emptySendMessage = pageSessionAware(async () => undefined);
    vi.stubGlobal("chrome", { runtime: { sendMessage: emptySendMessage, onMessage: { addListener: vi.fn() } } });
    await import("../../src/content/content-script");
    await vi.waitFor(() => expect(emptySendMessage).toHaveBeenCalledWith({ type: "page-session.settings.get" }));
    expect(document.querySelector("[data-web-translation-compatibility-notice]")).toBeNull();
  });

  it("整页只有不可安全探查的 iframe 时回退，不把空白页当作故障", async () => {
    document.body.innerHTML = '<iframe src="https://opaque.example.test/reading"></iframe>';
    const sendMessage = pageSessionAware(async () => undefined);
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    await import("../../src/content/content-script");
    await vi.waitFor(() => expect(document.querySelector("[data-web-translation-compatibility-notice]")?.shadowRoot?.textContent).toContain("无法安全识别"));
    expect(translationCalls(sendMessage)).toHaveLength(0);
  });

  it("新页面停留会话重置兼容性诊断，不把上一会话计数带入下一页", async () => {
    document.body.innerHTML = '<p data-web-translation-static-block>This is a readable English sentence.</p>';
    makeVisible(document.querySelector("p")!);
    let listener: ((message: unknown) => void) | undefined;
    let settingsReads = 0;
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === "page-session.settings.get") {
        settingsReads += 1;
        return { ok: true, targetLanguage: "zh" as const, provider: { adapter: "fake" as const, version: "fake-v1" }, session: { id: settingsReads === 1 ? "old-stay" : "new-stay" }, disposition: "allowed" as const };
      }
      return { ok: true, requestId: "first-visible-static-block", blockId: "first-visible-static-block", output: { translatedText: "固定译文", sourceLanguage: "auto" as const, targetLanguage: "zh" as const, adapter: "fake" as const, adapterVersion: "fake-v1" } };
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: (callback: (message: unknown) => void) => { listener = callback; } } } });

    const contentScript = await import("../../src/content/content-script");
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: "page-session.settings.get" }));
    contentScript.reportPageCompatibilityIssue("layout-breakage");
    expect((document.querySelector<HTMLElement>("[data-web-translation-extension-shell]")?.dataset.compatibilityDiagnostics)).toContain("page-fallback");
    listener?.({ type: "page-session.stop", payload: { reason: "site-disabled", scope: { kind: "current-document" } } });
    await contentScript.startContentSession();
    await vi.waitFor(() => expect(settingsReads).toBe(2));
    expect(document.querySelector<HTMLElement>("[data-web-translation-extension-shell]")?.dataset.compatibilityDiagnostics).toBe(JSON.stringify({ counts: {}, errors: {} }));
  });

  it("宿主伪造页面会话标记也会绑定 stop 监听并移除译文", async () => {
    document.documentElement.insertAdjacentHTML("beforeend", '<span data-web-translation-extension-shell="ready" data-stop-listener-bound="true"></span>');
    document.body.insertAdjacentHTML("beforeend", '<p data-web-translation-static-block>This is a readable English sentence.</p>');
    makeVisible(document.querySelector("[data-web-translation-static-block]")!);
    let listener: ((message: unknown) => void) | undefined;
    vi.stubGlobal("chrome", { runtime: { sendMessage: pageSessionAware(async (message) => ({ ok: true, requestId: message.payload?.requestId, blockId: message.payload?.blockId, output: { translatedText: "这是可见文本块的固定中文译文。", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" } })), onMessage: { addListener: (callback: (message: unknown) => void) => { listener = callback; } } } });

    await import("../../src/content/content-script");
    await vi.waitFor(() => expect(document.querySelector("[data-web-translation-translation='root']")).not.toBeNull());
    listener?.({ type: "page-session.stop", payload: { reason: "site-disabled", scope: { kind: "current-document" } } });
    expect(document.querySelector("[data-web-translation-translation='root']")).toBeNull();
  });

  it("停用后重开时不会让旧翻译任务覆盖新的译文容器", async () => {
    document.body.innerHTML = '<p data-web-translation-static-block>This is a readable English sentence.</p>';
    makeVisible(document.querySelector("[data-web-translation-static-block]")!);
    const pending: Array<(result: unknown) => void> = [];
    let listener: ((message: unknown) => void) | undefined;
    const sendMessage = pageSessionAware(() => new Promise((resolve) => pending.push(resolve)));
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: (callback: (message: unknown) => void) => { listener = callback; } } } });
    const contentScript = await import("../../src/content/content-script");
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    listener?.({ type: "page-session.stop", payload: { reason: "site-disabled", scope: { kind: "current-document" } } });
    contentScript.startContentSession();

    await vi.waitFor(() => expect(pending).toHaveLength(2));

    const identities = translationCalls(sendMessage).map(([message]) => message.payload!);
    expect(identities[1]?.requestId).not.toBe(identities[0]?.requestId);
    expect(identities[1]?.blockId).toBe(identities[0]?.blockId);
    pending[0]?.({ ok: true, requestId: identities[0]?.requestId, blockId: identities[0]?.blockId, output: { translatedText: "旧结果", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" } });
    pending[1]?.({ ok: true, requestId: identities[1]?.requestId, blockId: identities[1]?.blockId, output: { translatedText: "新结果", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" } });
    await vi.waitFor(() => expect(document.querySelector("[data-web-translation-translation='root']")?.shadowRoot?.textContent).toContain("新结果"));
    expect(document.querySelector("[data-web-translation-translation='root']")?.shadowRoot?.textContent).not.toContain("旧结果");
  });

  it.each([
    ["empty", '<p data-web-translation-static-block>   </p>'],
    ["hidden", '<p data-web-translation-static-block hidden>Hidden source.</p>'],
    ["aria hidden", '<p data-web-translation-static-block aria-hidden="true">Hidden source.</p>'],
    ["link", '<a href="#"><span data-web-translation-static-block>Linked source.</span></a>'],
    ["editable", '<div contenteditable="true"><p data-web-translation-static-block>Editable source.</p></div>'],
    ["form", '<form><p data-web-translation-static-block>Form source.</p></form>'],
  ])("拒绝 %s 的显式静态块", async (_kind, markup) => {
    document.body.innerHTML = markup;
    makeVisible(document.querySelector("[data-web-translation-static-block]")!);
    const sendMessage = pageSessionAware(async () => undefined);
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });
    await import("../../src/content/content-script");
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: "page-session.settings.get" }));
    expect(translationCalls(sendMessage)).toHaveLength(0);
  });

  it("两个可视静态块都通过内容发现接缝各提交一次", async () => {
    document.body.innerHTML = '<p data-web-translation-static-block>This is a first readable English sentence.</p><p data-web-translation-static-block>This is a second readable English sentence.</p>';
    for (const block of Array.from(document.querySelectorAll("[data-web-translation-static-block]"))) makeVisible(block);
    const sendMessage = pageSessionAware(async (message) => ({ ok: true, requestId: message.payload?.requestId, blockId: message.payload?.blockId, output: { translatedText: "这是可见文本块的固定中文译文。", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" } }));
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });
    await import("../../src/content/content-script");
    await vi.waitFor(() => expect(translationCalls(sendMessage)).toHaveLength(2));
    expect(document.querySelectorAll("[data-web-translation-translation='root']")).toHaveLength(2);
    expect((document.querySelector("[data-web-translation-static-block]")?.nextElementSibling as HTMLElement | null)?.dataset.webTranslationTranslation).toBe("root");
  });

  it("开放及嵌套开放 Shadow DOM 的可见块在各自 root 内翻译，不写入宿主错误位置", async () => {
    document.body.innerHTML = '<section id="shadow-host"></section>';
    const shadow = document.querySelector<HTMLElement>("#shadow-host")!.attachShadow({ mode: "open" });
    shadow.innerHTML = '<p data-fixture-id="shadow-block">A readable open shadow sentence.</p><div id="nested-host"></div>';
    const nested = shadow.querySelector<HTMLElement>("#nested-host")!.attachShadow({ mode: "open" });
    nested.innerHTML = '<p data-fixture-id="nested-shadow-block">A readable nested shadow sentence.</p>';
    const shadowBlock = shadow.querySelector<HTMLElement>("[data-fixture-id='shadow-block']")!;
    const nestedBlock = nested.querySelector<HTMLElement>("[data-fixture-id='nested-shadow-block']")!;
    makeVisible(shadowBlock);
    makeVisible(nestedBlock);
    const sendMessage = pageSessionAware(async (message) => ({
      ok: true,
      requestId: message.payload?.requestId,
      blockId: message.payload?.blockId,
      output: { translatedText: "影子树译文", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" },
    }));
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    await import("../../src/content/content-script");

    await vi.waitFor(() => expect(translationCalls(sendMessage)).toHaveLength(2));
    expect(shadowBlock.nextElementSibling?.getAttribute("data-web-translation-translation")).toBe("root");
    expect(nestedBlock.nextElementSibling?.getAttribute("data-web-translation-translation")).toBe("root");
    expect(document.querySelector("[data-web-translation-translation='root']")).toBeNull();
  });

  it("供应商级故障只显示一个文档顶部暂停提示，不在每个内容块重复错误", async () => {
    document.body.innerHTML = '<p data-web-translation-static-block>First readable sentence.</p><p data-web-translation-static-block>Second readable sentence.</p>';
    for (const block of Array.from(document.querySelectorAll("[data-web-translation-static-block]"))) makeVisible(block);
    const sendMessage = pageSessionAware(async (message) => message.type === "translation.translate"
      ? { ok: false, requestId: message.payload?.requestId, blockId: message.payload?.blockId, error: "AUTHENTICATION_FAILED" }
      : undefined);
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    await import("../../src/content/content-script");

    await vi.waitFor(() => expect(document.querySelectorAll("[data-web-translation-provider-notice]")).toHaveLength(1));
    expect(document.querySelector("[data-web-translation-provider-notice]")?.shadowRoot?.textContent).toContain("身份验证失败");
    for (const host of Array.from(document.querySelectorAll<HTMLElement>("[data-web-translation-translation='root']"))) expect(host.shadowRoot?.textContent).not.toContain("身份验证失败");
  });

  it("块级网络失败可手动重试，重试保留 blockId 并生成新 requestId", async () => {
    document.body.innerHTML = '<p data-web-translation-static-block>This is a readable English sentence.</p>';
    makeVisible(document.querySelector("[data-web-translation-static-block]")!);
    let attempts = 0;
    const sendMessage = pageSessionAware(async (message) => {
      if (message.type !== "translation.translate") return undefined;
      attempts += 1;
      return attempts === 1
        ? { ok: false, requestId: message.payload?.requestId, blockId: message.payload?.blockId, error: "NETWORK_ERROR" }
        : { ok: true, requestId: message.payload?.requestId, blockId: message.payload?.blockId, output: { translatedText: "手动重试成功", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" } };
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    await import("../../src/content/content-script");
    const host = document.querySelector<HTMLElement>("[data-web-translation-translation='root']")!;
    await vi.waitFor(() => expect(host.shadowRoot?.textContent).toContain("网络连接失败"));
    host.shadowRoot?.querySelector<HTMLButtonElement>("button")?.click();
    await vi.waitFor(() => expect(host.shadowRoot?.textContent).toContain("手动重试成功"));
    const requests = translationCalls(sendMessage).map(([message]) => message.payload!);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.blockId).toBe(requests[0]?.blockId);
    expect(requests[1]?.requestId).not.toBe(requests[0]?.requestId);
  });

  it("滑出视口会以无正文取消等待任务；预检只认可仍可见且原文未变的节点", async () => {
    document.body.innerHTML = '<p data-web-translation-static-block>This is a readable English sentence.</p>';
    const block = document.querySelector<HTMLElement>("[data-web-translation-static-block]")!;
    let visible = true;
    Object.defineProperty(block, "getBoundingClientRect", { configurable: true, value: () => visible ? ({ top: 20, right: 600, bottom: 80, left: 20, width: 580, height: 60 }) : ({ top: 1200, right: 600, bottom: 1260, left: 20, width: 580, height: 60 }) });
    let listener: ((message: unknown, sender?: unknown, sendResponse?: (response: unknown) => void) => unknown) | undefined;
    const sendMessage = pageSessionAware(() => new Promise(() => undefined));
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: (callback: typeof listener) => { listener = callback; } } } });
    await import("../../src/content/content-script");
    await vi.waitFor(() => expect(translationCalls(sendMessage)).toHaveLength(1));

    let mismatched: unknown;
    listener?.({ type: "translation.preflight", session: { id: "stay-test" }, payload: { requestId: "first-visible-static-block", blockId: "a-different-block" } }, undefined, (response) => { mismatched = response; });
    expect(mismatched).toMatchObject({ ok: false });
    let before: unknown;
    listener?.({ type: "translation.preflight", session: { id: "stay-test" }, payload: { requestId: "first-visible-static-block", blockId: "first-visible-static-block" } }, undefined, (response) => { before = response; });
    expect(before).toEqual({ ok: true });
    visible = false;
    window.dispatchEvent(new Event("scroll"));
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: "translation.cancel", session: { id: "stay-test" }, payload: { requestId: "first-visible-static-block", blockId: "first-visible-static-block" } }));
    const cancellation = sendMessage.mock.calls.find(([message]) => message.type === "translation.cancel")![0];
    expect(cancellation.payload).not.toHaveProperty("text");
    let after: unknown;
    listener?.({ type: "translation.preflight", session: { id: "stay-test" }, payload: { requestId: "first-visible-static-block", blockId: "first-visible-static-block" } }, undefined, (response) => { after = response; });
    expect(after).toMatchObject({ ok: false });
  });

  it("已成功的译文滑出再回到视口时保留原容器且不重新提交", async () => {
    document.body.innerHTML = '<p data-web-translation-static-block>This is a readable English sentence.</p>';
    const block = document.querySelector<HTMLElement>("[data-web-translation-static-block]")!;
    let visible = true;
    Object.defineProperty(block, "getBoundingClientRect", { configurable: true, value: () => visible ? ({ top: 20, right: 600, bottom: 80, left: 20, width: 580, height: 60 }) : ({ top: 1200, right: 600, bottom: 1260, left: 20, width: 580, height: 60 }) });
    const sendMessage = pageSessionAware(async (message) => ({ ok: true, requestId: message.payload?.requestId, blockId: message.payload?.blockId, output: { translatedText: "稳定译文", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" } }));
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });
    await import("../../src/content/content-script");
    const host = document.querySelector<HTMLElement>("[data-web-translation-translation='root']")!;
    await vi.waitFor(() => expect(host.shadowRoot?.textContent).toContain("稳定译文"));
    visible = false;
    window.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(host.isConnected).toBe(true);
    visible = true;
    window.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(translationCalls(sendMessage)).toHaveLength(1);
    expect(host.shadowRoot?.textContent).toContain("稳定译文");
  });

  it("滚回视口时为同一稳定内容块生成新请求，且旧结果不会回显", async () => {
    document.body.innerHTML = '<p data-web-translation-static-block>This is a readable English sentence.</p>';
    const block = document.querySelector<HTMLElement>("[data-web-translation-static-block]")!;
    let visible = true;
    Object.defineProperty(block, "getBoundingClientRect", { configurable: true, value: () => visible ? ({ top: 20, right: 600, bottom: 80, left: 20, width: 580, height: 60 }) : ({ top: 1200, right: 600, bottom: 1260, left: 20, width: 580, height: 60 }) });
    const pending: Array<(result: unknown) => void> = [];
    const sendMessage = pageSessionAware(() => new Promise((resolve) => pending.push(resolve)));
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });
    await import("../../src/content/content-script");
    await vi.waitFor(() => expect(translationCalls(sendMessage)).toHaveLength(1));
    const first = translationCalls(sendMessage)[0]![0].payload;
    visible = false;
    window.dispatchEvent(new Event("scroll"));
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: "translation.cancel", session: { id: "stay-test" }, payload: { requestId: first.requestId, blockId: first.blockId } }));
    visible = true;
    window.dispatchEvent(new Event("scroll"));
    await vi.waitFor(() => expect(translationCalls(sendMessage)).toHaveLength(2));
    const second = translationCalls(sendMessage)[1]![0].payload;
    expect(second).toMatchObject({ blockId: first.blockId });
    expect(second.requestId).not.toBe(first.requestId);
    pending[0]?.({ ok: true, requestId: first.requestId, blockId: first.blockId, output: { translatedText: "旧译文", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" } });
    pending[1]?.({ ok: true, requestId: second.requestId, blockId: second.blockId, output: { translatedText: "新译文", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" } });
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>("[data-web-translation-translation='root']")?.shadowRoot?.textContent).toContain("新译文"));
    expect(document.querySelector<HTMLElement>("[data-web-translation-translation='root']")?.shadowRoot?.textContent).not.toContain("旧译文");
  });
});
