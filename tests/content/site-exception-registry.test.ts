// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createSiteExceptionRegistry, siteExceptionStrategyForDocument, type SiteExceptionRecord } from "../../src/shared/site-exception-registry";

const fixture: SiteExceptionRecord = {
  id: "synthetic-feed",
  domain: "feed.example.test",
  trigger: "data-fixture-feed-root is present",
  reason: "The host wraps readable entries in a non-semantic container.",
  fixture: "tests/manual-fixtures/synthetic-feed.html",
  fallback: "If the marker is absent, skip the region and keep generic discovery disabled.",
  reviewTrigger: "host DOM migration or generic discovery change",
  enabled: true,
  triggerSelector: "[data-fixture-site-exception]",
};

describe("站点特例注册表行为接缝", () => {
  it("独立启用特例，命中域名和可靠触发条件后才返回特例", () => {
    const registry = createSiteExceptionRegistry([fixture]);

    expect(registry.resolve("FEED.EXAMPLE.TEST", { triggerMatched: true, genericSafetyPassed: false })).toEqual(fixture);
    expect(registry.resolve("other.example.test", { triggerMatched: true, genericSafetyPassed: false })).toBeUndefined();
  });

  it("特例失效时只在通用安全检查通过后回到通用策略，否则安全跳过", () => {
    const registry = createSiteExceptionRegistry([fixture]);

    expect(registry.strategy("feed.example.test", { triggerMatched: false, genericSafetyPassed: true })).toBe("generic");
    expect(registry.strategy("feed.example.test", { triggerMatched: false, genericSafetyPassed: false })).toBe("skip");
    registry.setEnabled("synthetic-feed", false);
    expect(registry.resolve("feed.example.test", { triggerMatched: true, genericSafetyPassed: true })).toBeUndefined();
  });

  it("文档触发器通过公开 seam 接入策略，失效时不污染通用扫描器", () => {
    const registry = createSiteExceptionRegistry([fixture]);
    document.body.innerHTML = '<div data-fixture-site-exception></div>';
    expect(siteExceptionStrategyForDocument(registry, document, "feed.example.test", false)).toBe("exception");
    document.body.innerHTML = "";
    expect(siteExceptionStrategyForDocument(registry, document, "feed.example.test", true)).toBe("generic");
    expect(siteExceptionStrategyForDocument(registry, document, "feed.example.test", false)).toBe("skip");
  });

  it("维护者误填 selector 时安全回退，不让 querySelector 异常中断扫描", () => {
    const registry = createSiteExceptionRegistry([{ ...fixture, id: "invalid-selector", triggerSelector: "[" }]);
    expect(siteExceptionStrategyForDocument(registry, document, "feed.example.test", false)).toBe("skip");
  });
});
