import { describe, expect, it, vi } from "vitest";
import { createBaiduManualSmokeController } from "../../src/background/baidu-manual-smoke-controller";
import { createBaiduSubmissionGate } from "../../src/background/baidu-submission-gate";

const completeReview = {
  plan: "standard",
  quotaAndPricingConfirmed: true,
  qpsConfirmed: true,
  languageDirectionsConfirmed: true,
  singleRequestLengthConfirmed: true,
  dataTermsConfirmed: true,
};

describe("百度真实服务人工烟囱安全门", () => {
  it("准备阶段的凭据读取异常返回独立脱敏类别", async () => {
    const controller = createBaiduManualSmokeController({
      adapter: { translateWithCredentials: vi.fn() },
      credentials: async () => { throw new Error("credential storage unavailable"); },
      usage: {
        snapshot: async () => ({ settings: { plan: "standard", monthlyCharacterBudget: 300 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 300 }),
        reserveForPlanBeforeSubmit: async () => ({ ok: true as const, snapshot: { periodKey: "2026-09" } }),
        releaseReservedCharacters: async () => undefined,
      },
      hasProviderPermission: async () => true,
      storage: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
    });

    await expect(controller.handle(
      { type: "baidu.manual-smoke.prepare", payload: completeReview },
      { url: "chrome-extension://extension-id/options.html" },
      "extension-id",
    )).resolves.toEqual({ ok: false, error: "CREDENTIAL_STORAGE_FAILURE" });
  });

  it("准备阶段的未分类内部异常返回独立脱敏类别", async () => {
    const controller = createBaiduManualSmokeController({
      adapter: { translateWithCredentials: vi.fn() },
      credentials: async () => ({ appId: "local", secret: "local", revision: "credential-1" }),
      usage: {
        snapshot: async () => ({ settings: { plan: "standard", monthlyCharacterBudget: 300 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 300 }),
        reserveForPlanBeforeSubmit: async () => ({ ok: true as const, snapshot: { periodKey: "2026-09" } }),
        releaseReservedCharacters: async () => undefined,
      },
      hasProviderPermission: async () => true,
      storage: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
      now: () => { throw new Error("worker clock unavailable"); },
    });

    await expect(controller.handle(
      { type: "baidu.manual-smoke.prepare", payload: completeReview },
      { url: "chrome-extension://extension-id/options.html" },
      "extension-id",
    )).resolves.toEqual({ ok: false, error: "PREPARE_INTERNAL_FAILURE" });
  });

  it("准备阶段的本地用量快照异常返回独立脱敏类别", async () => {
    const controller = createBaiduManualSmokeController({
      adapter: { translateWithCredentials: vi.fn() },
      credentials: async () => ({ appId: "local", secret: "local", revision: "credential-1" }),
      usage: {
        snapshot: async () => { throw new Error("local usage storage unavailable"); },
        reserveForPlanBeforeSubmit: async () => ({ ok: true as const, snapshot: { periodKey: "2026-09" } }),
        releaseReservedCharacters: async () => undefined,
      },
      hasProviderPermission: async () => true,
      storage: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
    });

    await expect(controller.handle(
      { type: "baidu.manual-smoke.prepare", payload: completeReview },
      { url: "chrome-extension://extension-id/options.html" },
      "extension-id",
    )).resolves.toEqual({ ok: false, error: "USAGE_STORAGE_FAILURE" });
  });

  it("准备阶段无法创建一次性令牌时返回独立脱敏类别", async () => {
    const controller = createBaiduManualSmokeController({
      adapter: { translateWithCredentials: vi.fn() },
      credentials: async () => ({ appId: "local", secret: "local", revision: "credential-1" }),
      usage: {
        snapshot: async () => ({ settings: { plan: "standard", monthlyCharacterBudget: 300 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 300 }),
        reserveForPlanBeforeSubmit: async () => ({ ok: true as const, snapshot: { periodKey: "2026-09" } }),
        releaseReservedCharacters: async () => undefined,
      },
      hasProviderPermission: async () => true,
      storage: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
      createToken: () => { throw new Error("random UUID unavailable"); },
    });

    await expect(controller.handle(
      { type: "baidu.manual-smoke.prepare", payload: completeReview },
      { url: "chrome-extension://extension-id/options.html" },
      "extension-id",
    )).resolves.toEqual({ ok: false, error: "TOKEN_GENERATION_FAILURE" });
  });

  it("权限查询异常时按权限未获授权处理，而不是伪装成本地存储失败", async () => {
    const controller = createBaiduManualSmokeController({
      adapter: { translateWithCredentials: vi.fn() },
      credentials: async () => ({ appId: "local", secret: "local", revision: "credential-1" }),
      usage: {
        snapshot: async () => ({ settings: { plan: "standard", monthlyCharacterBudget: 300 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 300 }),
        reserveForPlanBeforeSubmit: async () => ({ ok: true as const, snapshot: { periodKey: "2026-09" } }),
        releaseReservedCharacters: async () => undefined,
      },
      hasProviderPermission: async () => { throw new Error("permissions API unavailable"); },
      storage: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
    });

    await expect(controller.handle(
      { type: "baidu.manual-smoke.prepare", payload: completeReview },
      { url: "chrome-extension://extension-id/options.html" },
      "extension-id",
    )).resolves.toEqual({ ok: false, error: "PERMISSION_REQUIRED" });
  });

  it("在账户重新核对不完整时阻断准备，且绝不触及适配器", async () => {
    const translate = vi.fn();
    const controller = createBaiduManualSmokeController({
      adapter: { translateWithCredentials: translate },
      credentials: async () => ({ appId: "local", secret: "local", revision: "credential-1" }),
      usage: {
        snapshot: async () => ({ settings: { plan: "standard", monthlyCharacterBudget: 300 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 300 }),
        reserveForPlanBeforeSubmit: async () => ({ ok: true as const, snapshot: { periodKey: "2026-09" } }),
        releaseReservedCharacters: async () => undefined,
      },
      hasProviderPermission: async () => true,
      storage: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
    });

    await expect(controller.handle(
      { type: "baidu.manual-smoke.prepare", payload: { ...completeReview, dataTermsConfirmed: false } },
      { url: "chrome-extension://extension-id/options.html" },
      "extension-id",
    )).resolves.toEqual({ ok: false, error: "ACCOUNT_REVIEW_REQUIRED" });
    expect(translate).not.toHaveBeenCalled();
  });

  it("只在两次明确操作后恰好提交一次，并只返回脱敏成功状态", async () => {
    const translate = vi.fn().mockResolvedValue({ translatedText: "fixture", sourceLanguage: "auto", targetLanguage: "zh", adapter: "baidu" });
    const reserveForPlanBeforeSubmit = vi.fn().mockResolvedValue({ ok: true, snapshot: { periodKey: "2026-09" } });
    const values: Record<string, unknown> = {};
    const controller = createBaiduManualSmokeController({
      adapter: { translateWithCredentials: translate },
      credentials: async () => ({ appId: "local", secret: "local-secret", revision: "credential-1" }),
      usage: {
        snapshot: async () => ({ settings: { plan: "standard", monthlyCharacterBudget: 300 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 300 }),
        reserveForPlanBeforeSubmit,
        releaseReservedCharacters: vi.fn().mockResolvedValue(undefined),
      },
      hasProviderPermission: async () => true,
      storage: {
        get: async (key) => ({ [key]: values[key] }),
        set: async (next) => { Object.assign(values, next); },
        remove: async (key) => { delete values[key]; },
      },
      createToken: () => "one-time-token",
    });
    const sender = { url: "chrome-extension://extension-id/options.html" };

    const prepared = await controller.handle(
      { type: "baidu.manual-smoke.prepare", payload: completeReview },
      sender,
      "extension-id",
    );
    expect(prepared).toMatchObject({ ok: true, sourceCharacterCount: expect.any(Number) });
    if (!prepared.ok || !("confirmationToken" in prepared)) throw new Error("预期可进入二次确认");
    expect(translate).not.toHaveBeenCalled();

    await expect(controller.handle(
      { type: "baidu.manual-smoke.run", payload: { confirmationToken: prepared.confirmationToken } },
      sender,
      "extension-id",
    )).resolves.toEqual({ ok: true, provider: "baidu", submittedCharacters: prepared.sourceCharacterCount });
    expect(translate).toHaveBeenCalledOnce();
    expect(reserveForPlanBeforeSubmit).toHaveBeenCalledWith(prepared.sourceCharacterCount, "standard");
    expect(JSON.stringify(values)).not.toContain("local-secret");
    expect(JSON.stringify(values)).not.toContain("fixture");
    await expect(controller.handle(
      { type: "baidu.manual-smoke.run", payload: { confirmationToken: prepared.confirmationToken } },
      sender,
      "extension-id",
    )).resolves.toEqual({ ok: false, error: "CONFIRMATION_USED" });
    expect(translate).toHaveBeenCalledOnce();
  });

  it("百度请求成功但 readiness 写入失败时返回独立脱敏类别", async () => {
    const translateWithCredentials = vi.fn().mockResolvedValue({
      translatedText: "fixture",
      sourceLanguage: "auto",
      targetLanguage: "zh",
      adapter: "baidu",
    });
    const releaseReservedCharacters = vi.fn().mockResolvedValue(undefined);
    const controller = createBaiduManualSmokeController({
      adapter: { translateWithCredentials },
      credentials: async () => ({ appId: "local", secret: "local", revision: "credential-1" }),
      usage: {
        snapshot: async () => ({ settings: { plan: "standard", monthlyCharacterBudget: 300 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 300 }),
        reserveForPlanBeforeSubmit: async () => ({ ok: true as const, snapshot: { periodKey: "2026-09" } }),
        releaseReservedCharacters,
      },
      hasProviderPermission: async () => true,
      storage: {
        get: async () => ({}),
        set: async () => { throw new Error("readiness storage unavailable"); },
        remove: async () => undefined,
      },
      createToken: () => "readiness-write-token",
    });
    const sender = { url: "chrome-extension://extension-id/options.html" };
    const prepared = await controller.handle({ type: "baidu.manual-smoke.prepare", payload: completeReview }, sender, "extension-id");
    if (!prepared.ok || !("confirmationToken" in prepared)) throw new Error("预期可准备");

    await expect(controller.handle(
      { type: "baidu.manual-smoke.run", payload: { confirmationToken: prepared.confirmationToken } },
      sender,
      "extension-id",
    )).resolves.toEqual({ ok: false, error: "READINESS_STORAGE_FAILURE" });
    expect(translateWithCredentials).toHaveBeenCalledOnce();
    // 真实请求已经提交，不得回滚本地用量而伪装成未调用。
    expect(releaseReservedCharacters).not.toHaveBeenCalled();
  });

  it("运行阶段用量预留失败时返回独立脱敏类别且不发送请求", async () => {
    const translateWithCredentials = vi.fn();
    const controller = createBaiduManualSmokeController({
      adapter: { translateWithCredentials },
      credentials: async () => ({ appId: "local", secret: "local", revision: "credential-1" }),
      usage: {
        snapshot: async () => ({ settings: { plan: "standard", monthlyCharacterBudget: 300 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 300 }),
        reserveForPlanBeforeSubmit: async () => ({ ok: false as const, error: "STORAGE_FAILURE" as const }),
        releaseReservedCharacters: async () => undefined,
      },
      hasProviderPermission: async () => true,
      storage: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
      createToken: () => "usage-reservation-token",
    });
    const sender = { url: "chrome-extension://extension-id/options.html" };
    const prepared = await controller.handle({ type: "baidu.manual-smoke.prepare", payload: completeReview }, sender, "extension-id");
    if (!prepared.ok || !("confirmationToken" in prepared)) throw new Error("预期可准备");

    await expect(controller.handle(
      { type: "baidu.manual-smoke.run", payload: { confirmationToken: prepared.confirmationToken } },
      sender,
      "extension-id",
    )).resolves.toEqual({ ok: false, error: "USAGE_RESERVATION_FAILURE" });
    expect(translateWithCredentials).not.toHaveBeenCalled();
  });

  it("凭据清除并重新保存后，即使旧 readiness 删除失败也不接受 ABA 代次", async () => {
    let generation = "credential-first";
    const values: Record<string, unknown> = {};
    const controller = createBaiduManualSmokeController({
      adapter: { translateWithCredentials: vi.fn().mockResolvedValue({ translatedText: "fixture", sourceLanguage: "auto", targetLanguage: "zh", adapter: "baidu" }) },
      credentials: async () => ({ appId: "local", secret: "local", revision: generation }),
      usage: {
        snapshot: async () => ({ settings: { plan: "standard", monthlyCharacterBudget: 300 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 300 }),
        reserveForPlanBeforeSubmit: async () => ({ ok: true as const, snapshot: { periodKey: "2026-09" } }),
        releaseReservedCharacters: async () => undefined,
      },
      hasProviderPermission: async () => true,
      storage: {
        get: async (key) => ({ [key]: values[key] }),
        set: async (next) => { Object.assign(values, next); },
        remove: async () => { throw new Error("simulated storage failure"); },
      },
      createToken: () => "ready-token",
    });
    const sender = { url: "chrome-extension://extension-id/options.html" };
    const prepared = await controller.handle({ type: "baidu.manual-smoke.prepare", payload: completeReview }, sender, "extension-id");
    if (!prepared.ok || !("confirmationToken" in prepared)) throw new Error("预期可准备");
    await controller.handle({ type: "baidu.manual-smoke.run", payload: { confirmationToken: prepared.confirmationToken } }, sender, "extension-id");
    await expect(controller.hasCurrentReadiness()).resolves.toBe(true);

    generation = "credential-second";
    await controller.invalidate();
    await expect(controller.hasCurrentReadiness()).resolves.toBe(false);
  });

  it("准备大量或重复确认时会清理过期令牌并限制内存中待确认的数量", async () => {
    let clock = 10;
    let sequence = 0;
    const controller = createBaiduManualSmokeController({
      adapter: { translateWithCredentials: vi.fn() },
      credentials: async () => ({ appId: "local", secret: "local", revision: "credential-1" }),
      usage: {
        snapshot: async () => ({ settings: { plan: "standard", monthlyCharacterBudget: 300 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 300 }),
        reserveForPlanBeforeSubmit: async () => ({ ok: true as const, snapshot: { periodKey: "2026-09" } }),
        releaseReservedCharacters: async () => undefined,
      },
      hasProviderPermission: async () => true,
      storage: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
      now: () => clock,
      createToken: () => `token-${sequence++}`,
    });
    const sender = { url: "chrome-extension://extension-id/options.html" };

    const confirmations = await Promise.all(Array.from({ length: 17 }, () => controller.handle(
      { type: "baidu.manual-smoke.prepare", payload: completeReview },
      sender,
      "extension-id",
    )));
    const first = confirmations[0];
    if (!first.ok || !("confirmationToken" in first)) throw new Error("预期首个确认");
    expect(first.sourceCharacterCount).toBeLessThanOrEqual(300);

    await expect(controller.handle(
      { type: "baidu.manual-smoke.run", payload: { confirmationToken: first.confirmationToken } },
      sender,
      "extension-id",
    )).resolves.toEqual({ ok: false, error: "CONFIRMATION_EXPIRED" });

    clock += 60_001;
    const current = await controller.handle({ type: "baidu.manual-smoke.prepare", payload: completeReview }, sender, "extension-id");
    if (!current.ok || !("confirmationToken" in current)) throw new Error("预期新确认");
    expect(current.sourceCharacterCount).toBeLessThanOrEqual(300);
  });

  it("在确认令牌恰好到期的时刻拒绝提交", async () => {
    let clock = 0;
    const translateWithCredentials = vi.fn();
    const controller = createBaiduManualSmokeController({
      adapter: { translateWithCredentials },
      credentials: async () => ({ appId: "local", secret: "local", revision: "credential-1" }),
      usage: {
        snapshot: async () => ({ settings: { plan: "standard", monthlyCharacterBudget: 300 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 300 }),
        reserveForPlanBeforeSubmit: async () => ({ ok: true as const, snapshot: { periodKey: "2026-09" } }),
        releaseReservedCharacters: async () => undefined,
      },
      hasProviderPermission: async () => true,
      storage: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
      now: () => clock,
      createToken: () => "boundary-token",
    });
    const sender = { url: "chrome-extension://extension-id/options.html" };
    const prepared = await controller.handle({ type: "baidu.manual-smoke.prepare", payload: completeReview }, sender, "extension-id");
    if (!prepared.ok || !("confirmationToken" in prepared)) throw new Error("预期可准备");

    clock = 60_000;
    await expect(controller.handle({ type: "baidu.manual-smoke.run", payload: { confirmationToken: prepared.confirmationToken } }, sender, "extension-id")).resolves.toEqual({ ok: false, error: "CONFIRMATION_EXPIRED" });
    expect(translateWithCredentials).not.toHaveBeenCalled();
  });

  it("凭据在预留后变化时撤销旧授权、回滚预算，绝不提交旧代次", async () => {
    let generation = "credential-first";
    const translate = vi.fn().mockResolvedValue({ translatedText: "fixture", sourceLanguage: "auto", targetLanguage: "zh", adapter: "baidu" });
    const translateWithCredentials = vi.fn().mockResolvedValue({ translatedText: "fixture", sourceLanguage: "auto", targetLanguage: "zh", adapter: "baidu" });
    const releaseReservedCharacters = vi.fn().mockResolvedValue(undefined);
    const controller = createBaiduManualSmokeController({
      adapter: { translate, translateWithCredentials } as never,
      credentials: async () => ({ appId: "local", secret: "local", revision: generation }),
      usage: {
        snapshot: async () => ({ settings: { plan: "standard", monthlyCharacterBudget: 300 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 300 }),
        reserveForPlanBeforeSubmit: async () => {
          generation = "credential-second";
          return { ok: true as const, snapshot: { periodKey: "2026-09" } };
        },
        releaseReservedCharacters,
      },
      hasProviderPermission: async () => true,
      storage: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
      createToken: () => "credential-token",
    });
    const sender = { url: "chrome-extension://extension-id/options.html" };
    const prepared = await controller.handle({ type: "baidu.manual-smoke.prepare", payload: completeReview }, sender, "extension-id");
    if (!prepared.ok || !("confirmationToken" in prepared)) throw new Error("预期可准备");

    await expect(controller.handle({ type: "baidu.manual-smoke.run", payload: { confirmationToken: prepared.confirmationToken } }, sender, "extension-id")).resolves.toEqual({ ok: false, error: "CONFIRMATION_EXPIRED" });
    expect(releaseReservedCharacters).toHaveBeenCalledOnce();
    expect(translateWithCredentials).not.toHaveBeenCalled();
    expect(translate).not.toHaveBeenCalled();
  });

  it("套餐在确认后改变时，在预留边界拒绝而绝不提交人工请求", async () => {
    const translate = vi.fn();
    const controller = createBaiduManualSmokeController({
      adapter: { translateWithCredentials: translate },
      credentials: async () => ({ appId: "local", secret: "local", revision: "credential-1" }),
      usage: {
        snapshot: async () => ({ settings: { plan: "standard", monthlyCharacterBudget: 300 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 300 }),
        reserveBeforeSubmit: async () => ({ ok: true as const, snapshot: { periodKey: "2026-09" } }),
        reserveForPlanBeforeSubmit: async () => ({ ok: false as const, error: "ACCOUNT_REVIEW_REQUIRED" as const }),
        releaseReservedCharacters: async () => undefined,
      } as never,
      hasProviderPermission: async () => true,
      storage: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
      createToken: () => "plan-token",
    });
    const sender = { url: "chrome-extension://extension-id/options.html" };
    const prepared = await controller.handle({ type: "baidu.manual-smoke.prepare", payload: completeReview }, sender, "extension-id");
    if (!prepared.ok || !("confirmationToken" in prepared)) throw new Error("预期可准备");

    await expect(controller.handle({ type: "baidu.manual-smoke.run", payload: { confirmationToken: prepared.confirmationToken } }, sender, "extension-id")).resolves.toEqual({ ok: false, error: "ACCOUNT_REVIEW_REQUIRED" });
    expect(translate).not.toHaveBeenCalled();
  });

  it("共享 QPS 门记录 smoke 起点后不会再做异步核对而推迟真实提交", async () => {
    let clock = 0;
    let credentialReads = 0;
    let transportStartedAt = -1;
    const wait = vi.fn(async (milliseconds: number) => { clock += milliseconds; });
    const submissionGate = createBaiduSubmissionGate({ now: () => clock, wait });
    const controller = createBaiduManualSmokeController({
      adapter: { translateWithCredentials: vi.fn(async () => { transportStartedAt = clock; return { translatedText: "fixture", sourceLanguage: "auto" as const, targetLanguage: "zh" as const, adapter: "baidu" as const }; }) },
      credentials: async () => {
        credentialReads += 1;
        // The fourth read is the existing post-gate re-check. Its simulated
        // I/O delay demonstrates why it must not remain after rate admission.
        if (credentialReads === 4) clock += 600;
        return { appId: "local", secret: "local", revision: "credential-1" };
      },
      usage: {
        snapshot: async () => ({ settings: { plan: "standard", monthlyCharacterBudget: 300 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 300 }),
        reserveForPlanBeforeSubmit: async () => ({ ok: true as const, snapshot: { periodKey: "2026-09" } }),
        releaseReservedCharacters: async () => undefined,
      },
      hasProviderPermission: async () => true,
      storage: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
      submissionGate,
      now: () => clock,
      createToken: () => "rate-token",
    });
    const sender = { url: "chrome-extension://extension-id/options.html" };
    const prepared = await controller.handle({ type: "baidu.manual-smoke.prepare", payload: completeReview }, sender, "extension-id");
    if (!prepared.ok || !("confirmationToken" in prepared)) throw new Error("预期可准备");

    await expect(controller.handle({ type: "baidu.manual-smoke.run", payload: { confirmationToken: prepared.confirmationToken } }, sender, "extension-id")).resolves.toMatchObject({ ok: true });
    expect(transportStartedAt).toBe(0);
    await submissionGate.waitForTurn("standard");
    expect(wait).toHaveBeenCalledWith(1_000);
  });
});
