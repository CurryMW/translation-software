import type { BaiduLanguageCode } from "../shared/languages";

export type StaticContentLanguageDecision =
  | { kind: "translate"; sourceLanguage: "auto" }
  | { kind: "skip"; reason: "same-target-language" }
  | { kind: "manual" };

type Evidence = Partial<Record<BaiduLanguageCode, number>>;

const englishWords = new Set([
  "about", "an", "and", "are", "as", "at", "be", "by", "can", "clearly", "content", "english", "for", "from", "has", "have", "in", "into", "is", "mixed", "not", "of", "on", "or", "read", "readable", "sentence", "that", "the", "this", "to", "translation", "was", "were", "which", "will", "with", "words",
]);
const spanishWords = new Set([
  "a", "de", "el", "en", "es", "esta", "española", "legible", "los", "oración", "para", "que", "una", "y",
]);

function countMatches(text: string, expression: RegExp): number {
  return [...text.matchAll(expression)].length;
}

function latinWordEvidence(text: string): { evidence: Pick<Evidence, "en" | "spa">; unclassifiedLatinLetterCount: number } {
  const evidence: Pick<Evidence, "en" | "spa"> = {};
  let unclassifiedLatinLetterCount = 0;
  for (const word of text.toLocaleLowerCase().match(/\p{L}+/gu) ?? []) {
    if (!/^\p{Script=Latin}+$/u.test(word)) continue;
    const english = englishWords.has(word);
    const spanish = spanishWords.has(word);
    // A shared spelling is not evidence for either language by itself.
    if (english && spanish) {
      unclassifiedLatinLetterCount += word.length;
      continue;
    }
    if (!english && !spanish) {
      unclassifiedLatinLetterCount += word.length;
      continue;
    }
    if (english) evidence.en = (evidence.en ?? 0) + word.length;
    if (spanish) evidence.spa = (evidence.spa ?? 0) + word.length;
  }
  return { evidence, unclassifiedLatinLetterCount };
}

function languageEvidence(text: string): { evidence: Evidence; unclassifiedLatinLetterCount: number } {
  const evidence: Evidence = {};
  const han = countMatches(text, /\p{Script=Han}/gu);
  const japanese = countMatches(text, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const korean = countMatches(text, /\p{Script=Hangul}/gu);
  const latin = latinWordEvidence(text);
  // Japanese kanji belongs to the Japanese evidence when kana is present;
  // never attribute the same character to both Japanese and Chinese.
  if (han && !japanese) evidence.zh = han;
  if (japanese) evidence.jp = japanese + han;
  if (korean) evidence.kor = korean;
  if (latin.evidence.en) evidence.en = latin.evidence.en;
  if (latin.evidence.spa) evidence.spa = latin.evidence.spa;
  return { evidence, unclassifiedLatinLetterCount: latin.unclassifiedLatinLetterCount };
}

/**
 * Public language-policy seam for static reading content. It only reports
 * whether a caller may auto-submit, must skip, or needs a per-block user
 * choice; it never sends content or reads page settings.
 */
export function classifyStaticContentLanguage(
  text: string,
  targetLanguage: BaiduLanguageCode,
): StaticContentLanguageDecision {
  const { evidence, unclassifiedLatinLetterCount } = languageEvidence(text);
  const latinLetterCount = [...text.matchAll(/\p{Script=Latin}/gu)].length;
  const targetEvidence = evidence[targetLanguage] ?? 0;
  if (targetEvidence === 0 && targetLanguage !== "en" && latinLetterCount > 0 && !evidence.zh && !evidence.jp && !evidence.kor) {
    return { kind: "translate", sourceLanguage: "auto" };
  }
  const strongest = (Object.entries(evidence) as Array<[BaiduLanguageCode, number]>)
    .sort(([, left], [, right]) => right - left);
  if (!strongest.length) return { kind: "manual" };

  const nonTargetEvidence = strongest.reduce(
    (total, [language, amount]) => language === targetLanguage ? total : total + amount,
    0,
  );
  const totalEvidence = targetEvidence + nonTargetEvidence + unclassifiedLatinLetterCount;
  const nonTargetRatio = nonTargetEvidence / totalEvidence;
  const unclassifiedRatio = unclassifiedLatinLetterCount / totalEvidence;
  // Direction and threshold decisions use the entire evidence set. A small
  // recognised word cannot override a larger unclassified foreign fragment.
  if (unclassifiedRatio >= 0.3 && unclassifiedRatio > nonTargetRatio) return { kind: "manual" };
  if (nonTargetRatio >= 0.3) return { kind: "translate", sourceLanguage: "auto" };
  if (unclassifiedRatio >= 0.3) return { kind: "manual" };
  if (targetEvidence > 0) {
    return { kind: "skip", reason: "same-target-language" };
  }
  return { kind: "manual" };
}
