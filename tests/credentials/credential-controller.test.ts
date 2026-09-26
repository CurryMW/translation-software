import { describe, expect, it } from "vitest";
import { createCredentialController } from "../../src/background/credential-controller";
import { CREDENTIAL_MESSAGE_TYPES } from "../../src/shared/messages";

describe("凭据消息处理器", () => {
  it("只向可信扩展页面保存凭据，并且状态不包含凭据", async () => {
    const saved: Record<string, unknown> = {};
    const controller = createCredentialController({
      storage: {
        async get(key) {
          return { [key]: saved[key] };
        },
        async set(values) {
          Object.assign(saved, values);
        },
        async remove(key) {
          delete saved[key];
        },
      },
    });

    const result = await controller.handle(
      { type: CREDENTIAL_MESSAGE_TYPES.save, payload: { appId: "test-app", secret: "x" } },
      { id: "extension-id", url: "chrome-extension://extension-id/options.html" },
      "extension-id",
    );

    expect(result).toEqual({ ok: true, status: { configured: true } });
    await expect(
      controller.handle(
        { type: CREDENTIAL_MESSAGE_TYPES.status },
        { id: "extension-id", url: "chrome-extension://extension-id/popup.html" },
        "extension-id",
      ),
    ).resolves.toEqual({ configured: true });
    expect(JSON.stringify(result)).not.toContain("x");
  });

  it("拒绝内容脚本来源的凭据读取和修改", async () => {
    const controller = createCredentialController({
      storage: {
        async get() {
          return { baiduCredentials: { appId: "test-app", secret: "x" } };
        },
        async set() {},
        async remove() {},
      },
    });
    const contentScriptSender = { id: "extension-id", tab: { id: 7 }, url: "https://example.test" };

    await expect(
      controller.handle(
        { type: CREDENTIAL_MESSAGE_TYPES.status },
        contentScriptSender,
        "extension-id",
      ),
    ).resolves.toEqual({ configured: false });
    await expect(
      controller.handle(
        { type: CREDENTIAL_MESSAGE_TYPES.clear },
        contentScriptSender,
        "extension-id",
      ),
    ).resolves.toEqual({ ok: false, error: "UNTRUSTED_SENDER" });
  });

  it("仅 options 设置页可写入或清除；其他扩展页只能读取脱敏配置状态", async () => {
    const saved: Record<string, unknown> = {};
    const controller = createCredentialController({
      storage: {
        async get(key) { return { [key]: saved[key] }; },
        async set(values) { Object.assign(saved, values); },
        async remove(key) { delete saved[key]; },
      },
    });
    const popup = { url: "chrome-extension://extension-id/popup.html" };

    await expect(controller.handle({ type: CREDENTIAL_MESSAGE_TYPES.save, payload: { appId: "local-app", secret: "local-secret" } }, popup, "extension-id"))
      .resolves.toEqual({ ok: false, error: "UNTRUSTED_SENDER" });
    await expect(controller.handle({ type: CREDENTIAL_MESSAGE_TYPES.clear }, popup, "extension-id"))
      .resolves.toEqual({ ok: false, error: "UNTRUSTED_SENDER" });
    await expect(controller.handle({ type: CREDENTIAL_MESSAGE_TYPES.status }, popup, "extension-id"))
      .resolves.toEqual({ configured: false });
    expect(saved).toEqual({});
  });

  it("可信设置页可替换并清除凭据，状态始终不包含密钥", async () => {
    const saved: Record<string, unknown> = {};
    const controller = createCredentialController({
      storage: {
        async get(key) { return { [key]: saved[key] }; },
        async set(values) { Object.assign(saved, values); },
        async remove(key) { delete saved[key]; },
      },
    });
    const settingsPage = { id: "extension-id", url: "chrome-extension://extension-id/options.html" };

    await controller.handle(
      { type: CREDENTIAL_MESSAGE_TYPES.save, payload: { appId: "first-app", secret: "x" } },
      settingsPage,
      "extension-id",
    );
    await controller.handle(
      { type: CREDENTIAL_MESSAGE_TYPES.save, payload: { appId: "second-app", secret: "y" } },
      settingsPage,
      "extension-id",
    );
    const cleared = await controller.handle({ type: CREDENTIAL_MESSAGE_TYPES.clear }, settingsPage, "extension-id");

    expect(cleared).toEqual({ ok: true, status: { configured: false } });
    expect(JSON.stringify(cleared)).not.toContain("y");
    expect(saved).toEqual({});
  });

  it("接受 Chrome 未提供 sender id 的同扩展设置页", async () => {
    const controller = createCredentialController({
      storage: {
        async get() { return {}; },
        async set() {},
        async remove() {},
      },
    });

    await expect(
      controller.handle(
        { type: CREDENTIAL_MESSAGE_TYPES.save, payload: { appId: "test-app", secret: "x" } },
        { url: "chrome-extension://extension-id/options.html" },
        "extension-id",
      ),
    ).resolves.toEqual({ ok: true, status: { configured: true } });
  });

  it("接受 Chrome 将扩展页 sender tab 表示为 null 的情况", async () => {
    const controller = createCredentialController({
      storage: {
        async get() { return {}; },
        async set() {},
        async remove() {},
      },
    });

    await expect(
      controller.handle(
        { type: CREDENTIAL_MESSAGE_TYPES.save, payload: { appId: "test-app", secret: "x" } },
        { tab: null, url: "chrome-extension://extension-id/options.html" },
        "extension-id",
      ),
    ).resolves.toEqual({ ok: true, status: { configured: true } });
  });

  it("接受 Chrome 为扩展设置页附带浏览器 tab 的情况", async () => {
    const controller = createCredentialController({
      storage: {
        async get() { return {}; },
        async set() {},
        async remove() {},
      },
    });

    await expect(
      controller.handle(
        { type: CREDENTIAL_MESSAGE_TYPES.save, payload: { appId: "test-app", secret: "x" } },
        { tab: { id: 7 }, url: "chrome-extension://extension-id/options.html" },
        "extension-id",
      ),
    ).resolves.toEqual({ ok: true, status: { configured: true } });
  });

  it("仅由 worker 读取的凭据带不可复用的修订号，替换后令旧人工确认失效", async () => {
    const saved: Record<string, unknown> = {};
    const controller = createCredentialController({
      storage: {
        async get(key) { return { [key]: saved[key] }; },
        async set(values) { Object.assign(saved, values); },
        async remove(key) { delete saved[key]; },
      },
    });
    const settingsPage = { url: "chrome-extension://extension-id/options.html" };

    await controller.handle({ type: CREDENTIAL_MESSAGE_TYPES.save, payload: { appId: "local-app", secret: "first" } }, settingsPage, "extension-id");
    const first = await controller.readForServiceWorker();
    expect(first).toMatchObject({ appId: "local-app", revision: expect.any(String) });
    await controller.handle({ type: CREDENTIAL_MESSAGE_TYPES.save, payload: { appId: "local-app", secret: "second" } }, settingsPage, "extension-id");
    const second = await controller.readForServiceWorker();
    expect(second).toMatchObject({ appId: "local-app", revision: expect.any(String) });
    expect(second?.revision).not.toBe(first?.revision);
  });
});
