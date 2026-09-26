import { normalizeTranslationSourceText } from "../shared/text-normalization";

const readableBlockSelector = [
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "article", "[role='article']", "figcaption", "blockquote",
  // Stable semantic anchors used by the core-site samples. These are content
  // containers rather than layout/metadata classes, so the normal boundary
  // checks still apply (links, code, hidden and extension-owned descendants).
  "[data-testid='tweetText']", "[class~='commtext']",
  // Translate visible English navigation, links, buttons and sidebar labels.
  "a", "[role~='link' i]", "button", "nav", "menu", "aside", "footer", "[role='button']", "[role='toolbar']", "[role='menu']", "[role='navigation']", "[data-username]", "[rel='author']",
].join(", ");

// Code blocks are enumerated only to produce an explicit safe skip diagnostic;
// they are deliberately excluded from nested-readable-block arbitration.
const diagnosticSkipSelector = "pre";
const discoverySelector = `${readableBlockSelector}, ${diagnosticSkipSelector}`;

/** Potential dynamic discovery root; full safety checks remain in discovery. */
export function isPotentialStaticContentBlock(element: HTMLElement): boolean {
  return element.matches(readableBlockSelector);
}

const linkSelector = "a, [role~='link' i]";
const danglingLinkLeads = new Set([
  "read", "see", "learn", "click", "view", "open", "visit", "more", "continue",
  "lire", "leer", "lesen", "leggi", "ler", "читать", "読む", "읽기",
]);

const unsafeAncestorSelector = [
  "form", "input", "textarea", "select", "option", "[contenteditable]", "code", "pre",
  "[data-web-translation-extension-shell]", "[data-web-translation-translation]", "[data-web-translation-react-coordinator]",
].join(", ");

const omittedTextSelector = [
  "code", "pre",
  "form", "input", "textarea", "select", "option", "[contenteditable]",
  "[data-web-translation-extension-shell]", "[data-web-translation-translation]", "[data-web-translation-react-coordinator]",
].join(", ");

export type StaticContentSkipReason =
  | "unsafe-context"
  | "not-visible"
  | "nested-readable-block"
  | "link-only-or-incomplete"
  | "excluded-descendant-content"
  | "not-translatable";

export interface StaticContentBlockCandidate {
  readonly element: HTMLElement;
  readonly text: string;
  readonly normalizedText: string;
}

export interface StaticContentDiscovery {
  readonly candidates: readonly StaticContentBlockCandidate[];
  readonly skipped: readonly { readonly element: HTMLElement; readonly reason: StaticContentSkipReason }[];
}

function preserveParagraphBoundaries(text: string): string {
  return text.replace(/\r\n?/gu, "\n").split(/\n\s*\n+/gu).map((paragraph) => normalizeTranslationSourceText(paragraph)).filter(Boolean).join("\n\n");
}

function composedParentElement(element: HTMLElement): HTMLElement | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot && root.host instanceof HTMLElement ? root.host : null;
}

function hasUnsafeAncestor(element: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = composedParentElement(current)) {
    if (current.matches(unsafeAncestorSelector)) return true;
  }
  return false;
}

function isHiddenOrCollapsed(element: HTMLElement, view: Window): boolean {
  if (
    element.hidden ||
    element.getAttribute("aria-hidden") === "true" ||
    element.getAttribute("aria-expanded") === "false" ||
    (element.closest("details:not([open])") && element.tagName !== "SUMMARY")
  ) return true;
  const style = view.getComputedStyle(element);
  return (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.visibility === "collapse" ||
    style.contentVisibility === "hidden" ||
    style.opacity === "0"
  );
}

function isVisible(element: HTMLElement, view: Window): boolean {
  if (!isStructurallyVisible(element, view)) return false;
  const bounds = element.getBoundingClientRect();
  return bounds.bottom > 0 && bounds.right > 0 && bounds.top < view.innerHeight && bounds.left < view.innerWidth;
}

function isStructurallyVisible(element: HTMLElement, view: Window): boolean {
  for (let current: HTMLElement | null = element; current; current = composedParentElement(current)) {
    if (isHiddenOrCollapsed(current, view)) return false;
  }
  const bounds = element.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0;
}

function textWithoutExcludedDescendants(element: HTMLElement, document: Document, view: Window): { text: string; hadExcludedDescendant: boolean } {
  let hadExcludedDescendant = false;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      for (let parent = node.parentElement; parent && parent !== element; parent = parent.parentElement) {
        if (parent.matches(omittedTextSelector) || isHiddenOrCollapsed(parent, view)) {
          hadExcludedDescendant = true;
          return NodeFilter.FILTER_REJECT;
        }
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const fragments: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.previousSibling?.nodeName === "BR") fragments.push("\n\n");
    fragments.push(node.textContent ?? "");
  }
  return { text: preserveParagraphBoundaries(fragments.join(" ")), hadExcludedDescendant };
}

function isLikelyIndependentAfterRemovingLinks(text: string): boolean {
  if (/[.!?…。！？]$/u.test(text)) return true;
  const words = text.match(/\p{L}+/gu) ?? [];
  if (words.length > 1) return true;
  if (words.length !== 1) return false;
  return !danglingLinkLeads.has(words[0].toLowerCase());
}

function isTranslatable(text: string): boolean {
  return /\p{L}/u.test(text);
}

