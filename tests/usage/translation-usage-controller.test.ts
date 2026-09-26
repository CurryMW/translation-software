import { describe, expect, it } from "vitest";
import { createTranslationUsageController } from "../../src/background/translation-usage-controller";

function memoryStorage(initial: Record<string, unknown> = {}) {
  const values = { ...initial };
  return {
    get: async (key: string) => ({ [key]: values[key] }),
    set: async (next: Record<string, unknown>) => { Object.assign(values, next); },
    values,
  };
}

describe("本地月度字符预算", () => {
  it("默认标准套餐；在新月读取时清零已提交字符", async () => {
    const storage = memoryStorage({ translationUsageLedger: { periodKey: "2026-08", submittedCharacters: 17 } });
    const controller = createTranslationUsageController({ storage, now: () => new Date("2026-09-10T00:00:00.000Z") });

    await expect(controller.handle({ type: "translation-usage.get" }, { url: "chrome-extension://id/options.html" }, "id"))
      .resolves.toMatchObject({ ok: true, snapshot: { settings: { plan: "standard", monthlyCharacterBudget: 50_000 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 50_000 } });
    expect(storage.values).toEqual({ translationUsageLedger: { periodKey: "2026-09", submittedCharacters: 0 }, translationUsageSettings: { plan: "standard", monthlyCharacterBudget: 50_000 } });
  });

  it("只在真实提交前保留字符计数，不保存正文", async () => {
    const storage = memoryStorage();
    const controller = createTranslationUsageController({ storage, now: () => new Date("2026-09-10T00:00:00.000Z") });

    await controller.handle({ type: "translation-usage.update", payload: { plan: "standard", monthlyCharacterBudget: 3 } }, { url: "chrome-extension://id/options.html" }, "id");
    await expect(controller.reserveBeforeSubmit(2)).resolves.toMatchObject({ ok: true, snapshot: { submittedCharacters: 2, remainingCharacters: 1 } });
    await expect(controller.reserveBeforeSubmit(2)).resolves.toMatchObject({ ok: false, error: "BUDGET_EXHAUSTED" });
    expect(storage.values).toEqual({
      translationUsageSettings: { plan: "standard", monthlyCharacterBudget: 3 },
      translationUsageLedger: { periodKey: "2026-09", submittedCharacters: 2 },
    });
  });

  it("拒绝不受信任发送方和负预算", async () => {
    const controller = createTranslationUsageController({ storage: memoryStorage(), now: () => new Date("2026-09-10T00:00:00.000Z") });
    await expect(controller.handle({ type: "translation-usage.get" }, { url: "https://example.test/" }, "id")).resolves.toEqual({ ok: false, error: "UNTRUSTED_SENDER" });
    await expect(controller.handle({ type: "translation-usage.update", payload: { plan: "standard", monthlyCharacterBudget: -1 } }, { url: "chrome-extension://id/options.html" }, "id")).resolves.toEqual({ ok: false, error: "INVALID_SETTINGS" });
  });

  it("只允许选项页变更套餐，其他扩展页面不能绕过安全失效门", async () => {
    const storage = memoryStorage();
    const controller = createTranslationUsageController({ storage, now: () => new Date("2026-09-10T00:00:00.000Z") });

    await expect(controller.handle(
      { type: "translation-usage.update", payload: { plan: "advanced", monthlyCharacterBudget: 3 } },
      { url: "chrome-extension://id/popup.html" },
      "id",
    )).resolves.toEqual({ ok: false, error: "UNTRUSTED_SENDER" });
    expect(storage.values).toEqual({});
  });

  it("并发预留只能让预算内的提交成功，最终计数不丢失", async () => {
    const controller = createTranslationUsageController({ storage: memoryStorage(), now: () => new Date("2026-09-10T00:00:00.000Z") });
    await controller.handle({ type: "translation-usage.update", payload: { plan: "advanced", monthlyCharacterBudget: 3 } }, { url: "chrome-extension://id/options.html" }, "id");

    const [first, second] = await Promise.all([controller.reserveBeforeSubmit(2), controller.reserveBeforeSubmit(2)]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect(await controller.snapshot()).toMatchObject({ submittedCharacters: 2, remainingCharacters: 1 });
  });

  it("人工烟囱在同一预留临界区确认已审查套餐，套餐不一致时零预留", async () => {
    const controller = createTranslationUsageController({ storage: memoryStorage(), now: () => new Date("2026-09-10T00:00:00.000Z") });
    await controller.handle({ type: "translation-usage.update", payload: { plan: "advanced", monthlyCharacterBudget: 3 } }, { url: "chrome-extension://id/options.html" }, "id");

    await expect(controller.reserveForPlanBeforeSubmit(2, "standard")).resolves.toEqual({ ok: false, error: "ACCOUNT_REVIEW_REQUIRED" });
    await expect(controller.snapshot()).resolves.toMatchObject({ submittedCharacters: 0, remainingCharacters: 3 });
  });

  it("旧 UTC 月的取消回滚不会减少新月已提交字符", async () => {
    let current = new Date("2026-08-31T23:59:00.000Z");
    const controller = createTranslationUsageController({ storage: memoryStorage(), now: () => current });
    const oldReservation = await controller.reserveBeforeSubmit(2);
    expect(oldReservation).toMatchObject({ ok: true, snapshot: { periodKey: "2026-08" } });
    current = new Date("2026-09-01T00:01:00.000Z");
    await controller.reserveBeforeSubmit(3);
    await controller.releaseReservedCharacters(2, oldReservation.ok ? oldReservation.snapshot.periodKey : "2026-08");
    await expect(controller.snapshot()).resolves.toMatchObject({ periodKey: "2026-09", submittedCharacters: 3 });
  });
});
