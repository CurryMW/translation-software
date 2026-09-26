export const AUTO_SOURCE_LANGUAGE = "auto" as const;

export const BAIDU_MVP_LANGUAGES = [
  { code: "zh", label: "简体中文" },
  { code: "en", label: "英语" },
  { code: "jp", label: "日语" },
  { code: "kor", label: "韩语" },
  { code: "spa", label: "西班牙语" },
] as const;

export type BaiduLanguageCode = (typeof BAIDU_MVP_LANGUAGES)[number]["code"];
export type TranslationSourceLanguage = typeof AUTO_SOURCE_LANGUAGE | BaiduLanguageCode;

const languageCodes = new Set<string>(BAIDU_MVP_LANGUAGES.map(({ code }) => code));

export function isBaiduLanguageCode(value: unknown): value is BaiduLanguageCode {
  return typeof value === "string" && languageCodes.has(value);
}

export function isTranslationSourceLanguage(value: unknown): value is TranslationSourceLanguage {
  return value === AUTO_SOURCE_LANGUAGE || isBaiduLanguageCode(value);
}

export function isBaiduMvpDirection(
  sourceLanguage: TranslationSourceLanguage,
  targetLanguage: BaiduLanguageCode,
): boolean {
  return sourceLanguage === AUTO_SOURCE_LANGUAGE || sourceLanguage !== targetLanguage;
}
