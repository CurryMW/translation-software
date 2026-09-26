import { describe, expect, it, vi } from "vitest";
import { createCompatibilityPauseController } from "../../src/background/compatibility-pause-controller";

describe("兼容性暂停存储行为接缝", () => {
  it("持久保存高风险域名暂停，规范化域名并拒绝其他网站绕过", async () => {
    const data: Record<string, unknown> = {};
    const controller = createCompatibilityPauseController({
      storage: {
        async get(key) { return { [key]: data[key] }; },
        async set(values) { Object.assign(data, values); },
      },
      now: () => 123,
    });

    await controller.pause("Risk.Example.test", "page-breakage");

    expect(data.compatibilityPausesByDomain).toEqual({
      "risk.example.test": { domain: "risk.example.test", reason: "page-breakage", pausedAt: 123 },
    });
    await expect(controller.isPaused("RISK.EXAMPLE.TEST")).resolves.toBe(true);
    await expect(controller.isPaused("safe.example.test")).resolves.toBe(false);
    await expect(controller.list()).resolves.toEqual([
      { domain: "risk.example.test", reason: "page-breakage", pausedAt: 123 },
    ]);
  });

  it("清除暂停是维护者操作，普通检查没有强制绕过入口", async () => {
    const data: Record<string, unknown> = {
      compatibilityPausesByDomain: {
        "risk.example.test": { domain: "risk.example.test", reason: "privacy", pausedAt: 1 },
      },
    };
    const controller = createCompatibilityPauseController({
      storage: {
        async get(key) { return { [key]: data[key] }; },
        async set(values) { Object.assign(data, values); },
      },
    });

    expect(controller).not.toHaveProperty("forceEnable");
    await controller.clear("risk.example.test");
    await expect(controller.isPaused("risk.example.test")).resolves.toBe(false);
  });

  it("损坏存储和无效域名 fail closed，且不污染其他域名", async () => {
    const set = vi.fn();
    const controller = createCompatibilityPauseController({
      storage: {
        async get() { return { compatibilityPausesByDomain: { "bad domain": { reason: "privacy" }, "safe.example.test": { domain: "safe.example.test", reason: "cost", pausedAt: 5 } } }; },
        async set(values) { set(values); },
      },
    });

    await expect(controller.isPaused("bad domain")).resolves.toBe(false);
    await expect(controller.isPaused("safe.example.test")).resolves.toBe(true);
    await controller.pause("other.example.test", "privacy");
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ compatibilityPausesByDomain: expect.objectContaining({ "safe.example.test": expect.anything(), "other.example.test": expect.anything() }) }));
  });

  it("读取持久暂停失败时保持阻断，避免把已知高风险站点误放行", async () => {
    const controller = createCompatibilityPauseController({
      storage: {
        async get() { throw new Error("storage unavailable"); },
        async set() {},
      },
      managedDomains: ["risk.example.test"],
    });

    await expect(controller.isPaused("risk.example.test")).resolves.toBe(true);
    // A cold storage read cannot establish that a domain is safe, so the
    // gate fails closed until the first successful snapshot.
    await expect(controller.isPaused("safe.example.test")).resolves.toBe(true);
  });

  it("受管注册表可以在生产启动时进入或退出暂停，普通用户没有强制绕过入口", async () => {
    const data: Record<string, unknown> = {};
    const controller = createCompatibilityPauseController({
      storage: {
        async get(key) { return { [key]: data[key] }; },
        async set(values) { Object.assign(data, values); },
      },
      managedDomains: ["managed.example.test"],
    });

    await controller.reconcileManaged([{"domain": "managed.example.test", enabled: true, pause: "privacy"}]);
    await expect(controller.isPaused("managed.example.test")).resolves.toBe(true);
    await controller.reconcileManaged([{"domain": "managed.example.test", enabled: true}]);
    await expect(controller.isPaused("managed.example.test")).resolves.toBe(false);
    expect(controller).not.toHaveProperty("forceEnable");
  });

  it("手工维护只写入手工暂停键，不复制或删除受管暂停", async () => {
    const data: Record<string, unknown> = {};
    const controller = createCompatibilityPauseController({
      storage: {
        async get(key) { return { [key]: data[key] }; },
        async set(values) { Object.assign(data, values); },
      },
    });

    await controller.reconcileManaged([{ domain: "managed.example.test", enabled: true, pause: "privacy" }]);
    await controller.pause("manual.example.test", "cost");
    expect(data.compatibilityPausesByDomain).toEqual({
      "manual.example.test": { domain: "manual.example.test", reason: "cost", pausedAt: expect.any(Number) },
    });
    expect(data.managedCompatibilityPausesByDomain).toEqual({
      "managed.example.test": { domain: "managed.example.test", reason: "privacy", pausedAt: expect.any(Number) },
    });
    await controller.clear("managed.example.test");
    await expect(controller.isPaused("managed.example.test")).resolves.toBe(true);
  });

  it("运行时非法受管 pause reason 仍按隐私风险 fail closed", async () => {
    const data: Record<string, unknown> = {};
    const controller = createCompatibilityPauseController({
      storage: {
        async get(key) { return { [key]: data[key] }; },
        async set(values) { Object.assign(data, values); },
      },
    });
    await controller.reconcileManaged([{ domain: "managed.example.test", enabled: true, pause: "unexpected" as never }]);
    await expect(controller.isPaused("managed.example.test")).resolves.toBe(true);
    expect(data.managedCompatibilityPausesByDomain).toMatchObject({ "managed.example.test": { reason: "privacy" } });
  });

  it.each([
    ["disabled", { domain: "managed.example.test", enabled: false, pause: "privacy" as const }],
    ["without pause", { domain: "managed.example.test", enabled: true }],
  ])("受管记录变为 %s 后，冷存储失败不阻断该域名", async (_label, record) => {
    let unavailable = false;
    const controller = createCompatibilityPauseController({
      storage: {
        async get(key) {
          if (unavailable) throw new Error("storage unavailable");
          return { [key]: undefined };
        },
        async set() {},
      },
      managedDomains: ["managed.example.test"],
    });

    await controller.reconcileManaged([{ domain: "managed.example.test", enabled: true, pause: "privacy" }]);
    await controller.reconcileManaged([record]);
    unavailable = true;
    await expect(controller.isPaused("managed.example.test")).resolves.toBe(false);
  });

  it("持久存储暂时失败时保留最近成功快照，手工 pause/clear 拒绝写入而不覆盖既有暂停", async () => {
    const set = vi.fn();
    let unavailable = false;
    const data: Record<string, unknown> = {
      compatibilityPausesByDomain: {
        "paused.example.test": { domain: "paused.example.test", reason: "privacy", pausedAt: 1 },
      },
      managedCompatibilityPausesByDomain: {},
    };
    const controller = createCompatibilityPauseController({
      storage: {
        async get(key) { if (unavailable) throw new Error("temporary failure"); return { [key]: data[key] }; },
        async set(values) { set(values); Object.assign(data, values); },
      },
    });

    await expect(controller.isPaused("paused.example.test")).resolves.toBe(true);
    unavailable = true;
    await expect(controller.pause("new.example.test", "cost")).resolves.toBeUndefined();
    await expect(controller.clear("paused.example.test")).resolves.toBeUndefined();
    await expect(controller.isPaused("paused.example.test")).resolves.toBe(true);
    expect(set).not.toHaveBeenCalled();
    await expect(controller.isPaused("safe.example.test")).resolves.toBe(false);
  });
});
