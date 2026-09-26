import { describe, expect, it } from "vitest";
import { createSiteSettingsController } from "../../src/background/site-settings-controller";
import { SITE_MESSAGE_TYPES } from "../../src/shared/messages";

describe("网站设置消息处理器", () => {
  it("为新域名返回关闭且目标语言为简体中文的网站设置", async () => {
    const controller = createSiteSettingsController({
      storage: {
        async get() { return {}; },
        async set() {},
      },
    });

    await expect(
      controller.handle(
        { type: SITE_MESSAGE_TYPES.get, payload: { domain: "article.example.test" } },
        { url: "chrome-extension://extension-id/popup.html" },
        "extension-id",
      ),
    ).resolves.toEqual({ ok: true, settings: { enabled: false, targetLanguage: "zh" } });
  });

  it("按域名独立保存开关，并保留新域名的默认目标语言", async () => {
    const saved: Record<string, unknown> = {};
    const controller = createSiteSettingsController({
      storage: {
        async get(key) { return { [key]: saved[key] }; },
        async set(values) { Object.assign(saved, values); },
      },
    });
    const popup = { url: "chrome-extension://extension-id/popup.html" };

    await controller.handle(
      { type: SITE_MESSAGE_TYPES.setEnabled, payload: { domain: "first.example.test", enabled: true } },
      popup,
      "extension-id",
    );

    await expect(
      controller.handle(
        { type: SITE_MESSAGE_TYPES.get, payload: { domain: "first.example.test" } },
        popup,
        "extension-id",
      ),
    ).resolves.toEqual({ ok: true, settings: { enabled: true, targetLanguage: "zh" } });
    await expect(
      controller.handle(
        { type: SITE_MESSAGE_TYPES.get, payload: { domain: "second.example.test" } },
        popup,
        "extension-id",
      ),
    ).resolves.toEqual({ ok: true, settings: { enabled: false, targetLanguage: "zh" } });
  });

  it("第一个网站切换为日语后，第二个网站仍使用简体中文默认值", async () => {
    const saved: Record<string, unknown> = {};
    const controller = createSiteSettingsController({
      storage: {
        async get(key) { return { [key]: saved[key] }; },
        async set(values) { Object.assign(saved, values); },
      },
    });
    const popup = { url: "chrome-extension://extension-id/popup.html" };

    await controller.handle(
      { type: SITE_MESSAGE_TYPES.setTargetLanguage, payload: { domain: "first.example.test", targetLanguage: "jp" } },
      popup,
      "extension-id",
    );

    await expect(controller.handle(
      { type: SITE_MESSAGE_TYPES.get, payload: { domain: "first.example.test" } }, popup, "extension-id",
    )).resolves.toEqual({ ok: true, settings: { enabled: false, targetLanguage: "jp" } });
    await expect(controller.handle(
      { type: SITE_MESSAGE_TYPES.get, payload: { domain: "second.example.test" } }, popup, "extension-id",
    )).resolves.toEqual({ ok: true, settings: { enabled: false, targetLanguage: "zh" } });
  });

  it("拒绝内容脚本和无效域名，且不暴露或写入网站设置", async () => {
    const controller = createSiteSettingsController({
      storage: {
        async get() { return {}; },
        async set() { throw new Error("不应写入"); },
      },
    });

    await expect(
      controller.handle(
        { type: SITE_MESSAGE_TYPES.setEnabled, payload: { domain: "article.example.test", enabled: true } },
        { tab: { id: 1 }, url: "https://article.example.test" },
        "extension-id",
      ),
    ).resolves.toEqual({ ok: false, error: "UNTRUSTED_SENDER" });
    await expect(
      controller.handle(
        { type: SITE_MESSAGE_TYPES.get, payload: { domain: "not a domain", } },
        { url: "chrome-extension://extension-id/popup.html" },
        "extension-id",
      ),
    ).resolves.toEqual({ ok: false, error: "INVALID_DOMAIN" });
  });

  it("Chrome 撤销网站权限后关闭对应网站开关，但不影响其他域名", async () => {
    const saved: Record<string, unknown> = {
      siteSettingsByDomain: {
        "first.example.test": { enabled: true, targetLanguage: "zh" },
        "second.example.test": { enabled: true, targetLanguage: "zh" },
      },
    };
    const controller = createSiteSettingsController({
      storage: {
        async get(key) { return { [key]: saved[key] }; },
        async set(values) { Object.assign(saved, values); },
      },
    });

    await controller.disableDomains(["https://first.example.test/*"]);

    expect(saved.siteSettingsByDomain).toEqual({
      "first.example.test": { enabled: false, targetLanguage: "zh" },
      "second.example.test": { enabled: true, targetLanguage: "zh" },
    });
  });
});
