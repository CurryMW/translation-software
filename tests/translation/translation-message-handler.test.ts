import { describe, expect, it, vi } from "vitest";
import { createTranslationMessageHandler, translationSenderScope } from "../../src/background/translation-message-handler";
import type { TranslationMessage } from "../../src/shared/messages";
import { createTranslationScheduler } from "../../src/background/translation-scheduler";
import { TranslationAdapterError, TRANSLATION_PROVIDER_ERROR_CODES } from "../../src/shared/translation";

const message = { type: "translation.translate", session: { id: "stay-1" }, payload: { requestId: "request", blockId: "block", text: "Visible source.", sourceLanguage: "auto", targetLanguage: "zh" } } satisfies TranslationMessage;

function permittedSession() {
  return vi.fn().mockResolvedValue(true);
}

describe("翻译消息授权边界", () => {
  it("供应商暂停 scope 包含 documentId；缺失 documentId 时仅在当前 tab/frame 保守隔离", () => {
    expect(translationSenderScope({ tab: { id: 1 }, frameId: 0, documentId: "document-a" }, "stay-a")).toBe("tab:1/frame:0/document:document-a/session:stay-a");
    expect(translationSenderScope({ tab: { id: 1 }, frameId: 0 }, "stay-a")).toBe("tab:1/frame:0/document:unknown/session:stay-a");
    expect(translationSenderScope({ tab: { id: 2 }, frameId: 0, documentId: "document-a" }, "stay-a")).not.toBe(translationSenderScope({ tab: { id: 1 }, frameId: 0, documentId: "document-a" }, "stay-a"));
  });

  it("同页供应商暂停不波及其他 tab，导航到新 document 后可重新提交", async () => {
    const translate = vi.fn()
      .mockRejectedValueOnce(new TranslationAdapterError({ error: TRANSLATION_PROVIDER_ERROR_CODES.authentication }))
      .mockResolvedValue({ translatedText: "可用", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" });
    const scheduler = createTranslationScheduler({
      adapter: { id: "fake", version: "test-v1", translate },
      usage: { snapshot: vi.fn().mockResolvedValue({ settings: { plan: "advanced", monthlyCharacterBudget: 100 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 100 }), reserveBeforeSubmit: vi.fn().mockResolvedValue({ ok: true, snapshot: { periodKey: "2026-09" } }), releaseReservedCharacters: vi.fn() },
    });
    const handler = createTranslationMessageHandler({ adapter: { id: "fake", version: "test-v1", translate }, scheduler, hasHostPermission: vi.fn().mockResolvedValue(true), isDomainEnabled: vi.fn().mockResolvedValue(true), permitsSession: permittedSession() });
    const senderA = { tab: { id: 1 }, frameId: 0, documentId: "document-a", url: "https://article.example.test/" };

    await expect(handler.handle(message, senderA)).resolves.toMatchObject({ ok: false, error: "AUTHENTICATION_FAILED" });
    await expect(handler.handle({ ...message, payload: { ...message.payload, requestId: "same-page", blockId: "same-page" } }, senderA)).resolves.toMatchObject({ ok: false, error: "AUTHENTICATION_FAILED" });
    await expect(handler.handle({ ...message, payload: { ...message.payload, requestId: "other-frame", blockId: "other-frame" } }, { ...senderA, frameId: 1, documentId: "frame-document-a" })).resolves.toMatchObject({ ok: true });
    await expect(handler.handle({ ...message, payload: { ...message.payload, requestId: "other-tab", blockId: "other-tab" } }, { ...senderA, tab: { id: 2 } })).resolves.toMatchObject({ ok: true });
    await expect(handler.handle({ ...message, payload: { ...message.payload, requestId: "new-document", blockId: "new-document" } }, { ...senderA, documentId: "document-b" })).resolves.toMatchObject({ ok: true });
    expect(translate).toHaveBeenCalledTimes(4);
  });

  it("拒绝非 http(s) 页面、无主机权限和未开启域名的翻译任务", async () => {
    const translate = vi.fn();
    const handler = createTranslationMessageHandler({
      adapter: { id: "fake", version: "test-v1", translate },
      hasHostPermission: vi.fn().mockResolvedValue(false),
      isDomainEnabled: vi.fn().mockResolvedValue(false),
      permitsSession: permittedSession(),
    });

    await expect(handler.handle(message, { tab: { id: 1 }, url: "chrome-extension://extension-id/popup.html" })).resolves.toMatchObject({ ok: false, error: "TRANSLATION_FAILED" });
    await expect(handler.handle(message, { tab: { id: 1 }, url: "https://article.example.test/" })).resolves.toMatchObject({ ok: false, error: "TRANSLATION_FAILED" });
    expect(translate).not.toHaveBeenCalled();
  });

  it("仅为已获权限且已开启的页面调用适配器", async () => {
    const handler = createTranslationMessageHandler({
      adapter: { id: "fake", version: "test-v1", translate: vi.fn().mockResolvedValue({ translatedText: "人工固定译文", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" }) },
      hasHostPermission: vi.fn().mockResolvedValue(true),
      isDomainEnabled: vi.fn().mockResolvedValue(true),
      permitsSession: permittedSession(),
    });
    await expect(handler.handle(message, { tab: { id: 1 }, url: "https://article.example.test/" })).resolves.toMatchObject({
      ok: true,
      output: { translatedText: "人工固定译文", adapter: "fake", adapterVersion: "test-v1" },
    });
  });

  it("即使网站仍获授权，未被当前前台停留确认的任务也不能触及适配器", async () => {
    const translate = vi.fn();
    const handler = createTranslationMessageHandler({
      adapter: { id: "fake", version: "test-v1", translate },
      hasHostPermission: vi.fn().mockResolvedValue(true),
      isDomainEnabled: vi.fn().mockResolvedValue(true),
      permitsSession: vi.fn().mockResolvedValue(false),
    });

    await expect(handler.handle(message, { tab: { id: 1 }, url: "https://article.example.test/" })).resolves.toMatchObject({ ok: false, error: "TRANSLATION_FAILED" });
    expect(translate).not.toHaveBeenCalled();
  });

  it("同一停留的目标语言切换后，旧语言任务不提交而新语言任务通过授权", async () => {
    const translate = vi.fn().mockResolvedValue({ translatedText: "固定日语译文", sourceLanguage: "auto", targetLanguage: "jp", adapter: "fake" });
    const permitsSession = vi.fn(async (_sender, _sessionId, targetLanguage: "zh" | "jp") => targetLanguage === "jp");
    const handler = createTranslationMessageHandler({
      adapter: { id: "fake", version: "test-v1", translate },
      hasHostPermission: vi.fn().mockResolvedValue(true),
      isDomainEnabled: vi.fn().mockResolvedValue(true),
      permitsSession,
    });
    const sender = { tab: { id: 1 }, url: "https://article.example.test/" };

    await expect(handler.handle(message, sender)).resolves.toMatchObject({ ok: false, error: "TRANSLATION_FAILED" });
    await expect(handler.handle({ ...message, payload: { ...message.payload, requestId: "jp-task", blockId: "jp-task", targetLanguage: "jp" } }, sender)).resolves.toMatchObject({ ok: true });
    expect(permitsSession).toHaveBeenNthCalledWith(1, sender, "stay-1", "zh");
    expect(permitsSession).toHaveBeenNthCalledWith(2, sender, "stay-1", "jp");
    expect(translate).toHaveBeenCalledOnce();
  });

  it("预检在提交边界再次以任务目标语言校验会话，阻止 validate 后失效的旧任务", async () => {
    const translate = vi.fn().mockResolvedValue({ translatedText: "固定日语译文", sourceLanguage: "auto", targetLanguage: "jp", adapter: "fake" });
    const scheduler = createTranslationScheduler({
      adapter: { id: "fake", version: "test-v1", translate },
      usage: { snapshot: vi.fn().mockResolvedValue({ settings: { plan: "advanced", monthlyCharacterBudget: 100 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 100 }), reserveBeforeSubmit: vi.fn().mockResolvedValue({ ok: true, snapshot: { periodKey: "2026-09" } }), releaseReservedCharacters: vi.fn() },
    });
    const preflight = vi.fn(async (_sender, _identity, _session, targetLanguage: string) => (
      targetLanguage === "jp" ? { ok: true as const } : { ok: false as const, error: "SESSION_STOPPED" as const }
    ));
    const handler = createTranslationMessageHandler({
      adapter: { id: "fake", version: "test-v1", translate },
      scheduler,
      hasHostPermission: vi.fn().mockResolvedValue(true),
      isDomainEnabled: vi.fn().mockResolvedValue(true),
      permitsSession: permittedSession(),
      preflight,
    });
    const sender = { tab: { id: 1 }, url: "https://article.example.test/" };

    await expect(handler.handle(message, sender)).resolves.toMatchObject({ ok: false });
    await expect(handler.handle({ ...message, payload: { ...message.payload, requestId: "jp-preflight", blockId: "jp-preflight", targetLanguage: "jp" } }, sender)).resolves.toMatchObject({ ok: true });
    expect(preflight).toHaveBeenNthCalledWith(1, sender, { requestId: "request", blockId: "block" }, { id: "stay-1" }, "zh");
    expect(preflight).toHaveBeenNthCalledWith(2, sender, { requestId: "jp-preflight", blockId: "jp-preflight" }, { id: "stay-1" }, "jp");
    expect(translate).toHaveBeenCalledOnce();
  });

  it("无调度器的适配器调用仍保留已分类的供应商错误", async () => {
    const handler = createTranslationMessageHandler({
      adapter: { id: "fake", version: "test-v1", translate: vi.fn().mockRejectedValue(new TranslationAdapterError({ error: TRANSLATION_PROVIDER_ERROR_CODES.contentRisk })) },
      hasHostPermission: vi.fn().mockResolvedValue(true),
      isDomainEnabled: vi.fn().mockResolvedValue(true),
      permitsSession: permittedSession(),
    });

    await expect(handler.handle(message, { tab: { id: 1 }, url: "https://article.example.test/" })).resolves.toMatchObject({ ok: false, error: "CONTENT_RISK" });
  });

  it("只在同一 documentId 和同一路由内复用成功结果，显式 SPA 清理后必须再次提交", async () => {
    const translate = vi.fn().mockResolvedValue({ translatedText: "人工固定译文", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" });
    const handler = createTranslationMessageHandler({ adapter: { id: "fake", version: "test-v1", translate }, hasHostPermission: vi.fn().mockResolvedValue(true), isDomainEnabled: vi.fn().mockResolvedValue(true), permitsSession: permittedSession() });
    const sender = { tab: { id: 1 }, frameId: 0, documentId: "document-a", url: "https://article.example.test/" };
    await handler.handle(message, sender);
    await handler.handle({ ...message, payload: { ...message.payload, requestId: "next", blockId: "next", text: " Visible   source. " } }, sender);
    expect(translate).toHaveBeenCalledOnce();
    handler.clearPageReuse(1);
    await handler.handle({ ...message, payload: { ...message.payload, requestId: "same-document-new-route", blockId: "same-document-new-route" } }, sender);
    expect(translate).toHaveBeenCalledTimes(2);
    await handler.handle({ ...message, payload: { ...message.payload, requestId: "navigation", blockId: "navigation" } }, { ...sender, documentId: "document-b" });
    handler.clearPageReuse(1);
    await handler.handle({ ...message, payload: { ...message.payload, requestId: "after-close", blockId: "after-close" } }, { ...sender, documentId: "document-c" });
    expect(translate).toHaveBeenCalledTimes(4);
  });

  it("子 frame 路由切换只清除该 frame 的复用与队列，不影响同一 tab 的宿主文档", async () => {
    const translate = vi.fn().mockResolvedValue({ translatedText: "固定译文", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" });
    const handler = createTranslationMessageHandler({
      adapter: { id: "fake", version: "test-v1", translate },
      hasHostPermission: vi.fn().mockResolvedValue(true),
      isDomainEnabled: vi.fn().mockResolvedValue(true),
      permitsSession: permittedSession(),
    });
    const host = { tab: { id: 1 }, frameId: 0, documentId: "host-document", url: "https://article.example.test/" };
    const frame = { tab: { id: 1 }, frameId: 1, documentId: "frame-document", url: "https://article.example.test/embedded" };

    await handler.handle(message, host);
    await handler.handle({ ...message, payload: { ...message.payload, requestId: "frame-request", blockId: "frame-block" } }, frame);
    handler.clearFramePageReuse(1, 1);
    await handler.handle({ ...message, payload: { ...message.payload, requestId: "host-cache-hit", blockId: "host-cache-hit" } }, host);
    await handler.handle({ ...message, payload: { ...message.payload, requestId: "frame-after-route", blockId: "frame-after-route" } }, frame);

    expect(translate).toHaveBeenCalledTimes(3);
  });

  it("失败、缺少 documentId 及缓存键任一字段变化都不会复用", async () => {
    let version = "v1";
    const translate = vi.fn().mockResolvedValue({ translatedText: "固定", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" });
    const adapter = { id: "fake" as const, get version() { return version; }, translate };
    const handler = createTranslationMessageHandler({ adapter, hasHostPermission: vi.fn().mockResolvedValue(true), isDomainEnabled: vi.fn().mockResolvedValue(true), permitsSession: permittedSession() });
    const sender = { tab: { id: 2 }, documentId: "doc", url: "https://article.example.test/" };
    await handler.handle(message, sender);
    await handler.handle({ ...message, payload: { ...message.payload, requestId: "source", blockId: "source", sourceLanguage: "en" } }, sender);
    await handler.handle({ ...message, payload: { ...message.payload, requestId: "target", blockId: "target", targetLanguage: "en" } }, sender);
    version = "v2";
    await handler.handle({ ...message, payload: { ...message.payload, requestId: "version", blockId: "version" } }, sender);
    await handler.handle({ ...message, payload: { ...message.payload, requestId: "no-doc", blockId: "no-doc" } }, { tab: { id: 3 }, url: sender.url });
    translate.mockRejectedValueOnce(new Error("failed"));
    await handler.handle({ ...message, payload: { ...message.payload, requestId: "failure", blockId: "failure", text: "failed" } }, sender);
    translate.mockResolvedValue({ translatedText: "fixed", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" });
    await handler.handle({ ...message, payload: { ...message.payload, requestId: "retry", blockId: "retry", text: "failed" } }, sender);
    expect(translate).toHaveBeenCalledTimes(7);
  });

  it("即使恶意或过期内容脚本提交同语言方向，service worker 也不调用适配器", async () => {
    const translate = vi.fn();
    const handler = createTranslationMessageHandler({
      adapter: { id: "fake", version: "test-v1", translate },
      hasHostPermission: vi.fn().mockResolvedValue(true),
      isDomainEnabled: vi.fn().mockResolvedValue(true),
      permitsSession: permittedSession(),
    });
    const sameLanguage = { ...message, payload: { ...message.payload, sourceLanguage: "jp" as const, targetLanguage: "jp" as const } };

    await expect(handler.handle(sameLanguage, { tab: { id: 1 }, url: "https://article.example.test/" })).resolves.toMatchObject({ ok: false, error: "TRANSLATION_FAILED" });
    expect(translate).not.toHaveBeenCalled();
  });
});
