import { describe, expect, it, vi } from "vitest";
import { createWorkerSafetyOperationQueue } from "../../src/background/worker-safety-operation-queue";

describe("worker 安全操作队列", () => {
  it("将人工 smoke、凭据和套餐变更串行化，避免在核对与提交之间交错", async () => {
    let releaseFirst: (() => void) | undefined;
    const queue = createWorkerSafetyOperationQueue();
    const first = vi.fn(() => new Promise<string>((resolve) => { releaseFirst = () => resolve("first"); }));
    const second = vi.fn().mockResolvedValue("second");

    const pendingFirst = queue.run(first);
    const pendingSecond = queue.run(second);
    await Promise.resolve();
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();

    releaseFirst?.();
    await expect(pendingFirst).resolves.toBe("first");
    await expect(pendingSecond).resolves.toBe("second");
    expect(second).toHaveBeenCalledOnce();
  });
});
