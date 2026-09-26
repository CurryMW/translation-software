import { afterEach, describe, expect, it, vi } from "vitest";
import { BAIDU_PROVIDER_ORIGIN_PATTERN } from "../../src/shared/baidu-provider";

type RuntimeListener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean | void;

const review = {
  plan: "standard",
  quotaAndPricingConfirmed: true,
  qpsConfirmed: true,
  languageDirectionsConfirmed: true,
  singleRequestLengthConfirmed: true,
  dataTermsConfirmed: true,
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((next) => { resolve = next; });
  return { promise, resolve: () => resolve?.() };
}

function runtimeRequest(listener: () => RuntimeListener | undefined, message: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const registered = listener();
    if (!registered) return reject(new Error("worker listener was not registered"));
    expect(registered(message, sender, resolve)).toBe(true);
  });
}

function workerChrome({
  values,
  setAccessLevel = async () => undefined,
  query = vi.fn().mockResolvedValue([]),
  sendMessage = vi.fn().mockResolvedValue({ ok: true }),
}: {
  values: Record<string, unknown>;
  setAccessLevel?: () => Promise<void>;
  query?: ReturnType<typeof vi.fn>;
  sendMessage?: ReturnType<typeof vi.fn>;
}) {
  let runtimeListener: RuntimeListener | undefined;
  let permissionRemovedListener: ((changes: { origins?: string[] }) => void) | undefined;
  const get = vi.fn(async (key: string) => ({ [key]: values[key] }));
  const set = vi.fn(async (next: Record<string, unknown>) => { Object.assign(values, next); });
  const remove = vi.fn(async (key: string) => { delete values[key]; });
  const tabsGet = vi.fn(async (tabId: number) => ({ id: tabId, active: true, windowId: 1, url: "http://example.test/" }));
  const chrome = {
    runtime: {
      id: "extension-id",
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn((listener: RuntimeListener) => { runtimeListener = listener; }) },
    },
    storage: { local: { get, set, remove, setAccessLevel } },
    permissions: { contains: vi.fn().mockResolvedValue(true), onRemoved: { addListener: vi.fn((listener: (changes: { origins?: string[] }) => void) => { permissionRemovedListener = listener; }) } },
    scripting: {
      getRegisteredContentScripts: vi.fn().mockResolvedValue([]),
      unregisterContentScripts: vi.fn().mockResolvedValue(undefined),
      updateContentScripts: vi.fn().mockResolvedValue(undefined),
      registerContentScripts: vi.fn().mockResolvedValue(undefined),
    },
    tabs: {
      get: tabsGet,
      query,
      sendMessage,
      onRemoved: { addListener: vi.fn() },
      onActivated: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn() },
    },
    windows: { WINDOW_ID_NONE: -1, getLastFocused: vi.fn().mockResolvedValue({ id: 1, focused: true }), onFocusChanged: { addListener: vi.fn() } },
  };
  return { chrome, runtimeListener: () => runtimeListener, permissionRemovedListener: () => permissionRemovedListener, tabsGet, query, sendMessage };
}

function baiduReadyValues(): Record<string, unknown> {
  return {
    baiduCredentials: { appId: "local-app", secret: "local-secret", revision: "generation-1" },
    baiduManualSmokeReadiness: { credentialRevision: "generation-1", review },
    translationUsageSettings: { plan: "standard", monthlyCharacterBudget: 300 },
    translationUsageLedger: { periodKey: "2026-09", submittedCharacters: 0 },
    siteSettingsByDomain: { "example.test": { enabled: true, targetLanguage: "zh" } },
  };
}

async function startBaiduPageRequest(
  harness: ReturnType<typeof workerChrome>,
  documentId: string = "document-old",
): Promise<{ pending: Promise<unknown>; pageSender: chrome.runtime.MessageSender; session: { id: string } }> {
  const pageSender = { tab: { id: 7 }, url: "http://example.test/", documentId } as chrome.runtime.MessageSender;
  const stay = await runtimeRequest(harness.runtimeListener, { type: "page-session.settings.get" }, pageSender) as { ok: boolean; session?: { id: string } };
  if (!stay.ok || !stay.session) throw new Error("missing Baidu stay");
  await expect(runtimeRequest(harness.runtimeListener, { type: "page-session.decision", payload: { session: stay.session, decision: "accept" } }, pageSender)).resolves.toMatchObject({ ok: true, disposition: "allowed" });
  return {
    pageSender,
    session: stay.session,
    pending: runtimeRequest(harness.runtimeListener, {
      type: "translation.translate",
      session: stay.session,
      payload: { requestId: "active-request", blockId: "active-block", text: "local page source", sourceLanguage: "auto", targetLanguage: "zh" },
    }, pageSender),
  };
}

