import { describe, expect, it } from "vitest";
import { classifyStaticContentLanguage } from "../../src/content/language-policy";

describe("静态内容语言策略行为接缝", () => {
  it.each([
    ["英语", "A readable English sentence about translation.", "zh", { kind: "translate", sourceLanguage: "auto" }],
    ["日语", "これは読みやすい日本語の文章です。", "zh", { kind: "translate", sourceLanguage: "auto" }],
    ["韩语", "이것은 읽을 수 있는 한국어 문장입니다.", "zh", { kind: "translate", sourceLanguage: "auto" }],
    ["西班牙语", "Esta es una oración española legible.", "zh", { kind: "translate", sourceLanguage: "auto" }],
    ["已是目标语言", "这是一段已经是目标语言的内容。", "zh", { kind: "skip", reason: "same-target-language" }],
    ["无法可靠识别的拉丁文字", "Bonjour monde", "zh", { kind: "translate", sourceLanguage: "auto" }],
  ] as const)("%s 的自动处理结果可由调用方直接观察", (_name, text, targetLanguage, expected) => {
    expect(classifyStaticContentLanguage(text, targetLanguage)).toMatchObject(expected);
  });

  it("中英混合以已识别语言证据的约 30% 阈值决定是否自动翻译，不把任意拉丁字符当英语", () => {
    expect(classifyStaticContentLanguage("这是 English words clearly mixed into Chinese 内容。", "zh")).toMatchObject({
      kind: "translate",
      sourceLanguage: "auto",
    });
    expect(classifyStaticContentLanguage("这是 x 内容。", "zh")).toMatchObject({ kind: "skip", reason: "same-target-language" });
  });

  it("用已识别的英语词汇在 30% 阈值两侧校准中文目标的自动提交", () => {
    expect(classifyStaticContentLanguage("这是一段用于校准混合语言翻译阈值的中文阅读内容，其中包含 Read。", "zh")).toEqual({
      kind: "skip",
      reason: "same-target-language",
    });
    expect(classifyStaticContentLanguage("这是一段清晰的中文阅读内容用于校准。 Read this", "zh")).toEqual({
      kind: "translate",
      sourceLanguage: "auto",
    });
  });

  it.each([
    ["zh", "这是一段已经是目标语言的内容。"],
    ["en", "This is a readable English sentence."],
    ["jp", "これは読みやすい日本語の文章です。"],
    ["kor", "이것은 읽을 수 있는 한국어 문장입니다."],
    ["spa", "Esta es una oración española legible."],
  ] as const)("可靠识别为 %s 的内容在同语言目标下零请求", (targetLanguage, text) => {
    expect(classifyStaticContentLanguage(text, targetLanguage)).toEqual({
      kind: "skip",
      reason: "same-target-language",
    });
  });

  it("英语和西班牙语共享常用词不构成跨语言证据", () => {
    expect(classifyStaticContentLanguage("A esta oración española legible.", "spa")).toEqual({
      kind: "skip",
      reason: "same-target-language",
    });
  });

  it("纯拉丁链接和标签交给供应商自动识别", () => {
    expect(classifyStaticContentLanguage("Lire", "zh")).toMatchObject({ kind: "translate", sourceLanguage: "auto" });
    expect(classifyStaticContentLanguage("Read", "zh")).toMatchObject({ kind: "translate", sourceLanguage: "auto" });
  });

  it("目标语言中夹杂无法归类的拉丁语段时保留单块手动入口，而非静默跳过", () => {
    expect(classifyStaticContentLanguage("这是一段中文内容 Bonjour monde", "zh")).toEqual({ kind: "manual" });
  });

  it("长中文中的短未知词低于阈值时不自动翻译，未知词达到阈值时保留手动入口", () => {
    expect(classifyStaticContentLanguage("这是一段足够长的中文阅读内容，用于确认短品牌词不会覆盖主要目标语言。 Z", "zh")).toEqual({ kind: "skip", reason: "same-target-language" });
    expect(classifyStaticContentLanguage("这是一段中文内容 Bonjour monde", "zh")).toEqual({ kind: "manual" });
  });

  it("英语新闻卡片中的专有名词仍交给供应商自动识别", () => {
    expect(classifyStaticContentLanguage("Carney Prepared for Remote Risk of U.S. Military Action Against Canada", "zh")).toEqual({
      kind: "translate",
      sourceLanguage: "auto",
    });
  });

  it("纯拉丁文字块交给供应商自动识别", () => {
    expect(classifyStaticContentLanguage("the Bonjour monde", "zh")).toEqual({ kind: "translate", sourceLanguage: "auto" });
    expect(classifyStaticContentLanguage("This is Bonjour monde", "zh")).toEqual({ kind: "translate", sourceLanguage: "auto" });
  });
});
