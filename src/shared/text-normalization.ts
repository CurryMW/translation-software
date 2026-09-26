/**
 * Canonical in-memory identity for translation source text. Paragraph
 * topology remains significant while incidental whitespace does not.
 */
export function normalizeTranslationSourceText(text: string): string {
  return text
    .replace(/\r\n?/gu, "\n")
    .split(/\n\s*\n+/gu)
    .map((paragraph) => paragraph.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}
