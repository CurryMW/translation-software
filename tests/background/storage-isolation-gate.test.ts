import { describe, expect, it, vi } from "vitest";
import { createStorageIsolationGate } from "../../src/background/storage-isolation-gate";

describe("存储隔离启动门禁", () => {
  it("设为可信上下文失败时 fail-closed，不运行设置、翻译、凭据或注册动作", async () => {
    const setTrustedContexts = vi.fn().mockRejectedValue(new Error("存储访问级别不可用"));
    const protectedAction = vi.fn();
    const gate = createStorageIsolationGate({ setTrustedContexts });

    await expect(gate.runIfReady(protectedAction)).resolves.toBe(false);

    expect(setTrustedContexts).toHaveBeenCalledTimes(1);
    expect(protectedAction).not.toHaveBeenCalled();
  });

  it("隔离成功后仅执行一次初始化，且允许受保护动作", async () => {
    const setTrustedContexts = vi.fn().mockResolvedValue(undefined);
    const firstAction = vi.fn();
    const secondAction = vi.fn();
    const gate = createStorageIsolationGate({ setTrustedContexts });

    await expect(gate.runIfReady(firstAction)).resolves.toBe(true);
    await expect(gate.runIfReady(secondAction)).resolves.toBe(true);

    expect(setTrustedContexts).toHaveBeenCalledTimes(1);
    expect(firstAction).toHaveBeenCalledTimes(1);
    expect(secondAction).toHaveBeenCalledTimes(1);
  });

  it("受保护动作自身失败也返回安全失败，不形成未处理拒绝", async () => {
    const gate = createStorageIsolationGate({ setTrustedContexts: vi.fn().mockResolvedValue(undefined) });

    await expect(gate.runIfReady(async () => { throw new Error("注册失败"); })).resolves.toBe(false);
  });
});
