import { describe, expect, it, vi } from "vitest";
import { createProviderRuntimeManager } from "../../src/background/provider-runtime";
import { createTranslationScheduler } from "../../src/background/translation-scheduler";
import type { TranslationServiceAdapter } from "../../src/shared/translation";

describe("provider-bound worker runtime", () => {
  it("在旧任务通过异步校验后切换服务时，旧任务仍只会调用旧 concrete adapter", async () => {
    const fake = { id: "fake" as const, version: "fake-v1", translate: vi.fn().mockResolvedValue({ translatedText: "fixture", sourceLanguage: "auto", targetLanguage: "zh", adapter: "fake" as const }) };
    const baidu = { id: "baidu" as const, version: "baidu-v1", translate: vi.fn().mockResolvedValue({ translatedText: "fixture", sourceLanguage: "auto", targetLanguage: "zh", adapter: "baidu" as const }) };
    const usage = {
      snapshot: async () => ({ settings: { plan: "standard" as const, monthlyCharacterBudget: 300 }, periodKey: "2026-09", submittedCharacters: 0, remainingCharacters: 300 }),
      reserveBeforeSubmit: async () => ({ ok: true as const, snapshot: { periodKey: "2026-09" } }),
      releaseReservedCharacters: async () => undefined,
    };
    const runtimes = createProviderRuntimeManager({
      fake,
      baidu,
      create: (adapter: TranslationServiceAdapter) => ({ adapter, scheduler: createTranslationScheduler({ adapter, usage }) }),
    });
    let releaseValidation: ((allowed: boolean) => void) | undefined;
    let firstValidation = true;
    const validation = vi.fn(() => {
      if (!firstValidation) return Promise.resolve(true);
      firstValidation = false;
      return new Promise<boolean>((resolve) => { releaseValidation = resolve; });
    });
    const oldRuntime = runtimes.current();
    const pending = oldRuntime.scheduler.enqueue(
      { requestId: "old-request", blockId: "old-block", text: "fixture", sourceLanguage: "auto", targetLanguage: "zh" },
      { validate: validation },
    );
    await vi.waitFor(() => expect(validation).toHaveBeenCalledOnce());

    runtimes.publish(runtimes.create(baidu));
    releaseValidation?.(true);

    await expect(pending).resolves.toMatchObject({ ok: true, output: { adapter: "fake" } });
    expect(fake.translate).toHaveBeenCalledOnce();
    expect(baidu.translate).not.toHaveBeenCalled();
  });
});
