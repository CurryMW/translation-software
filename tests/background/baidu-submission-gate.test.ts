import { describe, expect, it, vi } from "vitest";
import { createBaiduSubmissionGate } from "../../src/background/baidu-submission-gate";

describe("百度跨运行时提交起点门", () => {
  it("标准版页面起点会限制随后人工烟囱，即使前一请求已中止也不抹掉该起点", async () => {
    let clock = 0;
    const wait = vi.fn(async (milliseconds: number) => { clock += milliseconds; });
    const gate = createBaiduSubmissionGate({ now: () => clock, wait });

    // Represents a page request whose POST has already started. Whether it
    // later aborts is intentionally outside this gate and cannot erase time.
    await gate.waitForTurn("standard");
    await gate.waitForTurn("standard");

    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(1_000);
  });

  it("同一门也限制 smoke 后新 runtime 的页面请求，并按当前套餐限速", async () => {
    let clock = 100;
    const wait = vi.fn(async (milliseconds: number) => { clock += milliseconds; });
    const gate = createBaiduSubmissionGate({ now: () => clock, wait });

    await gate.waitForTurn("advanced");
    await gate.waitForTurn("advanced");

    expect(wait).toHaveBeenCalledWith(100);
  });
});
