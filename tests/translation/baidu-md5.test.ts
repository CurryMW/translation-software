import { describe, expect, it } from "vitest";
import { baiduMd5Hex } from "../../src/background/baidu-md5";

describe("百度 MD5 签名", () => {
  it("对官方固定向量生成 32 位小写摘要", () => {
    expect(baiduMd5Hex("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(baiduMd5Hex("2015063000000001apple143566028812345678")).toBe("f89f9594663708c1605f3d736d01d2d4");
  });

  it("以 UTF-8 编码非 ASCII 原文，并正确处理超过单个 MD5 block 的输入", () => {
    expect(baiduMd5Hex("中文")).toBe("a7bac2239fcdcb3a067903d8077c4a07");
    expect(baiduMd5Hex("1234567890".repeat(8))).toBe("57edf4a22be3c955ac49da2e2107b67a");
  });
});
