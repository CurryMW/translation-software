// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountInPageTranslation } from "../../src/content/in-page-translation-root";

afterEach(() => { document.documentElement.innerHTML = ""; });

describe("页内译文 React 协调器", () => {
  it("为多个内容块协调渲染时只建立一个文档级 React 根", () => {
    document.body.innerHTML = "<p id='first'>First block.</p><p id='second'>Second block.</p>";
    const first = mountInPageTranslation(document.querySelector<HTMLElement>("#first")!);
    const second = mountInPageTranslation(document.querySelector<HTMLElement>("#second")!);
    first.renderLoading();
    second.renderLoading();

    expect(document.querySelectorAll("[data-web-translation-react-coordinator]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-web-translation-translation='root']")).toHaveLength(2);
  });

  it("预算耗尽状态提供直接打开设置页的操作", async () => {
    document.body.innerHTML = "<p id='source'>Source.</p>";
    const openSettings = vi.fn();
    const renderer = mountInPageTranslation(document.querySelector<HTMLElement>("#source")!);
    renderer.renderBudgetExhausted(openSettings);
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>("[data-web-translation-translation='root']")?.shadowRoot?.querySelector<HTMLButtonElement>("button")?.textContent).toContain("打开设置"));
    const button = document.querySelector<HTMLElement>("[data-web-translation-translation='root']")?.shadowRoot?.querySelector<HTMLButtonElement>("button");
    button?.click();
    expect(openSettings).toHaveBeenCalledOnce();
  });

  it("块级可恢复故障显示简洁原因并只从该内容块重新发起操作", async () => {
    document.body.innerHTML = "<p id='source'>Source.</p>";
    const retry = vi.fn();
    const renderer = mountInPageTranslation(document.querySelector<HTMLElement>("#source")!);
    renderer.renderFailure("RATE_LIMITED", retry);

    await vi.waitFor(() => expect(document.querySelector<HTMLElement>("[data-web-translation-translation='root']")?.shadowRoot?.textContent).toContain("翻译请求过于频繁"));
    const button = document.querySelector<HTMLElement>("[data-web-translation-translation='root']")?.shadowRoot?.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toBe("重试此内容块");
    button?.click();
    expect(retry).toHaveBeenCalledOnce();
  });
});
