/**
 * A tab stay belongs to the top document. Embedded frames receive the same
 * descriptor but must never duplicate the consent surface inside the page.
 */
export function isTopLevelContentFrame(frame: { top?: unknown; self?: unknown }): boolean {
  return frame.top === frame.self;
}
