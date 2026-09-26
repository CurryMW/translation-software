import { describe, expect, it, vi } from "vitest";
import { createWorkerBootstrapGate } from "../../src/background/worker-bootstrap-gate";

describe("worker bootstrap gate", () => {
  it("readiness 恢复尚未完成时不建立页面停留或提交翻译，恢复后才使用已恢复 provider", async () => {
    let completeRestore: (() => void) | undefined;
    let provider = "fake";
    const gate = createWorkerBootstrapGate(async () => {
      await new Promise<void>((resolve) => { completeRestore = resolve; });
      provider = "baidu";
    });
    const createStay = vi.fn(() => provider);
    const submitTranslation = vi.fn(() => provider);

    const waitingStay = gate.runIfReady(createStay);
    const waitingTranslation = gate.runIfReady(submitTranslation);
    await Promise.resolve();
    expect(createStay).not.toHaveBeenCalled();
    expect(submitTranslation).not.toHaveBeenCalled();

    completeRestore?.();
    await expect(waitingStay).resolves.toEqual({ ready: true, value: "baidu" });
    await expect(waitingTranslation).resolves.toEqual({ ready: true, value: "baidu" });
  });

  it("bootstrap 失败时 fail closed，绝不执行页面或翻译动作", async () => {
    const gate = createWorkerBootstrapGate(async () => { throw new Error("local bootstrap failure"); });
    const unsafeAction = vi.fn();

    await expect(gate.runIfReady(unsafeAction)).resolves.toEqual({ ready: false });
    expect(unsafeAction).not.toHaveBeenCalled();
  });
});
