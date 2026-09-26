import { describe, expect, it, vi } from "vitest";
import { BAIDU_PROVIDER_ORIGIN_PATTERN } from "../../src/shared/baidu-provider";
import { chromeBaiduProviderPermissionClient } from "../../src/shared/baidu-provider-permission-client";

describe("百度服务权限客户端", () => {
  it("在显式点击调用时同步请求唯一的 provider origin，绝不先 await 查询权限", async () => {
    const order: string[] = [];
    const request = vi.fn(() => {
      order.push("request");
      return Promise.resolve(true);
    });
    const contains = vi.fn(async () => {
      order.push("contains");
      return true;
    });
    vi.stubGlobal("chrome", { permissions: { request, contains } });

    const result = chromeBaiduProviderPermissionClient.ensure();

    expect(order).toEqual(["request"]);
    await expect(result).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith({ origins: [BAIDU_PROVIDER_ORIGIN_PATTERN] });
    expect(contains).not.toHaveBeenCalled();
  });
});
