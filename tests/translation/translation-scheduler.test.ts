import { describe, expect, it, vi } from "vitest";
import { createTranslationScheduler } from "../../src/background/translation-scheduler";
import type { TranslationUsageSnapshot } from "../../src/shared/translation-usage";
import { createTranslationUsageController } from "../../src/background/translation-usage-controller";
import { TranslationAdapterError, TRANSLATION_PROVIDER_ERROR_CODES, type TranslationOutput } from "../../src/shared/translation";
import { createBaiduSubmissionGate } from "../../src/background/baidu-submission-gate";

const task = (requestId: string, text = "A😀") => ({ requestId, blockId: requestId, text, sourceLanguage: "auto" as const, targetLanguage: "zh" as const });

describe("可视翻译调度行为", () => {
  it("网络失败最多自动重试两次；每次真实提交均重新预检并计入预算", async () => {
    const waits: number[] = [];
    let now = 0;
    const preflight = vi.fn().mockResolvedValue({ ok: true });
    const reserveBeforeSubmit = vi.fn().mockResolvedValue({ ok: true, snapshot: { periodKey: "2026-09" } });
    const translate = vi.fn()
      .mockRejectedValueOnce(new TranslationAdapterError({ error: TRANSLATION_PROVIDER_ERROR_CODES.network }))
      .mockRejectedValueOnce(new TranslationAdapterError({ error: TRANSLATION_PROVIDER_ERROR_CODES.network }))
      .mockResolvedValueOnce({ translatedText: "恢复后的译文", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" });
    const scheduler = createTranslationScheduler({
      adapter: { id: "fake", version: "test-v1", translate },
      usage: {
        snapshot: vi.fn().mockResolvedValue({ settings: { plan: "advanced", monthlyCharacterBudget: 100 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 100 }),
        reserveBeforeSubmit,
        releaseReservedCharacters: vi.fn(),
      },
      now: () => now,
      wait: async (milliseconds) => { waits.push(milliseconds); now += milliseconds; },
    });

    await expect(scheduler.enqueue(task("network-retry"), { preflight })).resolves.toMatchObject({
      ok: true,
      output: { translatedText: "恢复后的译文", adapter: "fake", adapterVersion: "test-v1" },
    });
    expect(translate).toHaveBeenCalledTimes(3);
    expect(reserveBeforeSubmit).toHaveBeenCalledTimes(3);
    expect(preflight).toHaveBeenCalledTimes(4);
    expect(waits).toEqual([250, 500]);
  });

  it("供应商级鉴权失败只暂停当前 document scope，清理后新 document 可恢复", async () => {
    const translate = vi.fn()
      .mockRejectedValueOnce(new TranslationAdapterError({ error: TRANSLATION_PROVIDER_ERROR_CODES.authentication }))
      .mockResolvedValue({ translatedText: "其他页面可用", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" });
    const scheduler = createTranslationScheduler({
      adapter: { id: "fake", version: "test-v1", translate },
      usage: { snapshot: vi.fn().mockResolvedValue({ settings: { plan: "advanced", monthlyCharacterBudget: 100 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 100 }), reserveBeforeSubmit: vi.fn().mockResolvedValue({ ok: true, snapshot: { periodKey: "2026-09" } }), releaseReservedCharacters: vi.fn() },
    });
    const documentA = "tab:1/frame:0/document:a";

    await expect(scheduler.enqueue(task("auth-a"), { scope: documentA })).resolves.toMatchObject({ ok: false, error: "AUTHENTICATION_FAILED" });
    await expect(scheduler.enqueue(task("auth-a-later"), { scope: documentA })).resolves.toMatchObject({ ok: false, error: "AUTHENTICATION_FAILED" });
    await expect(scheduler.enqueue(task("other-tab"), { scope: "tab:2/frame:0/document:a" })).resolves.toMatchObject({ ok: true });
    expect(translate).toHaveBeenCalledTimes(2);

    scheduler.clearScope(documentA);
    await expect(scheduler.enqueue(task("new-document"), { scope: "tab:1/frame:0/document:b" })).resolves.toMatchObject({ ok: true });
    expect(translate).toHaveBeenCalledTimes(3);
  });

  it("适配器故障只把脱敏类别交给诊断端口", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const scheduler = createTranslationScheduler({
      adapter: { id: "fake", version: "test-v1", translate: vi.fn().mockRejectedValue(new TranslationAdapterError({ error: TRANSLATION_PROVIDER_ERROR_CODES.invalidRequest, providerCode: "54001" })) },
      usage: { snapshot: vi.fn().mockResolvedValue({ settings: { plan: "advanced", monthlyCharacterBudget: 100 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 100 }), reserveBeforeSubmit: vi.fn().mockResolvedValue({ ok: true, snapshot: { periodKey: "2026-09" } }), releaseReservedCharacters: vi.fn() },
      diagnostics: { record },
    });

    await expect(scheduler.enqueue(task("diagnostic"))).resolves.toMatchObject({ ok: false, error: "INVALID_REQUEST" });
    expect(record).toHaveBeenCalledWith({ error: "INVALID_REQUEST", providerCode: "54001" });
  });

  it("两个限流块共用一次全局恢复等待，恢复后仍逐次通过套餐门槛", async () => {
    let now = 0;
    let active = 0;
    let peak = 0;
    let attempts = 0;
    const starts: number[] = [];
    const rejected: Array<() => void> = [];
    const recoveryWaits: Array<() => void> = [];
    const translate = vi.fn(() => {
      starts.push(now);
      active += 1;
      peak = Math.max(peak, active);
      attempts += 1;
      if (attempts <= 2) return new Promise<TranslationOutput>((_, reject) => rejected.push(() => { active -= 1; reject(new TranslationAdapterError({ error: TRANSLATION_PROVIDER_ERROR_CODES.rateLimited, retryAfterMs: 250 })); }));
      active -= 1;
      return Promise.resolve({ translatedText: "恢复", sourceLanguage: "auto" as const, targetLanguage: "zh" as const, adapter: "fake" as const });
    });
    const reserveBeforeSubmit = vi.fn().mockResolvedValue({ ok: true, snapshot: { periodKey: "2026-09" } });
    const scheduler = createTranslationScheduler({
      adapter: { id: "fake", version: "test-v1", translate },
      usage: { snapshot: vi.fn().mockResolvedValue({ settings: { plan: "advanced", monthlyCharacterBudget: 100 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 100 }), reserveBeforeSubmit, releaseReservedCharacters: vi.fn() },
      now: () => now,
      wait: (milliseconds) => milliseconds >= 250
        ? new Promise<void>((resolve) => recoveryWaits.push(resolve))
        : Promise.resolve().then(() => { now += milliseconds; }),
    });

    const first = scheduler.enqueue(task("rate-first"));
    const second = scheduler.enqueue(task("rate-second"));
    await vi.waitFor(() => expect(starts).toHaveLength(2));
    rejected.splice(0).forEach((reject) => reject());
    await vi.waitFor(() => expect(recoveryWaits).toHaveLength(1));
    now = 350;
    recoveryWaits.shift()?.();

    await expect(Promise.all([first, second])).resolves.toEqual([expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })]);
    expect(translate).toHaveBeenCalledTimes(4);
    expect(reserveBeforeSubmit).toHaveBeenCalledTimes(4);
    expect(peak).toBeLessThanOrEqual(10);
    expect([...starts].sort((left, right) => left - right).every((start, index, values) => index === 0 || start - values[index - 1]! >= 100)).toBe(true);
  });

  it("取消退避中的任务后，即使等待到期也不会新增提交或预算", async () => {
    let releaseRetry: (() => void) | undefined;
    const reserveBeforeSubmit = vi.fn().mockResolvedValue({ ok: true, snapshot: { periodKey: "2026-09" } });
    const translate = vi.fn().mockRejectedValue(new TranslationAdapterError({ error: TRANSLATION_PROVIDER_ERROR_CODES.network }));
    const scheduler = createTranslationScheduler({
      adapter: { id: "fake", version: "test-v1", translate },
      usage: { snapshot: vi.fn().mockResolvedValue({ settings: { plan: "advanced", monthlyCharacterBudget: 100 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 100 }), reserveBeforeSubmit, releaseReservedCharacters: vi.fn() },
      wait: () => new Promise<void>((resolve) => { releaseRetry = resolve; }),
    });
    const pending = scheduler.enqueue(task("cancel-retry"), { scope: "tab:1/frame:0/document:a" });

    await vi.waitFor(() => expect(releaseRetry).toBeTypeOf("function"));
    scheduler.cancel({ requestId: "cancel-retry", blockId: "cancel-retry" }, "tab:1/frame:0/document:a");
    releaseRetry?.();
    await expect(pending).resolves.toMatchObject({ ok: false, error: "CANCELED" });
    expect(translate).toHaveBeenCalledTimes(1);
    expect(reserveBeforeSubmit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["配额耗尽", "PROVIDER_QUOTA_EXHAUSTED"],
    ["不支持语言", "UNSUPPORTED_LANGUAGE"],
    ["内容风险", "CONTENT_RISK"],
  ] as const)("确定性的%s不会自动重试", async (_label, error) => {
    const translate = vi.fn().mockRejectedValue(new TranslationAdapterError({ error }));
    const scheduler = createTranslationScheduler({
      adapter: { id: "fake", version: "test-v1", translate },
      usage: { snapshot: vi.fn().mockResolvedValue({ settings: { plan: "advanced", monthlyCharacterBudget: 100 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 100 }), reserveBeforeSubmit: vi.fn().mockResolvedValue({ ok: true, snapshot: { periodKey: "2026-09" } }), releaseReservedCharacters: vi.fn() },
    });

    await expect(scheduler.enqueue(task(`deterministic-${error}`))).resolves.toMatchObject({ ok: false, error });
    expect(translate).toHaveBeenCalledOnce();
  });

  it("服务暂不可用重试耗尽后暂停当前 document scope", async () => {
    let now = 0;
    const translate = vi.fn().mockRejectedValue(new TranslationAdapterError({ error: TRANSLATION_PROVIDER_ERROR_CODES.serviceUnavailable }));
    const scheduler = createTranslationScheduler({
      adapter: { id: "fake", version: "test-v1", translate },
      usage: { snapshot: vi.fn().mockResolvedValue({ settings: { plan: "advanced", monthlyCharacterBudget: 100 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 100 }), reserveBeforeSubmit: vi.fn().mockResolvedValue({ ok: true, snapshot: { periodKey: "2026-09" } }), releaseReservedCharacters: vi.fn() },
      now: () => now,
      wait: async (milliseconds) => { now += milliseconds; },
    });
    const scope = "tab:1/frame:0/document:service-down";

    await expect(scheduler.enqueue(task("service-down"), { scope })).resolves.toMatchObject({ ok: false, error: "SERVICE_UNAVAILABLE" });
    await expect(scheduler.enqueue(task("service-down-later"), { scope })).resolves.toMatchObject({ ok: false, error: "SERVICE_UNAVAILABLE" });
    expect(translate).toHaveBeenCalledTimes(3);
  });

  it("标准版的供应商提交起点至少相隔一秒，并按 Unicode 源字符预留", async () => {
    let now = 0;
    let releaseRateLimit: (() => void) | undefined;
    const starts: number[] = [];
    const reserves: number[] = [];
    const scheduler = createTranslationScheduler({
      adapter: { id: "fake", version: "test-v1", translate: vi.fn().mockImplementation(async () => { starts.push(now); return { translatedText: "固定译文", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" }; }) },
      usage: { snapshot: vi.fn().mockResolvedValue({ settings: { plan: "standard", monthlyCharacterBudget: 10 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 10 }), reserveBeforeSubmit: vi.fn(async (count: number) => { reserves.push(count); return { ok: true as const, snapshot: { periodKey: "2026-09" } }; }), releaseReservedCharacters: vi.fn() },
      wait: vi.fn(() => new Promise<void>((resolve) => { releaseRateLimit = resolve; })),
      now: () => now,
    });

    const first = scheduler.enqueue(task("one"));
    await vi.waitFor(() => expect(starts).toEqual([0]));
    const second = scheduler.enqueue(task("two"));
    await vi.waitFor(() => expect(releaseRateLimit).toBeTypeOf("function"));
    now = 1_000;
    releaseRateLimit?.();

    await expect(Promise.all([first, second])).resolves.toEqual([expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })]);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(1_000);
    expect(reserves).toEqual([2, 2]);
  });

  it("取消等待任务或预检拒绝时不提交供应商，预检只观察任务标识", async () => {
    let releaseRateLimit: (() => void) | undefined;
    const translate = vi.fn();
    const preflight = vi.fn().mockResolvedValue({ ok: true });
    const scheduler = createTranslationScheduler({
      adapter: { id: "fake", version: "test-v1", translate },
      usage: { snapshot: vi.fn().mockResolvedValue({ settings: { plan: "standard", monthlyCharacterBudget: 10 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 10 }), reserveBeforeSubmit: vi.fn().mockResolvedValue({ ok: true, snapshot: { periodKey: "2026-09" } }), releaseReservedCharacters: vi.fn() },
      wait: () => new Promise<void>((resolve) => { releaseRateLimit = resolve; }),
      now: () => 0,
    });

    const first = scheduler.enqueue(task("first"));
    await vi.waitFor(() => expect(translate).toHaveBeenCalledOnce());
    const waiting = scheduler.enqueue(task("waiting"), { preflight });
    await vi.waitFor(() => expect(releaseRateLimit).toBeTypeOf("function"));
    scheduler.cancel({ requestId: "waiting", blockId: "waiting" });
    releaseRateLimit?.();
    await expect(waiting).resolves.toMatchObject({ ok: false, error: "CANCELED" });
    expect(translate).toHaveBeenCalledOnce();

    const rejected = createTranslationScheduler({
      adapter: { id: "fake", version: "test-v1", translate },
      usage: { snapshot: vi.fn().mockResolvedValue({ settings: { plan: "advanced", monthlyCharacterBudget: 10 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 10 }), reserveBeforeSubmit: vi.fn().mockResolvedValue({ ok: true, snapshot: { periodKey: "2026-09" } }), releaseReservedCharacters: vi.fn() },
      now: () => 0,
    });
    await expect(rejected.enqueue(task("hidden"), { preflight: vi.fn().mockResolvedValue({ ok: false, error: "NOT_VISIBLE" }) })).resolves.toMatchObject({ ok: false, error: "CANCELED" });
    expect(translate).toHaveBeenCalledOnce();
    expect(preflight).not.toHaveBeenCalledWith(expect.objectContaining({ text: expect.anything() }));
    await first;
  });

  it("高级版并发任务的实际提交仍按其明确 QPS 间隔，且不同 tab/frame 的同名请求不会互相取消", async () => {
    let now = 0;
    const releases: Array<() => void> = [];
    const starts: number[] = [];
    const scheduler = createTranslationScheduler({
      adapter: { id: "fake", version: "test-v1", translate: vi.fn().mockImplementation(async () => { starts.push(now); return { translatedText: "固定译文", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" }; }) },
      usage: { snapshot: vi.fn().mockResolvedValue({ settings: { plan: "advanced", monthlyCharacterBudget: 100 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 100 }), reserveBeforeSubmit: vi.fn().mockResolvedValue({ ok: true, snapshot: { periodKey: "2026-09" } }), releaseReservedCharacters: vi.fn() },
      now: () => now,
      wait: () => new Promise<void>((resolve) => releases.push(resolve)),
    });
    const first = scheduler.enqueue(task("same"), { scope: "tab:1/frame:0" });
    const second = scheduler.enqueue(task("same"), { scope: "tab:2/frame:0" });
    const third = scheduler.enqueue(task("third"), { scope: "tab:3/frame:0" });
    await vi.waitFor(() => expect(starts).toEqual([0]));
    scheduler.cancel({ requestId: "same", blockId: "same" }, "tab:1/frame:0");
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    now = 100;
    releases.shift()?.();
    await vi.waitFor(() => expect(starts).toEqual([0, 100]));
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    now = 200;
    releases.shift()?.();
    await expect(Promise.all([first, second, third])).resolves.toEqual([expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })]);
    expect(starts).toEqual([0, 100, 200]);
  });

  it("入队前拒绝无效会话；预留期间取消会回滚计数且不调用适配器", async () => {
    let resolveReservation: ((value: { ok: true; snapshot: { periodKey: string } }) => void) | undefined;
    const reserveBeforeSubmit = vi.fn(() => new Promise<{ ok: true; snapshot: { periodKey: string } }>((resolve) => { resolveReservation = resolve; }));
    const releaseReservedCharacters = vi.fn().mockResolvedValue(undefined);
    const translate = vi.fn();
    const scheduler = createTranslationScheduler({
      adapter: { id: "fake", version: "test-v1", translate },
      usage: { snapshot: vi.fn().mockResolvedValue({ settings: { plan: "advanced", monthlyCharacterBudget: 100 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 100 }), reserveBeforeSubmit, releaseReservedCharacters },
      now: () => 0,
    });
    await expect(scheduler.enqueue(task("gone"), { validate: vi.fn().mockResolvedValue(false) })).resolves.toMatchObject({ ok: false, error: "SESSION_UNAVAILABLE" });
    expect(translate).not.toHaveBeenCalled();

    const canceled = scheduler.enqueue(task("race"), { scope: "tab:1/frame:0" });
    await vi.waitFor(() => expect(reserveBeforeSubmit).toHaveBeenCalledWith(2));
    scheduler.cancel({ requestId: "race", blockId: "race" }, "tab:1/frame:0");
    resolveReservation?.({ ok: true, snapshot: { periodKey: "2026-09" } });
    await expect(canceled).resolves.toMatchObject({ ok: false, error: "CANCELED" });
    expect(releaseReservedCharacters).toHaveBeenCalledWith(2, "2026-09");
    expect(translate).not.toHaveBeenCalled();
  });

  it("验证尚未完成或仍在等待时取消会立即结算，重复 scoped identity 不覆盖原任务", async () => {
    let releaseValidation: (() => void) | undefined;
    const translate = vi.fn();
    const scheduler = createTranslationScheduler({
      adapter: { id: "fake", version: "test-v1", translate },
      usage: { snapshot: vi.fn(), reserveBeforeSubmit: vi.fn(), releaseReservedCharacters: vi.fn() },
      now: () => 0,
    });
    const validating = scheduler.enqueue(task("same"), { scope: "tab:1/frame:0", validate: () => new Promise<boolean>((resolve) => { releaseValidation = () => resolve(true); }) });
    const duplicate = scheduler.enqueue(task("same"), { scope: "tab:1/frame:0" });
    scheduler.cancel({ requestId: "same", blockId: "same" }, "tab:1/frame:0");
    releaseValidation?.();

    await expect(validating).resolves.toMatchObject({ ok: false, error: "CANCELED" });
    await expect(duplicate).resolves.toMatchObject({ ok: false, error: "CANCELED" });
    expect(translate).not.toHaveBeenCalled();
  });

  it("等待限速时套餐切回标准版，会按标准版的一秒间隔提交", async () => {
    let now = 0;
    let plan: "advanced" | "standard" = "advanced";
    const releases: Array<() => void> = [];
    const starts: number[] = [];
    const scheduler = createTranslationScheduler({
      adapter: { id: "fake", version: "test-v1", translate: vi.fn().mockImplementation(async () => { starts.push(now); return { translatedText: "固定译文", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" }; }) },
      usage: { snapshot: vi.fn().mockImplementation(async () => ({ settings: { plan, monthlyCharacterBudget: 100 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 100 })), reserveBeforeSubmit: vi.fn().mockResolvedValue({ ok: true, snapshot: { periodKey: "2026-09" } }), releaseReservedCharacters: vi.fn() },
      now: () => now,
      wait: () => new Promise<void>((resolve) => releases.push(resolve)),
    });
    const first = scheduler.enqueue(task("one"));
    await vi.waitFor(() => expect(starts).toEqual([0]));
    const second = scheduler.enqueue(task("two"));
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    plan = "standard";
    now = 100;
    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    now = 1_000;
    releases.shift()?.();
    await Promise.all([first, second]);
    expect(starts).toEqual([0, 1_000]);
  });

  it("等待队列读取套餐时取消任务会立刻结算，不留下未处理任务", async () => {
    let releaseSnapshot: (() => void) | undefined;
    const scheduler = createTranslationScheduler({
      adapter: { id: "fake", version: "test-v1", translate: vi.fn() },
      usage: { snapshot: vi.fn(() => new Promise<TranslationUsageSnapshot>((resolve) => { releaseSnapshot = () => resolve({ settings: { plan: "standard", monthlyCharacterBudget: 1 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 1 }); })), reserveBeforeSubmit: vi.fn(), releaseReservedCharacters: vi.fn() },
    });
    const queued = scheduler.enqueue(task("queued"), { scope: "tab:1/frame:0" });
    await vi.waitFor(() => expect(releaseSnapshot).toBeTypeOf("function"));
    scheduler.cancel({ requestId: "queued", blockId: "queued" }, "tab:1/frame:0");
    releaseSnapshot?.();
    await expect(queued).resolves.toMatchObject({ ok: false, error: "CANCELED" });
  });

  it("预留结束后若授权或会话已失效，会回滚预算且不提交适配器", async () => {
    const translate = vi.fn();
    const releaseReservedCharacters = vi.fn().mockResolvedValue(undefined);
    const validate = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const scheduler = createTranslationScheduler({
      adapter: { id: "fake", version: "test-v1", translate },
      usage: { snapshot: vi.fn().mockResolvedValue({ settings: { plan: "advanced", monthlyCharacterBudget: 10 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 10 }), reserveBeforeSubmit: vi.fn().mockResolvedValue({ ok: true, snapshot: { periodKey: "2026-09" } }), releaseReservedCharacters },
      now: () => 0,
    });
    await expect(scheduler.enqueue(task("revoked"), { validate, preflight: vi.fn().mockResolvedValue({ ok: true }) })).resolves.toMatchObject({ ok: false, error: "SESSION_UNAVAILABLE" });
    expect(releaseReservedCharacters).toHaveBeenCalledWith(2, "2026-09");
    expect(translate).not.toHaveBeenCalled();
  });

  it("Baidu 页面在共享 QPS 门后不再等待凭据 I/O，记录的起点就是 transport 起点", async () => {
    let clock = 0;
    let transportStartedAt = -1;
    const wait = vi.fn(async (milliseconds: number) => { clock += milliseconds; });
    const submissionGate = createBaiduSubmissionGate({ now: () => clock, wait });
    const output = { translatedText: "fixture", sourceLanguage: "auto" as const, targetLanguage: "zh" as const, adapter: "baidu" as const };
    const adapter = {
      id: "baidu" as const,
      version: "baidu-test",
      // The fallback path models an adapter that reads credentials after the
      // gate. The scheduler must instead prepare the submit closure first.
      translate: vi.fn(async () => { clock += 600; transportStartedAt = clock; return output; }),
      prepareSubmission: vi.fn(async () => {
        clock += 600;
        return async () => { transportStartedAt = clock; return output; };
      }),
    };
    const scheduler = createTranslationScheduler({
      adapter,
      usage: {
        snapshot: vi.fn().mockResolvedValue({ settings: { plan: "standard", monthlyCharacterBudget: 100 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 100 }),
        reserveBeforeSubmit: vi.fn().mockResolvedValue({ ok: true, snapshot: { periodKey: "2026-09" } }),
        releaseReservedCharacters: vi.fn(),
      },
      submissionGate,
      now: () => clock,
      wait,
    });

    await expect(scheduler.enqueue(task("prepared-submit"))).resolves.toMatchObject({ ok: true });
    expect(transportStartedAt).toBe(600);
    await submissionGate.waitForTurn("standard");
    expect(wait).toHaveBeenCalledWith(1_000);
    expect(adapter.prepareSubmission).toHaveBeenCalledOnce();
    expect(adapter.translate).not.toHaveBeenCalled();
  });

  it("同一稳定内容块的两次请求均计入本地 Unicode 字符预算", async () => {
    const values: Record<string, unknown> = {};
    const usage = createTranslationUsageController({ storage: { get: async (key) => ({ [key]: values[key] }), set: async (next) => { Object.assign(values, next); } }, now: () => new Date("2026-09-10T00:00:00.000Z") });
    await usage.handle({ type: "translation-usage.update", payload: { plan: "advanced", monthlyCharacterBudget: 10 } }, { url: "chrome-extension://id/options.html" }, "id");
    let now = 0;
    const scheduler = createTranslationScheduler({
      adapter: { id: "fake", version: "test-v1", translate: vi.fn().mockResolvedValue({ translatedText: "固定译文", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" }) },
      usage,
      now: () => now,
      wait: async () => { now += 100; },
    });
    await scheduler.enqueue({ ...task("first"), blockId: "stable-block" });
    await scheduler.enqueue({ ...task("retry"), blockId: "stable-block" });
    await expect(usage.snapshot()).resolves.toMatchObject({ submittedCharacters: 4, remainingCharacters: 6 });
  });

  it("标准版拒绝无法再安全拆分的超长 Unicode 原子段，且零供应商提交", async () => {
    const translate = vi.fn().mockResolvedValue({ translatedText: "不应出现", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" });
    const reserveBeforeSubmit = vi.fn().mockResolvedValue({ ok: true, snapshot: { periodKey: "2026-09" } });
    const scheduler = createTranslationScheduler({
      adapter: { id: "fake", version: "test-v1", translate },
      usage: {
        snapshot: vi.fn().mockResolvedValue({ settings: { plan: "standard", monthlyCharacterBudget: 2_000 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 2_000 }),
        reserveBeforeSubmit,
        releaseReservedCharacters: vi.fn(),
      },
    });

    await expect(scheduler.enqueue(task("atomic-too-long", "😀".repeat(1_001)))).resolves.toMatchObject({
      ok: false,
      error: "TEXT_TOO_LONG",
    });
    expect(reserveBeforeSubmit).not.toHaveBeenCalled();
    expect(translate).not.toHaveBeenCalled();
  });

  it("后段含不可拆超长句时整块在任何提交前失败", async () => {
    const translate = vi.fn();
    const reserveBeforeSubmit = vi.fn();
    const scheduler = createTranslationScheduler({ adapter: { id: "fake", version: "test-v1", translate }, usage: { snapshot: vi.fn().mockResolvedValue({ settings: { plan: "standard", monthlyCharacterBudget: 3_000 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 3_000 }), reserveBeforeSubmit, releaseReservedCharacters: vi.fn() } });
    await expect(scheduler.enqueue(task("mixed-atomic", `${"可安全的第一句。".repeat(120)}${"😀".repeat(1_001)}`))).resolves.toMatchObject({ ok: false, error: "TEXT_TOO_LONG" });
    expect(reserveBeforeSubmit).not.toHaveBeenCalled();
    expect(translate).not.toHaveBeenCalled();
  });

  it("无空格 CJK 句子和段落在乱序完成后按原顺序合并", async () => {
    const source = `${"第一句。".repeat(1_500)}第二句。\n\n第三段。`;
    const releases: Array<() => void> = [];
    const translate = vi.fn((input: { text: string }) => new Promise<{ translatedText: string; sourceLanguage: "auto"; targetLanguage: "zh"; adapter: "fake" }>((resolve) => releases.push(() => resolve({ translatedText: input.text.startsWith("第一句") ? "译文甲" : input.text.startsWith("第二句") ? "译文乙" : "译文丙", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" }))));
    const scheduler = createTranslationScheduler({ adapter: { id: "fake", version: "test-v1", translate }, usage: { snapshot: vi.fn().mockResolvedValue({ settings: { plan: "advanced", monthlyCharacterBudget: 10_000 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 10_000 }), reserveBeforeSubmit: vi.fn().mockResolvedValue({ ok: true, snapshot: { periodKey: "2026-09" } }), releaseReservedCharacters: vi.fn() } });
    const result = scheduler.enqueue(task("ordered", source));
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    releases.reverse().forEach((release) => release());
    await expect(result).resolves.toMatchObject({ ok: true, output: { translatedText: "译文甲译文乙\n\n译文丙" } });
  });

  it("跨父长文本的实际 adapter 调用峰值不超过当前套餐并发", async () => {
    let active = 0;
    let peak = 0;
    let now = 0;
    const releases: Array<() => void> = [];
    const adapter = { id: "fake" as const, version: "test-v1", translate: vi.fn(() => new Promise<{ translatedText: string; sourceLanguage: "auto"; targetLanguage: "zh"; adapter: "fake" }>((resolve) => { active += 1; peak = Math.max(peak, active); releases.push(() => { active -= 1; resolve({ translatedText: "译", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" }); }); })) };
    const scheduler = createTranslationScheduler({ adapter, usage: { snapshot: vi.fn().mockResolvedValue({ settings: { plan: "advanced", monthlyCharacterBudget: 100_000 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 100_000 }), reserveBeforeSubmit: vi.fn().mockResolvedValue({ ok: true, snapshot: { periodKey: "2026-09" } }), releaseReservedCharacters: vi.fn() }, now: () => now, wait: async () => { now += 100; } });
    const long = `${"Sentence. ".repeat(1_500)}Tail.`;
    const results = ["a", "b", "c", "d"].map((id) => scheduler.enqueue(task(id, long)));
    await vi.waitFor(() => expect(releases).toHaveLength(10));
    expect(peak).toBe(10);
    for (let index = 0; index < 12; index += 1) {
      await vi.waitFor(() => expect(releases.length).toBeGreaterThan(0));
      releases.shift()?.();
    }
    await Promise.all(results);
    expect(peak).toBeLessThanOrEqual(10);
    expect(adapter.translate).toHaveBeenCalledTimes(12);
  });

  it("标准版跨父片段的实际 adapter 峰值严格为一", async () => {
    let active = 0; let peak = 0; let now = 0;
    const releases: Array<() => void> = [];
    const adapter = { id: "fake" as const, version: "test-v1", translate: vi.fn(() => new Promise<{ translatedText: string; sourceLanguage: "auto"; targetLanguage: "zh"; adapter: "fake" }>((resolve) => { active += 1; peak = Math.max(peak, active); releases.push(() => { active -= 1; resolve({ translatedText: "译", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" }); }); })) };
    const scheduler = createTranslationScheduler({ adapter, usage: { snapshot: vi.fn().mockResolvedValue({ settings: { plan: "standard", monthlyCharacterBudget: 10_000 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 10_000 }), reserveBeforeSubmit: vi.fn().mockResolvedValue({ ok: true, snapshot: { periodKey: "2026-09" } }), releaseReservedCharacters: vi.fn() }, now: () => now, wait: async () => { now += 1_000; } });
    const results = ["one", "two"].map((id) => scheduler.enqueue(task(id, `${"Sentence. ".repeat(120)}Tail.`)));
    for (let index = 0; index < 4; index += 1) { await vi.waitFor(() => expect(releases.length).toBeGreaterThan(0)); expect(peak).toBe(1); releases.shift()?.(); }
    await Promise.all(results);
    expect(adapter.translate).toHaveBeenCalledTimes(4);
  });

  it("CRLF、引号、& 与 emoji 的长文本合并后保留手写段落边界", async () => {
    const source = `${'“A & 😀.” '.repeat(100)}\r\n\r\n“B & 😀.”`;
    const replies = ["甲", "乙"];
    const scheduler = createTranslationScheduler({ adapter: { id: "fake", version: "test-v1", translate: vi.fn((input: { text: string }) => Promise.resolve({ translatedText: input.text.includes("B &") ? replies[1]! : replies[0]!, sourceLanguage: "auto" as const, targetLanguage: "zh" as const, adapter: "fake" as const })) }, usage: { snapshot: vi.fn().mockResolvedValue({ settings: { plan: "standard", monthlyCharacterBudget: 10_000 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 10_000 }), reserveBeforeSubmit: vi.fn().mockResolvedValue({ ok: true, snapshot: { periodKey: "2026-09" } }), releaseReservedCharacters: vi.fn() }, now: (() => { let now = 0; return () => (now += 1_000); })() });
    await expect(scheduler.enqueue(task("special", source))).resolves.toMatchObject({ ok: true, output: { translatedText: "甲\n\n乙" } });
  });
});
