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

function withPageSession(translate: (message: { payload: { requestId: string; blockId: string } }) => unknown) {
  return vi.fn(async (message: { type: string; payload: { requestId: string; blockId: string } }) => (
    message.type === "page-session.settings.get"
      ? { ok: true, targetLanguage: "zh", provider: { adapter: "fake", version: "fake-v1" }, session: { id: "stay-test" }, disposition: "allowed" }
      : withProviderVersion(await translate(message))
  ));
}

function withProviderVersion(result: unknown): unknown {
  if (typeof result !== "object" || result === null || !("ok" in result) || result.ok !== true || !("output" in result)) return result;
  const output = result.output;
  return typeof output === "object" && output !== null ? { ...result, output: { ...output, adapterVersion: "fake-v1" } } : result;
}

describe("静态页面翻译会话", () => {
  it("为每个已发现的可视内容块建立一个翻译任务和译文容器", async () => {
    document.body.innerHTML = `
      <h1 data-fixture-id="title">This is a readable English sentence.</h1>
      <p data-fixture-id="body">This is a readable English sentence.</p>
      <li data-fixture-id="item">This is a readable English sentence.</li>
    `;
    for (const element of Array.from(document.querySelectorAll("[data-fixture-id]"))) makeVisible(element);
    const sendMessage = withPageSession((message) => ({
      ok: true,
      requestId: message.payload.requestId,
      blockId: message.payload.blockId,
      output: { translatedText: "固定译文", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" },
    }));
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    await import("../../src/content/content-script");

    await vi.waitFor(() => expect(sendMessage.mock.calls.filter(([message]) => message.type === "translation.translate")).toHaveLength(3));
    expect(document.querySelectorAll("[data-web-translation-translation='root']")).toHaveLength(3);
  });

  it("以节点身份和规范化原文去重，并在原文变化后复用译文容器重新提交", async () => {
    document.body.innerHTML = '<p data-fixture-id="reading-block">This is a readable English sentence.</p>';
    const source = document.querySelector("[data-fixture-id='reading-block']")!;
    makeVisible(source);
    const sendMessage = withPageSession(async (message) => ({
      ok: true,
      requestId: message.payload.requestId,
      blockId: message.payload.blockId,
      output: { translatedText: "固定译文", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" },
    }));
    vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } });

    const contentScript = await import("../../src/content/content-script");
    contentScript.scanStaticContentBlocks();
    source.textContent = "This is a readable English sentence with content.";
    contentScript.scanStaticContentBlocks();

    await vi.waitFor(() => expect(sendMessage.mock.calls.filter(([message]) => message.type === "translation.translate")).toHaveLength(2));
    expect(document.querySelectorAll("[data-web-translation-translation='root']")).toHaveLength(1);
  });
});
