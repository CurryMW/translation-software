import { describe, expect, it } from "vitest";
import { isTopLevelContentFrame } from "../../src/content/frame-context";

describe("frame 会话呈现边界", () => {
  it("只有 top frame 可以呈现本次停留确认；子 frame 必须静默等待同一 tab 的 descriptor 广播", () => {
    const topFrame = {} as { top?: unknown; self?: unknown };
    topFrame.top = topFrame;
    topFrame.self = topFrame;
    const childFrame = { top: topFrame, self: {} };

    expect(isTopLevelContentFrame(topFrame)).toBe(true);
    expect(isTopLevelContentFrame(childFrame)).toBe(false);
  });
});
