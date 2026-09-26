import { beforeEach, describe, expect, it, vi } from "vitest";
import { chromeSiteToggleClient } from "../../src/shared/site-toggle-client";

const query = vi.fn();
const contains = vi.fn();
const request = vi.fn();
const sendMessage = vi.fn();
const executeScript = vi.fn();
const registerContentScripts = vi.fn();
const unregisterContentScripts = vi.fn();
const getRegisteredContentScripts = vi.fn();
const updateContentScripts = vi.fn();
const sendToTab = vi.fn();
const getAllFrames = vi.fn();

beforeEach(() => {
  query.mockReset();
  contains.mockReset();
  request.mockReset();
  sendMessage.mockReset();
  executeScript.mockReset();
  registerContentScripts.mockReset();
  unregisterContentScripts.mockReset();
  getRegisteredContentScripts.mockReset();
  updateContentScripts.mockReset();
  sendToTab.mockReset();
  getAllFrames.mockReset();
  vi.stubGlobal("chrome", {
    tabs: { query, sendMessage: sendToTab },
    permissions: { contains, request },
    runtime: { sendMessage },
    scripting: { executeScript, registerContentScripts, unregisterContentScripts, getRegisteredContentScripts, updateContentScripts },
    webNavigation: { getAllFrames },
  });
  query.mockResolvedValue([{ id: 7, url: "https://article.example.test/" }]);
  getRegisteredContentScripts.mockResolvedValue([]);
  getAllFrames.mockResolvedValue([]);
});