function abortableTransport() {
  let signal: AbortSignal | undefined;
  const transport = vi.fn((_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    signal = init?.signal ?? undefined;
    signal?.addEventListener("abort", () => reject(new Error("local abort detail")), { once: true });
  }));
  return { transport, signal: () => signal };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("service worker 的 Baidu 安全门", () => {
  it("延迟 bootstrap 时不创建 Fake 会话或触达 transport；就绪后首次会话绑定恢复的 Baidu runtime", async () => {
    const bootstrap = deferred();
    const values: Record<string, unknown> = {
      baiduCredentials: { appId: "local-app", secret: "local-secret", revision: "generation-1" },
      baiduManualSmokeReadiness: { credentialRevision: "generation-1", review },
      translationUsageSettings: { plan: "standard", monthlyCharacterBudget: 300 },
      translationUsageLedger: { periodKey: "2026-09", submittedCharacters: 0 },
      siteSettingsByDomain: { "example.test": { enabled: true, targetLanguage: "zh" } },
    };
    const harness = workerChrome({ values, setAccessLevel: () => bootstrap.promise });
    const transport = vi.fn();
    vi.stubGlobal("chrome", harness.chrome);
    vi.stubGlobal("fetch", transport);

    await import("../../src/background/service-worker");
    const waiting = runtimeRequest(harness.runtimeListener, { type: "page-session.settings.get" }, { tab: { id: 7 }, url: "http://example.test/" } as chrome.runtime.MessageSender);
    await Promise.resolve();
    expect(harness.tabsGet).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();

    bootstrap.resolve();
    await expect(waiting).resolves.toMatchObject({ ok: true, provider: { adapter: "baidu" }, disposition: "awaiting-decision" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("显式二次 smoke 只走一次注入 transport，前台查询失败仍返回有限成功响应", async () => {
    const values: Record<string, unknown> = {
      baiduCredentials: { appId: "local-app", secret: "local-secret", revision: "generation-1" },
      translationUsageSettings: { plan: "standard", monthlyCharacterBudget: 300 },
      translationUsageLedger: { periodKey: "2026-09", submittedCharacters: 0 },
      siteSettingsByDomain: { "example.test": { enabled: true, targetLanguage: "zh" } },
    };
    const query = vi.fn().mockRejectedValue(new Error("browser query unavailable"));
    const harness = workerChrome({ values, query });
    const transport = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ from: "en", trans_result: [{ dst: "local fixture" }] }) });
    vi.stubGlobal("chrome", harness.chrome);
    vi.stubGlobal("fetch", transport);
    await import("../../src/background/service-worker");
    const sender = { url: "chrome-extension://extension-id/options.html" } as chrome.runtime.MessageSender;
    const pageSender = { tab: { id: 7 }, url: "http://example.test/" } as chrome.runtime.MessageSender;
    const oldStay = await runtimeRequest(harness.runtimeListener, { type: "page-session.settings.get" }, pageSender) as { ok: boolean; session?: { id: string }; provider?: { adapter: string } };
    expect(oldStay).toMatchObject({ ok: true, provider: { adapter: "fake" } });
    if (!oldStay.session) throw new Error("missing old session");
    await expect(runtimeRequest(harness.runtimeListener, { type: "page-session.decision", payload: { session: oldStay.session, decision: "accept" } }, pageSender)).resolves.toMatchObject({ ok: true, disposition: "allowed" });

    const prepared = await runtimeRequest(harness.runtimeListener, { type: "baidu.manual-smoke.prepare", payload: review }, sender) as { ok: boolean; confirmationToken?: string };
    expect(prepared.ok).toBe(true);
    expect(transport).not.toHaveBeenCalled();
    if (!prepared.confirmationToken) throw new Error("missing opaque confirmation");

    await expect(runtimeRequest(harness.runtimeListener, { type: "baidu.manual-smoke.run", payload: { confirmationToken: prepared.confirmationToken } }, sender)).resolves.toMatchObject({ ok: true, provider: "baidu" });
    expect(transport).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledOnce();

    await expect(runtimeRequest(harness.runtimeListener, {
      type: "translation.translate",
      session: oldStay.session,
      payload: { requestId: "old-request", blockId: "old-block", text: "local text", sourceLanguage: "auto", targetLanguage: "zh" },
    }, pageSender)).resolves.toMatchObject({ ok: false, error: "TRANSLATION_FAILED" });
    // The one transport call above belongs to the explicit manual smoke. A
    // pre-switch stay can never be retargeted into a Baidu page translation.
    expect(transport).toHaveBeenCalledOnce();
  });

  it.each([
    {
      label: "凭据保存",
      mutate: (harness: ReturnType<typeof workerChrome>) => runtimeRequest(
        harness.runtimeListener,
        { type: "credentials.save", payload: { appId: "replacement-app", secret: "replacement-secret" } },
        { url: "chrome-extension://extension-id/options.html" } as chrome.runtime.MessageSender,
      ),
    },
    {
      label: "套餐更新",
      mutate: (harness: ReturnType<typeof workerChrome>) => runtimeRequest(
        harness.runtimeListener,
        { type: "translation-usage.update", payload: { plan: "advanced", monthlyCharacterBudget: 300 } },
        { url: "chrome-extension://extension-id/options.html" } as chrome.runtime.MessageSender,
      ),
    },
    {
      label: "供应商权限撤销",
      mutate: (harness: ReturnType<typeof workerChrome>) => {
        const removed = harness.permissionRemovedListener();
        if (!removed) throw new Error("missing permission listener");
        removed({ origins: [BAIDU_PROVIDER_ORIGIN_PATTERN] });
        return Promise.resolve();
      },
    },
  ])("%s 会同步中止百度页面在途请求，且不重试或回写结果", async ({ mutate }) => {
    const values = baiduReadyValues();
    const harness = workerChrome({ values });
    const { transport, signal } = abortableTransport();
    vi.stubGlobal("chrome", harness.chrome);
    vi.stubGlobal("fetch", transport);
    await import("../../src/background/service-worker");

    const page = await startBaiduPageRequest(harness);
    await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce());
    const activeSignal = signal();
    if (!activeSignal) throw new Error("missing adapter signal");

    await mutate(harness);
    await vi.waitFor(() => expect(activeSignal.aborted).toBe(true));
    await expect(page.pending).resolves.toMatchObject({ ok: false, error: "CANCELED" });
    await Promise.resolve();
    expect(transport).toHaveBeenCalledOnce();
  });

  it("页面兼容性故障会经 worker 暂停当前 session、清理在途请求并拒绝旧 session", async () => {
    const values = baiduReadyValues();
    const harness = workerChrome({ values });
    const { transport, signal } = abortableTransport();
    vi.stubGlobal("chrome", harness.chrome);
    vi.stubGlobal("fetch", transport);
    await import("../../src/background/service-worker");

    const page = await startBaiduPageRequest(harness);
    await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce());
    const activeSignal = signal();
    if (!activeSignal) throw new Error("missing adapter signal");

    await expect(runtimeRequest(harness.runtimeListener, {
      type: "page-session.compatibility-failure",
      payload: { session: page.session, reason: "layout-breakage" },
    }, page.pageSender)).resolves.toEqual({ ok: true });
    await vi.waitFor(() => expect(activeSignal.aborted).toBe(true));
    await expect(page.pending).resolves.toMatchObject({ ok: false, error: "CANCELED" });
    await expect(runtimeRequest(harness.runtimeListener, {
      type: "translation.translate",
      session: page.session,
      payload: { requestId: "stale-request", blockId: "stale-block", text: "local page source", sourceLanguage: "auto", targetLanguage: "zh" },
    }, page.pageSender)).resolves.toMatchObject({ ok: false, error: "TRANSLATION_FAILED" });
    expect(harness.sendMessage).toHaveBeenCalledWith(7, expect.objectContaining({ type: "page-session.pause" }));
    expect(transport).toHaveBeenCalledOnce();
  });

  it("旧 document 的兼容性故障不会暂停导航后的新 document session", async () => {
    const values = baiduReadyValues();
    const harness = workerChrome({ values });
    const { transport, signal } = abortableTransport();
    vi.stubGlobal("chrome", harness.chrome);
    vi.stubGlobal("fetch", transport);
    await import("../../src/background/service-worker");

    const page = await startBaiduPageRequest(harness, "document-old");
    await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce());
    const activeSignal = signal();
    if (!activeSignal) throw new Error("missing adapter signal");
    const newSender = { tab: { id: 7 }, url: "http://example.test/", documentId: "document-new" } as chrome.runtime.MessageSender;
    await expect(runtimeRequest(harness.runtimeListener, { type: "page-session.settings.get" }, newSender)).resolves.toMatchObject({ ok: true });

    await expect(runtimeRequest(harness.runtimeListener, {
      type: "page-session.compatibility-failure",
      payload: { session: page.session, reason: "layout-breakage" },
    }, page.pageSender)).resolves.toEqual({ ok: false, error: "STALE_SESSION" });
    expect(activeSignal.aborted).toBe(false);
    await expect(runtimeRequest(harness.runtimeListener, {
      type: "page-session.compatibility-failure",
      payload: { session: page.session, reason: "layout-breakage" },
    }, newSender)).resolves.toEqual({ ok: true });
    await vi.waitFor(() => expect(activeSignal.aborted).toBe(true));
    await expect(page.pending).resolves.toMatchObject({ ok: false, error: "CANCELED" });
  });

  it.each([
    {
      label: "凭据保存",
      mutate: (harness: ReturnType<typeof workerChrome>) => runtimeRequest(
        harness.runtimeListener,
        { type: "credentials.save", payload: { appId: "replacement-app", secret: "replacement-secret" } },
        { url: "chrome-extension://extension-id/options.html" } as chrome.runtime.MessageSender,
      ),
    },
    {
      label: "套餐更新",
      mutate: (harness: ReturnType<typeof workerChrome>) => runtimeRequest(
        harness.runtimeListener,
        { type: "translation-usage.update", payload: { plan: "advanced", monthlyCharacterBudget: 300 } },
        { url: "chrome-extension://extension-id/options.html" } as chrome.runtime.MessageSender,
      ),
    },
    {
      label: "供应商权限撤销",
      mutate: (harness: ReturnType<typeof workerChrome>) => {
        const removed = harness.permissionRemovedListener();
        if (!removed) throw new Error("missing permission listener");
        removed({ origins: [BAIDU_PROVIDER_ORIGIN_PATTERN] });
        return Promise.resolve();
      },
    },
  ])("%s 会同步中止人工 smoke 在途请求，且不会写入 readiness", async ({ mutate }) => {
    const values = baiduReadyValues();
    delete values.baiduManualSmokeReadiness;
    const harness = workerChrome({ values });
    const { transport, signal } = abortableTransport();
    vi.stubGlobal("chrome", harness.chrome);
    vi.stubGlobal("fetch", transport);
    await import("../../src/background/service-worker");
    const optionsSender = { url: "chrome-extension://extension-id/options.html" } as chrome.runtime.MessageSender;

    const prepared = await runtimeRequest(harness.runtimeListener, { type: "baidu.manual-smoke.prepare", payload: review }, optionsSender) as { ok: boolean; confirmationToken?: string };
    if (!prepared.ok || !prepared.confirmationToken) throw new Error("missing manual confirmation");
    const smoke = runtimeRequest(harness.runtimeListener, { type: "baidu.manual-smoke.run", payload: { confirmationToken: prepared.confirmationToken } }, optionsSender);
    await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce());
    const activeSignal = signal();
    if (!activeSignal) throw new Error("missing adapter signal");

    const mutation = mutate(harness);
    await vi.waitFor(() => expect(activeSignal.aborted).toBe(true));
    await expect(smoke).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/^(NETWORK_ERROR|CONFIRMATION_EXPIRED)$/u) });
    await mutation;
    expect(values.baiduManualSmokeReadiness).toBeUndefined();
    expect(transport).toHaveBeenCalledOnce();
  });

  it("非 options 扩展页的伪造凭据变更会被先拒绝，不能中止百度页面请求", async () => {
    const values = baiduReadyValues();
    const harness = workerChrome({ values });
    const { transport, signal } = abortableTransport();
    vi.stubGlobal("chrome", harness.chrome);
    vi.stubGlobal("fetch", transport);
    await import("../../src/background/service-worker");
    await startBaiduPageRequest(harness);
    await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce());
    const activeSignal = signal();
    if (!activeSignal) throw new Error("missing adapter signal");

    await expect(runtimeRequest(
      harness.runtimeListener,
      { type: "credentials.save", payload: { appId: "untrusted-app", secret: "untrusted-secret" } },
      { url: "chrome-extension://extension-id/popup.html" } as chrome.runtime.MessageSender,
    )).resolves.toEqual({ ok: false, error: "UNTRUSTED_SENDER" });
    expect(activeSignal.aborted).toBe(false);
    expect(transport).toHaveBeenCalledOnce();
  });

  it("页面请求即使被凭据变更中止，随后的人工 smoke 仍遵守同一标准版 QPS 起点", async () => {
    const values = baiduReadyValues();
    const harness = workerChrome({ values });
    const startedAt: number[] = [];
    const transport = vi.fn((_input: unknown, init?: RequestInit) => {
      startedAt.push(Date.now());
      if (startedAt.length === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("local abort detail")), { once: true });
        });
      }
      return Promise.resolve({ status: 200, json: async () => ({ from: "en", trans_result: [{ dst: "local fixture" }] }) });
    });
    vi.stubGlobal("chrome", harness.chrome);
    vi.stubGlobal("fetch", transport);
    await import("../../src/background/service-worker");

    const page = await startBaiduPageRequest(harness);
    await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce());
    const optionsSender = { url: "chrome-extension://extension-id/options.html" } as chrome.runtime.MessageSender;
    await runtimeRequest(harness.runtimeListener, { type: "credentials.save", payload: { appId: "replacement-app", secret: "replacement-secret" } }, optionsSender);
    await expect(page.pending).resolves.toMatchObject({ ok: false, error: "CANCELED" });

    const prepared = await runtimeRequest(harness.runtimeListener, { type: "baidu.manual-smoke.prepare", payload: review }, optionsSender) as { ok: boolean; confirmationToken?: string };
    if (!prepared.ok || !prepared.confirmationToken) throw new Error("missing manual confirmation");
    await expect(runtimeRequest(harness.runtimeListener, { type: "baidu.manual-smoke.run", payload: { confirmationToken: prepared.confirmationToken } }, optionsSender)).resolves.toMatchObject({ ok: true, provider: "baidu" });

    expect(transport).toHaveBeenCalledTimes(2);
    expect(startedAt[1]! - startedAt[0]!).toBeGreaterThanOrEqual(900);
  });

  it("成功的人工 smoke 启用 Baidu 后，下一页请求仍遵守同一标准版 QPS 起点", async () => {
    const values = baiduReadyValues();
    delete values.baiduManualSmokeReadiness;
    const harness = workerChrome({ values });
    const startedAt: number[] = [];
    const transport = vi.fn(() => {
      startedAt.push(Date.now());
      return Promise.resolve({ status: 200, json: async () => ({ from: "en", trans_result: [{ dst: "local fixture" }] }) });
    });
    vi.stubGlobal("chrome", harness.chrome);
    vi.stubGlobal("fetch", transport);
    await import("../../src/background/service-worker");
    const optionsSender = { url: "chrome-extension://extension-id/options.html" } as chrome.runtime.MessageSender;

    const prepared = await runtimeRequest(harness.runtimeListener, { type: "baidu.manual-smoke.prepare", payload: review }, optionsSender) as { ok: boolean; confirmationToken?: string };
    if (!prepared.ok || !prepared.confirmationToken) throw new Error("missing manual confirmation");
    await expect(runtimeRequest(harness.runtimeListener, { type: "baidu.manual-smoke.run", payload: { confirmationToken: prepared.confirmationToken } }, optionsSender)).resolves.toMatchObject({ ok: true, provider: "baidu" });

    const page = await startBaiduPageRequest(harness);
    await expect(page.pending).resolves.toMatchObject({ ok: true });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(startedAt[1]! - startedAt[0]!).toBeGreaterThanOrEqual(900);
  });
});
