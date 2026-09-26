import { describe, expect, it, vi } from "vitest";
import { createPageCompatibilityGuard } from "../../src/content/page-compatibility-guard";

describe("页面兼容性回退行为接缝", () => {
  it("页面级异常只回退一次：移除扩展 UI、取消等待并暂停会话", () => {
    const removeUi = vi.fn();
    const cancelPending = vi.fn();
    const pauseSession = vi.fn();
    const notify = vi.fn();
    const guard = createPageCompatibilityGuard({ removeUi, cancelPending, pauseSession, notify });

    expect(guard.report("layout-breakage")).toBe(true);
    expect(guard.report("scroll-breakage")).toBe(false);
    expect(removeUi).toHaveBeenCalledTimes(1);
    expect(cancelPending).toHaveBeenCalledTimes(1);
    expect(pauseSession).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("layout-breakage");
    expect(guard.isPaused()).toBe(true);
  });
});
