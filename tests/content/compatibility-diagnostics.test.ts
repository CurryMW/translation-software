import { describe, expect, it } from "vitest";
import { createCompatibilityDiagnostics } from "../../src/content/compatibility-diagnostics";

describe("当前页面会话兼容性诊断行为接缝", () => {
  it("只保留当前会话的脱敏计数和错误类别，不保留正文、账号或完整 URL", () => {
    const diagnostics = createCompatibilityDiagnostics();

    diagnostics.record("block-skipped", "unsafe-context", { text: "secret article", url: "https://user:password@example.test/private" });
    diagnostics.record("page-fallback", "layout-breakage", { text: "secret article", url: "https://example.test/private" });
    diagnostics.record("page-fallback", "not-a-known-error", { text: "another secret" });

    expect(diagnostics.snapshot()).toEqual({
      counts: { "block-skipped": 1, "page-fallback": 2 },
      errors: { "unsafe-context": 1, "layout-breakage": 1 },
    });
    expect(JSON.stringify(diagnostics.snapshot())).not.toContain("secret");
    expect(JSON.stringify(diagnostics.snapshot())).not.toContain("example.test");
    diagnostics.reset();
    expect(diagnostics.snapshot()).toEqual({ counts: {}, errors: {} });
  });
});