function hasNestedReadableBlock(element: HTMLElement, document: Document, view: Window, isCandidateVisible: (candidate: HTMLElement) => boolean): boolean {
  return Array.from(element.querySelectorAll<HTMLElement>(readableBlockSelector)).some((nested) => {
    if (nested === element || hasUnsafeAncestor(nested) || !isCandidateVisible(nested)) return false;
    const extracted = textWithoutExcludedDescendants(nested, document, view);
    if (!extracted.text || !isTranslatable(extracted.text)) return false;
    if (nested.querySelector(linkSelector) && !isLikelyIndependentAfterRemovingLinks(extracted.text)) return false;
    return !extracted.hadExcludedDescendant || isLikelyIndependentAfterRemovingLinks(extracted.text);
  });
}

/**
 * Public content-discovery seam for a static document. It exposes only the
 * readable candidates and non-sensitive skip reasons; callers decide when to
 * submit the returned original text to a translation service.
 */
function readableElementsWithin(root: ParentNode): HTMLElement[] {
  const direct = root instanceof HTMLElement && root.matches(discoverySelector) ? [root] : [];
  return [...direct, ...Array.from(root.querySelectorAll<HTMLElement>(discoverySelector))];
}

/**
 * Open roots are independently queryable documents. Closed roots are absent
 * by design, so discovery never guesses at their contents or reports them as
 * a supported candidate.
 */
export function openDiscoveryRootsWithin(root: ParentNode): readonly ParentNode[] {
  const roots: ParentNode[] = [root];
  const elements = [
    ...(root instanceof HTMLElement ? [root] : []),
    ...Array.from(root.querySelectorAll<HTMLElement>("*")),
  ];
  for (const element of elements) {
    if (!element.shadowRoot) continue;
    roots.push(...openDiscoveryRootsWithin(element.shadowRoot));
  }
  return roots;
}

function discoverStaticContentBlocksUpTo(document: Document, root: ParentNode, candidateLimit: number, includeOffscreen: boolean): StaticContentDiscovery {
  const candidates: StaticContentBlockCandidate[] = [];
  const skipped: Array<{ element: HTMLElement; reason: StaticContentSkipReason }> = [];
  const view = document.defaultView;
  if (!view) return { candidates, skipped };

  const isCandidateVisible = includeOffscreen ? (element: HTMLElement) => isStructurallyVisible(element, view) : (element: HTMLElement) => isVisible(element, view);
  for (const element of readableElementsWithin(root)) {
    if (hasUnsafeAncestor(element)) {
      skipped.push({ element, reason: "unsafe-context" });
      continue;
    }
    if (!isCandidateVisible(element)) {
      skipped.push({ element, reason: "not-visible" });
      continue;
    }
    if (hasNestedReadableBlock(element, document, view, isCandidateVisible)) {
      skipped.push({ element, reason: "nested-readable-block" });
      continue;
    }
    const extracted = textWithoutExcludedDescendants(element, document, view);
    const text = extracted.text;
    const containsLink = Boolean(element.querySelector(linkSelector));
    const containsExcludedDescendant = extracted.hadExcludedDescendant;
    if (!text || (containsLink && !isLikelyIndependentAfterRemovingLinks(text))) {
      skipped.push({ element, reason: containsLink ? "link-only-or-incomplete" : "excluded-descendant-content" });
      continue;
    }
    if (containsExcludedDescendant && !isLikelyIndependentAfterRemovingLinks(text)) {
      skipped.push({ element, reason: "excluded-descendant-content" });
      continue;
    }
    if (!isTranslatable(text)) {
      skipped.push({ element, reason: "not-translatable" });
      continue;
    }
    candidates.push({ element, text, normalizedText: normalizeTranslationSourceText(text) });
    if (candidates.length === candidateLimit) break;
  }
  return { candidates, skipped };
}

export function discoverStaticContentBlocks(document: Document): StaticContentDiscovery {
  return discoverStaticContentBlocksAcrossRoots(document, openDiscoveryRootsWithin(document), Number.POSITIVE_INFINITY, false);
}

/**
 * Incremental variant of the public discovery seam. Dynamic content uses it
 * only for an affected subtree, never as a periodic whole-document scan.
 */
export function discoverStaticContentBlocksWithin(document: Document, root: ParentNode): StaticContentDiscovery {
  return discoverStaticContentBlocksAcrossRoots(document, openDiscoveryRootsWithin(root), Number.POSITIVE_INFINITY, true);
}

/**
 * Finds one currently-visible safe content block without evaluating later
 * nodes. Startup uses this only for a provisional loading indicator; the
 * normal scan deliberately remains complete.
 */
export function discoverFirstStaticContentBlock(document: Document): StaticContentBlockCandidate | undefined {
  return discoverStaticContentBlocksAcrossRoots(document, openDiscoveryRootsWithin(document), 1, false).candidates[0];
}

function discoverStaticContentBlocksAcrossRoots(
  document: Document,
  roots: readonly ParentNode[],
  candidateLimit: number,
  includeOffscreen: boolean,
): StaticContentDiscovery {
  const candidates: StaticContentBlockCandidate[] = [];
  const skipped: Array<{ element: HTMLElement; reason: StaticContentSkipReason }> = [];
  for (const root of roots) {
    const remaining = candidateLimit - candidates.length;
    if (remaining <= 0) break;
    const result = discoverStaticContentBlocksUpTo(document, root, remaining, includeOffscreen);
    candidates.push(...result.candidates);
    skipped.push(...result.skipped);
  }
  return { candidates, skipped };
}
