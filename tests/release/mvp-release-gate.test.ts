import {
  MVP_SAMPLE_INDEX,
  RELEASE_GATE_CHECKS,
  evaluateMvpReleaseGate,
  summarizeMvpSamples,
} from "../../src/shared/mvp-release-gate";
import { describe, expect, it } from "vitest";

describe("MVP 放行门槛公开接缝", () => {
  it("固定样本索引严格覆盖规格要求的 30 个样本组成", () => {
    expect(MVP_SAMPLE_INDEX).toHaveLength(30);
    expect(summarizeMvpSamples(MVP_SAMPLE_INDEX)).toEqual({
      total: 30,
      english: 18,
      mixed: 4,
      long: 4,
      japanese: 2,
      korean: 1,
      spanish: 1,
    });
    expect(new Set(MVP_SAMPLE_INDEX.map(sample => sample.id)).size).toBe(30);
    expect(MVP_SAMPLE_INDEX.every(sample => sample.targetLanguage === "zh")).toBe(true);
  });

  it("依赖票据、真实百度烟囱和四站人工检查未完成时保持 pending", () => {
    const result = evaluateMvpReleaseGate(RELEASE_GATE_CHECKS);

    expect(result.status).toBe("pending");
    expect(result.blockers).toEqual(expect.arrayContaining([
      "core-sites-manual-acceptance",
      "baidu-real-smoke",
      "ticket-26-dependency",
    ]));
    expect(result.blockers).not.toContain("claim-real-baidu-passed");
  });

  it("只有所有 required 检查显式 pass 才能进入 ready", () => {
    const allPassed = RELEASE_GATE_CHECKS.map(check => ({ ...check, status: "pass" as const }));

    expect(evaluateMvpReleaseGate(allPassed)).toEqual({ status: "ready", blockers: [] });
  });
});
