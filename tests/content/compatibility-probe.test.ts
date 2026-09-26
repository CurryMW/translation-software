// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createCompatibilityProbe, detectCompatibilityProbeFailure } from "../../src/content/compatibility-probe";

function setMetric(element: Element, name: "scrollWidth" | "clientWidth", value: number): void {
  Object.defineProperty(element, name, { configurable: true, value });
}

function setRect(element: Element, rect: Partial<DOMRect>): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40, ...rect }),
  });
}

describe("页面兼容性探测", () => {
  it("检测新增横向溢出和扩展 UI 覆盖交互控件", () => {
    const root = document.documentElement;
    setMetric(root, "clientWidth", 100);
    setMetric(root, "scrollWidth", 100);
    const before = { scrollWidth: 100, clientWidth: 100, overflowX: "visible", overflowY: "visible" };
    setMetric(root, "scrollWidth", 140);
    expect(detectCompatibilityProbeFailure(document, before)).toBe("layout-breakage");

    document.body.innerHTML = '<button id="host">Host action</button><div data-web-translation-translation="root"></div>';
    setMetric(root, "scrollWidth", 100);
    const button = document.querySelector("button")!;
    const overlay = document.querySelector("[data-web-translation-translation]")!;
    setRect(button, { left: 0, top: 0, right: 100, bottom: 40 });
    setRect(overlay, { left: 0, top: 0, right: 100, bottom: 40 });
    const shadow = overlay.attachShadow({ mode: "open" });
    const fixedPrompt = document.createElement("section");
    fixedPrompt.style.position = "fixed";
    setRect(fixedPrompt, { left: 0, top: 0, right: 100, bottom: 40 });
    shadow.append(fixedPrompt);
    expect(detectCompatibilityProbeFailure(document, { ...before, scrollWidth: 100 })).toBe("interaction-breakage");
  });

  it("不把正常文档流中的译文按钮误判为交互遮挡", () => {
    document.body.innerHTML = '<button id="host">Host action</button><div data-web-translation-translation="root"></div>';
    const root = document.documentElement;
    setMetric(root, "scrollWidth", 100);
    const before = { scrollWidth: 100, clientWidth: 100, overflowX: "visible", overflowY: "visible" };
    const button = document.querySelector("button")!;
    const translation = document.querySelector("[data-web-translation-translation]")!;
    setRect(button, { left: 0, top: 0, right: 100, bottom: 40 });
    setRect(translation, { left: 0, top: 0, right: 100, bottom: 40 });
    const shadow = translation.attachShadow({ mode: "open" });
    const inlineToggle = document.createElement("button");
    setRect(inlineToggle, { left: 0, top: 0, right: 100, bottom: 40 });
    shadow.append(inlineToggle);
    expect(detectCompatibilityProbeFailure(document, { ...before, scrollWidth: 100 })).toBeUndefined();
  });

  it("MutationObserver 只上报一次并可停止观察", async () => {
    const report = vi.fn();
    const root = document.documentElement;
    setMetric(root, "clientWidth", 100);
    setMetric(root, "scrollWidth", 100);
    const probe = createCompatibilityProbe({ document, report });
    setMetric(root, "scrollWidth", 140);
    document.body.append(document.createElement("p"));
    await Promise.resolve();
    await Promise.resolve();
    expect(report).not.toHaveBeenCalled();
    const extensionHost = document.createElement("div");
    extensionHost.dataset.webTranslationTranslation = "root";
    document.body.append(extensionHost);
    await Promise.resolve();
    await Promise.resolve();
    expect(report).toHaveBeenCalledWith("layout-breakage");
    expect(report).toHaveBeenCalledTimes(1);
    probe.stop();
    document.body.append(document.createElement("p"));
    await Promise.resolve();
    expect(report).toHaveBeenCalledTimes(1);
  });
});