describe("当前网站授权端口", () => {
  it("拒绝 optional host permission 后不写设置、不注入也不发送页面会话消息", async () => {
    request.mockResolvedValue(false);

    await expect(chromeSiteToggleClient.enable()).resolves.toEqual({ ok: false, error: "PERMISSION_DENIED" });

    expect(request).toHaveBeenCalledWith({ origins: ["https://article.example.test/*"] });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(executeScript).not.toHaveBeenCalled();
    expect(sendToTab).not.toHaveBeenCalled();
  });

  it("Chrome 无法显示权限提示时同样安全地保持未授权", async () => {
    request.mockRejectedValue(new Error("权限提示不可用"));

    await expect(chromeSiteToggleClient.enable()).resolves.toEqual({ ok: false, error: "PERMISSION_DENIED" });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("读取既有内容脚本注册失败时返回可呈现的注入失败，且不写设置或注入", async () => {
    contains.mockResolvedValue(true);
    getRegisteredContentScripts.mockRejectedValue(new Error("读取注册失败"));

    await expect(chromeSiteToggleClient.enable()).resolves.toEqual({ ok: false, error: "INJECTION_FAILURE" });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("popup 已确认的网站在扩展页获得焦点后仍对同一网站执行开启", async () => {
    contains.mockResolvedValue(true);
    sendMessage.mockResolvedValue({ ok: true, settings: { enabled: true, targetLanguage: "zh" } });
    executeScript.mockResolvedValue(undefined);
    registerContentScripts.mockResolvedValue(undefined);

    await chromeSiteToggleClient.status();
    query.mockResolvedValue([{ id: 8, url: "chrome-extension://extension-id/popup.html" }]);

    await expect(chromeSiteToggleClient.enable()).resolves.toMatchObject({ ok: true, status: { domain: "article.example.test" } });
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 7, allFrames: true }, files: ["content-script.js"] });
  });

  it("已授权且开启后仅注入本扩展内容脚本", async () => {
    request.mockResolvedValue(true);
    sendMessage.mockResolvedValue({ ok: true, settings: { enabled: true, targetLanguage: "zh" } });
    executeScript.mockResolvedValue(undefined);
    registerContentScripts.mockResolvedValue(undefined);
    getRegisteredContentScripts.mockResolvedValue([]);
    contains.mockResolvedValueOnce(false).mockResolvedValue(true);

    await expect(chromeSiteToggleClient.enable()).resolves.toEqual({
      ok: true,
      status: { kind: "authorized", domain: "article.example.test", settings: { enabled: true, targetLanguage: "zh" } },
    });

    expect(sendMessage).toHaveBeenCalledWith({
      type: "site-settings.set-enabled",
      payload: { domain: "article.example.test", enabled: true },
    });
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 7, allFrames: true }, files: ["content-script.js"] });
    expect(registerContentScripts).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ allFrames: true, persistAcrossSessions: true })]));
  });

  it("一个不可访问的 child frame 使 allFrames 注入失败时，只对当前已枚举 frame 分别尝试并保持顶层网站开启", async () => {
    request.mockResolvedValue(true);
    sendMessage.mockResolvedValue({ ok: true, settings: { enabled: true, targetLanguage: "zh" } });
    registerContentScripts.mockResolvedValue(undefined);
    executeScript
      .mockRejectedValueOnce(new Error("child frame 未获权限"))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    contains.mockImplementation(({ origins }: { origins: string[] }) => Promise.resolve(origins[0] !== "https://denied.example.test/*"));
    getAllFrames.mockResolvedValue([
      { frameId: 0, url: "https://article.example.test/" },
      { frameId: 1, url: "https://permitted.example.test/embedded" },
      { frameId: 2, url: "https://denied.example.test/embedded" },
    ]);

    const result = await chromeSiteToggleClient.enable();
    expect(result).toMatchObject({ ok: true, status: { domain: "article.example.test" } });
    expect(result).not.toHaveProperty("frames");

    expect(executeScript).toHaveBeenNthCalledWith(1, { target: { tabId: 7, allFrames: true }, files: ["content-script.js"] });
    expect(executeScript).toHaveBeenNthCalledWith(2, { target: { tabId: 7 }, files: ["content-script.js"] });
    expect(executeScript).toHaveBeenNthCalledWith(3, { target: { tabId: 7, frameIds: [1] }, files: ["content-script.js"] });
    expect(executeScript).toHaveBeenCalledTimes(3);
  });

  it("单个已授权 child frame 在注入时失败不会回滚已开启的顶层网站", async () => {
    request.mockResolvedValue(true);
    sendMessage.mockResolvedValue({ ok: true, settings: { enabled: true, targetLanguage: "zh" } });
    registerContentScripts.mockResolvedValue(undefined);
    executeScript
      .mockRejectedValueOnce(new Error("allFrames 不可原子执行"))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("child 在注入前卸载"));
    contains.mockResolvedValue(true);
    getAllFrames.mockResolvedValue([
      { frameId: 0, url: "https://article.example.test/" },
      { frameId: 3, url: "https://permitted.example.test/embedded" },
    ]);

    await expect(chromeSiteToggleClient.enable()).resolves.toMatchObject({ ok: true, status: { domain: "article.example.test" } });

    expect(executeScript).toHaveBeenNthCalledWith(3, { target: { tabId: 7, frameIds: [3] }, files: ["content-script.js"] });
    expect(sendMessage).not.toHaveBeenCalledWith({
      type: "site-settings.set-enabled",
      payload: { domain: "article.example.test", enabled: false },
    });
  });

  it("allFrames 只返回顶层结果时只补注入遗漏的已授权 child frame，不重复执行已有 frame", async () => {
    request.mockResolvedValue(true);
    sendMessage.mockResolvedValue({ ok: true, settings: { enabled: true, targetLanguage: "zh" } });
    registerContentScripts.mockResolvedValue(undefined);
    executeScript
      .mockResolvedValueOnce([{ frameId: 0, documentId: "top-document" }])
      .mockResolvedValueOnce([{ frameId: 4, documentId: "child-document" }]);
    contains.mockResolvedValue(true);
    getAllFrames.mockResolvedValue([
      { frameId: 0, url: "https://article.example.test/" },
      { frameId: 4, url: "https://permitted.example.test/embedded" },
    ]);

    await expect(chromeSiteToggleClient.enable()).resolves.toMatchObject({ ok: true, status: { domain: "article.example.test" } });

    expect(executeScript).toHaveBeenNthCalledWith(1, { target: { tabId: 7, allFrames: true }, files: ["content-script.js"] });
    expect(executeScript).toHaveBeenNthCalledWith(2, { target: { tabId: 7, frameIds: [4] }, files: ["content-script.js"] });
    expect(executeScript).toHaveBeenCalledTimes(2);
  });

  it("allFrames 已报告 child frame 时不对该 frame 重复执行内容脚本", async () => {
    request.mockResolvedValue(true);
    sendMessage.mockResolvedValue({ ok: true, settings: { enabled: true, targetLanguage: "zh" } });
    registerContentScripts.mockResolvedValue(undefined);
    executeScript.mockResolvedValueOnce([
      { frameId: 0, documentId: "top-document" },
      { frameId: 5, documentId: "permitted-child-document" },
    ]);
    contains.mockResolvedValue(true);
    getAllFrames.mockResolvedValue([
      { frameId: 0, url: "https://article.example.test/" },
      { frameId: 5, url: "https://permitted.example.test/embedded" },
    ]);

    await expect(chromeSiteToggleClient.enable()).resolves.toMatchObject({ ok: true, status: { domain: "article.example.test" } });

    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 7, allFrames: true }, files: ["content-script.js"] });
  });

  it("同一域名已有 HTTPS 注册时合并 HTTP 权限而不重复注册或注销", async () => {
    contains.mockResolvedValue(true);
    getRegisteredContentScripts.mockResolvedValue([{ id: "site-61-72-74-69-63-6c-65-2e-65-78-61-6d-70-6c-65-2e-74-65-73-74" }]);
    updateContentScripts.mockResolvedValue(undefined);
    executeScript.mockResolvedValue(undefined);
    sendMessage.mockResolvedValue({ ok: true, settings: { enabled: true, targetLanguage: "zh" } });

    await expect(chromeSiteToggleClient.enable()).resolves.toMatchObject({ ok: true });

    expect(updateContentScripts).toHaveBeenCalledWith([expect.objectContaining({ matches: ["http://article.example.test/*", "https://article.example.test/*"] })]);
    expect(registerContentScripts).not.toHaveBeenCalled();
    expect(unregisterContentScripts).not.toHaveBeenCalled();
  });

  it("保存开启失败时不注入当前页，并注销未来注册", async () => {
    contains.mockResolvedValueOnce(false).mockResolvedValue(true);
    request.mockResolvedValue(true);
    getRegisteredContentScripts.mockResolvedValue([]);
    registerContentScripts.mockResolvedValue(undefined);
    executeScript.mockResolvedValue(undefined);
    unregisterContentScripts.mockResolvedValue(undefined);
    sendToTab.mockResolvedValue(undefined);
    sendMessage.mockResolvedValue({ ok: false, error: "STORAGE_FAILURE" });

    await expect(chromeSiteToggleClient.enable()).resolves.toEqual({ ok: false, error: "SITE_SETTINGS_FAILURE" });

    expect(unregisterContentScripts).toHaveBeenCalled();
    expect(executeScript).not.toHaveBeenCalled();
    expect(sendToTab).not.toHaveBeenCalled();
  });

  it("已有注册但保存开启失败时恢复原注册，而不把旧匹配规则遗留为新规则", async () => {
    const previous = {
      id: "site-61-72-74-69-63-6c-65-2e-65-78-61-6d-70-6c-65-2e-74-65-73-74",
      js: ["content-script.js"],
      matches: ["https://article.example.test/*"],
      runAt: "document_end" as const,
      persistAcrossSessions: true,
    };
    contains.mockResolvedValue(true);
    getRegisteredContentScripts.mockResolvedValue([previous]);
    updateContentScripts.mockResolvedValue(undefined);
    sendMessage.mockResolvedValue({ ok: false, error: "STORAGE_FAILURE" });

    await expect(chromeSiteToggleClient.enable()).resolves.toEqual({ ok: false, error: "SITE_SETTINGS_FAILURE" });

    expect(updateContentScripts).toHaveBeenNthCalledWith(1, [expect.objectContaining({ matches: ["http://article.example.test/*", "https://article.example.test/*"] })]);
    expect(updateContentScripts).toHaveBeenNthCalledWith(2, [previous]);
    expect(unregisterContentScripts).not.toHaveBeenCalled();
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("注册失败但设置已开启时回滚网站开关，且不注入当前页", async () => {
    contains.mockResolvedValue(true);
    getRegisteredContentScripts.mockResolvedValue([]);
    registerContentScripts.mockRejectedValue(new Error("注册失败"));
    sendMessage
      .mockResolvedValueOnce({ ok: true, settings: { enabled: true, targetLanguage: "zh" } })
      .mockResolvedValueOnce({ ok: true, settings: { enabled: false, targetLanguage: "zh" } });

    await expect(chromeSiteToggleClient.enable()).resolves.toEqual({ ok: false, error: "INJECTION_FAILURE" });

    expect(sendMessage).toHaveBeenCalledWith({ type: "site-settings.set-enabled", payload: { domain: "article.example.test", enabled: false } });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("Chrome 外部撤销权限时优先呈现未授权状态且不读取旧网站设置", async () => {
    contains.mockResolvedValue(false);

    await expect(chromeSiteToggleClient.status()).resolves.toEqual({ kind: "not-authorized", domain: "article.example.test" });

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("关闭网站翻译会保存关闭状态并通知当前页面停止会话", async () => {
    sendMessage.mockResolvedValue({ ok: true, settings: { enabled: false, targetLanguage: "zh" } });
    sendToTab.mockResolvedValue(undefined);
    unregisterContentScripts.mockResolvedValue(undefined);

    await expect(chromeSiteToggleClient.disable()).resolves.toEqual({
      ok: true,
      status: { kind: "authorized", domain: "article.example.test", settings: { enabled: false, targetLanguage: "zh" } },
    });

    expect(sendToTab).toHaveBeenCalledWith(7, {
      type: "page-session.stop",
      payload: { reason: "site-disabled", scope: { kind: "current-document" } },
    });
  });

  it("仅把当前标签页的网站目标语言变更持久化并通知其页面会话", async () => {
    contains.mockResolvedValue(true);
    sendMessage.mockResolvedValue({ ok: true, settings: { enabled: true, targetLanguage: "jp" } });
    sendToTab.mockResolvedValue(undefined);

    await expect(chromeSiteToggleClient.setTargetLanguage("jp")).resolves.toEqual({
      ok: true,
      status: { kind: "authorized", domain: "article.example.test", settings: { enabled: true, targetLanguage: "jp" } },
    });

    expect(sendMessage).toHaveBeenCalledWith({
      type: "site-settings.set-target-language",
      payload: { domain: "article.example.test", targetLanguage: "jp" },
    });
    expect(sendToTab).toHaveBeenCalledWith(7, {
      type: "page-session.target-language-changed",
      payload: { targetLanguage: "jp", scope: { kind: "current-document" } },
    });
  });

  it("关闭的网站仍保存目标语言，但不重启已停止的当前页面会话", async () => {
    contains.mockResolvedValue(true);
    sendMessage.mockResolvedValue({ ok: true, settings: { enabled: false, targetLanguage: "jp" } });

    await expect(chromeSiteToggleClient.setTargetLanguage("jp")).resolves.toEqual({
      ok: true,
      status: { kind: "authorized", domain: "article.example.test", settings: { enabled: false, targetLanguage: "jp" } },
    });

    expect(sendToTab).not.toHaveBeenCalled();
  });

  it("注销失败时不写关闭设置也不停止当前页面", async () => {
    unregisterContentScripts.mockRejectedValue(new Error("注销失败"));
    getRegisteredContentScripts.mockResolvedValue([{ id: "site-61-72-74-69-63-6c-65-2e-65-78-61-6d-70-6c-65-2e-74-65-73-74", js: ["content-script.js"], matches: ["https://article.example.test/*"] }]);

    await expect(chromeSiteToggleClient.disable()).resolves.toEqual({ ok: false, error: "INJECTION_FAILURE" });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(sendToTab).not.toHaveBeenCalled();
  });

  it("关闭存储失败时恢复旧注册且不停止当前页面", async () => {
    const previous = { id: "site-61-72-74-69-63-6c-65-2e-65-78-61-6d-70-6c-65-2e-74-65-73-74", js: ["content-script.js"], matches: ["https://article.example.test/*"] };
    getRegisteredContentScripts.mockResolvedValue([previous]);
    unregisterContentScripts.mockResolvedValue(undefined);
    registerContentScripts.mockResolvedValue(undefined);
    sendMessage.mockResolvedValue({ ok: false, error: "STORAGE_FAILURE" });

    await expect(chromeSiteToggleClient.disable()).resolves.toEqual({ ok: false, error: "SITE_SETTINGS_FAILURE" });

    expect(registerContentScripts).toHaveBeenCalledWith([previous]);
    expect(sendToTab).not.toHaveBeenCalled();
  });

  it("旧注册恢复失败但关闭重试成功时停止当前页面并报告关闭", async () => {
    const previous = { id: "site-61-72-74-69-63-6c-65-2e-65-78-61-6d-70-6c-65-2e-74-65-73-74", js: ["content-script.js"], matches: ["https://article.example.test/*"] };
    getRegisteredContentScripts.mockResolvedValue([previous]);
    unregisterContentScripts.mockResolvedValue(undefined);
    registerContentScripts.mockRejectedValue(new Error("恢复失败"));
    sendMessage.mockResolvedValueOnce({ ok: false, error: "STORAGE_FAILURE" }).mockResolvedValueOnce({ ok: true, settings: { enabled: false, targetLanguage: "zh" } });
    sendToTab.mockResolvedValue(undefined);

    await expect(chromeSiteToggleClient.disable()).resolves.toMatchObject({ ok: true, status: { settings: { enabled: false } } });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendToTab).toHaveBeenCalledOnce();
  });

  it("旧注册恢复与关闭重试都失败时不停止也不抛出", async () => {
    const previous = { id: "site-61-72-74-69-63-6c-65-2e-65-78-61-6d-70-6c-65-2e-74-65-73-74", js: ["content-script.js"], matches: ["https://article.example.test/*"] };
    getRegisteredContentScripts.mockResolvedValue([previous]);
    unregisterContentScripts.mockResolvedValue(undefined);
    registerContentScripts.mockRejectedValue(new Error("恢复失败"));
    sendMessage.mockResolvedValue({ ok: false, error: "STORAGE_FAILURE" });

    await expect(chromeSiteToggleClient.disable()).resolves.toEqual({ ok: false, error: "SITE_SETTINGS_FAILURE" });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendToTab).not.toHaveBeenCalled();
  });
});
