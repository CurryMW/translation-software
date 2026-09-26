import { describe, expect, it, vi } from "vitest";
import { createTranslationAppearanceController } from "../../src/background/translation-appearance-controller";

function storage(initial: Record<string, unknown> = {}) {
  const values = { ...initial };
  return {
    get: vi.fn(async (key: string) => ({ [key]: values[key] })),
    set: vi.fn(async (next: Record<string, unknown>) => { Object.assign(values, next); }),
  };
}

describe("译文显示样式控制器", () => {
  it("未配置时返回跟随网页主题，并可由设置页保存预设颜色", async () => {
    const backing = storage();
    const controller = createTranslationAppearanceController({ storage: backing });

    await expect(controller.handle({ type: "translation-appearance.get" }, { url: "https://example.test/article" }, "ext")).resolves.toEqual({ ok: true, settings: { textColor: "adaptive" } });
    await expect(controller.handle({ type: "translation-appearance.update", payload: { textColor: "purple" } }, { url: "chrome-extension://ext/options.html" }, "ext")).resolves.toEqual({ ok: true, settings: { textColor: "purple" } });
    expect(backing.set).toHaveBeenCalledWith({ translationAppearanceSettings: { textColor: "purple" } });
  });

  it("不允许网页或其他扩展页面修改颜色", async () => {
    const controller = createTranslationAppearanceController({ storage: storage() });

    await expect(controller.handle({ type: "translation-appearance.update", payload: { textColor: "rose" } }, { url: "https://example.test" }, "ext")).resolves.toEqual({ ok: false, error: "UNTRUSTED_SENDER" });
    await expect(controller.handle({ type: "translation-appearance.update", payload: { textColor: "rose" } }, { url: "chrome-extension://ext/popup.html" }, "ext")).resolves.toEqual({ ok: false, error: "UNTRUSTED_SENDER" });
  });
});
