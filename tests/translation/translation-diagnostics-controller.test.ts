import { describe, expect, it } from "vitest";
import { createTranslationDiagnosticsController } from "../../src/background/translation-diagnostics-controller";

describe("供应商故障脱敏诊断", () => {
  it("只持久化脱敏类别、供应商码和时间，且以固定上限替换最旧记录", async () => {
    const values: Record<string, unknown> = {};
    const controller = createTranslationDiagnosticsController({
      storage: {
        get: async (key) => ({ [key]: values[key] }),
        set: async (next) => { Object.assign(values, next); },
      },
      now: () => 1_700_000_000_000,
      maximumEntries: 2,
    });

    await controller.record({ error: "NETWORK_ERROR", providerCode: "E_CONN" });
    await controller.record({ error: "TIMEOUT", providerCode: "timeout; hidden source text must never persist" });
    await controller.record({ error: "RATE_LIMITED", providerCode: "54003" });

    expect(values).toEqual({
      translationProviderDiagnostics: [
        { category: "TIMEOUT", occurredAt: 1_700_000_000_000 },
        { category: "RATE_LIMITED", providerCode: "54003", occurredAt: 1_700_000_000_000 },
      ],
    });
    expect(JSON.stringify(values)).not.toContain("hidden source text");
    expect(JSON.stringify(values)).not.toContain("message");
    expect(JSON.stringify(values)).not.toContain("stack");
  });

  it("诊断存储失败被本地吞没，不向翻译调用路径传播拒绝", async () => {
    const controller = createTranslationDiagnosticsController({
      storage: { get: async () => { throw new Error("storage unavailable"); }, set: async () => undefined },
      now: () => Number.NaN,
    });

    await expect(controller.record({ error: "NETWORK_ERROR" })).resolves.toBeUndefined();
  });
});
