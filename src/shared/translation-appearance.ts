export const TRANSLATION_TEXT_COLOR_OPTIONS = [
  { id: "adaptive", label: "跟随网页主题", light: "#1f2937", dark: "#f8fafc" },
  { id: "blue", label: "深蓝", light: "#1d4ed8", dark: "#93c5fd" },
  { id: "green", label: "墨绿", light: "#166534", dark: "#86efac" },
  { id: "purple", label: "紫色", light: "#7e22ce", dark: "#d8b4fe" },
  { id: "amber", label: "琥珀", light: "#a16207", dark: "#fde68a" },
  { id: "rose", label: "玫红", light: "#be123c", dark: "#fda4af" },
] as const;

export type TranslationTextColorId = (typeof TRANSLATION_TEXT_COLOR_OPTIONS)[number]["id"];

export interface TranslationAppearanceSettings {
  textColor: TranslationTextColorId;
}

export const DEFAULT_TRANSLATION_APPEARANCE: Readonly<TranslationAppearanceSettings> = {
  textColor: "adaptive",
};

export function isTranslationTextColorId(value: unknown): value is TranslationTextColorId {
  return TRANSLATION_TEXT_COLOR_OPTIONS.some(option => option.id === value);
}

export function isTranslationAppearanceSettings(value: unknown): value is TranslationAppearanceSettings {
  if (typeof value !== "object" || value === null) return false;
  return isTranslationTextColorId((value as Partial<TranslationAppearanceSettings>).textColor);
}

export function translationTextColorOption(id: TranslationTextColorId) {
  return TRANSLATION_TEXT_COLOR_OPTIONS.find(option => option.id === id) ?? TRANSLATION_TEXT_COLOR_OPTIONS[0];
}
