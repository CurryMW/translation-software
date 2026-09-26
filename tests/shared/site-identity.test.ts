import { describe, expect, it } from "vitest";
import { siteIdentityFromUrl } from "../../src/shared/site-identity";

describe("脱敏网站身份", () => {
  it("仅从 HTTP(S) URL 提取域名和 host-permission 匹配模式", () => {
    expect(siteIdentityFromUrl("https://article.example.test:8443/path?token=secret#fragment")).toEqual({
      domain: "article.example.test",
      origin: "https://article.example.test/*",
    });
    expect(siteIdentityFromUrl("http://127.0.0.1:4567/embedded")).toEqual({
      domain: "127.0.0.1",
      origin: "http://127.0.0.1/*",
    });
  });

  it("拒绝非网页 URL 或无法解析的值", () => {
    expect(siteIdentityFromUrl("chrome://settings/")).toBeUndefined();
    expect(siteIdentityFromUrl("not a URL")).toBeUndefined();
    expect(siteIdentityFromUrl(undefined)).toBeUndefined();
  });
});
