export type CompatibilityProbeFailure = "layout-breakage" | "scroll-breakage" | "interaction-breakage";

interface ProbeSnapshot {
  scrollWidth: number;
  clientWidth: number;
  overflowX: string;
  overflowY: string;
}

interface ProbeDependencies {
  document: Document;
  report(reason: CompatibilityProbeFailure): void;
}

function snapshot(document: Document): ProbeSnapshot {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  return {
    scrollWidth: root.scrollWidth,
    clientWidth: root.clientWidth,
    overflowX: style.overflowX,
    overflowY: style.overflowY,
  };
}

function intersects(left: DOMRect, right: DOMRect): boolean {
  return left.width > 0 && left.height > 0 && right.width > 0 && right.height > 0 && left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}

function extensionOverlayElements(document: Document): HTMLElement[] {
  const hosts = Array.from(document.querySelectorAll<HTMLElement>(
    "[data-web-translation-extension-shell], [data-web-translation-translation], [data-web-translation-compatibility-notice], [data-web-translation-provider-notice], [data-web-translation-tab-session-prompt]",
  ));
  const descendants = hosts.flatMap((host) => host.shadowRoot ? Array.from(host.shadowRoot.querySelectorAll<HTMLElement>("*")) : []);
  return [...hosts, ...descendants];
}

function extensionOwnedNode(node: Node): boolean {
  let current: Node | null = node;
  while (current) {
    if (current instanceof Element && current.matches("[data-web-translation-extension-shell], [data-web-translation-translation], [data-web-translation-compatibility-notice], [data-web-translation-provider-notice], [data-web-translation-tab-session-prompt], [data-web-translation-react-coordinator]")) return true;
    if (current.parentNode) {
      current = current.parentNode;
      continue;
    }
    const root = current.getRootNode();
    current = root instanceof ShadowRoot ? root.host : null;
  }
  return false;
}

function mutationTouchesExtension(record: MutationRecord): boolean {
  if (extensionOwnedNode(record.target)) return true;
  if (record.type !== "childList") return false;
  return [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)].some(extensionOwnedNode);
}

/** Checks only host-visible effects attributable to extension-owned UI. */
export function detectCompatibilityProbeFailure(document: Document, before: ProbeSnapshot): CompatibilityProbeFailure | undefined {
  const after = snapshot(document);
  if ((before.overflowX !== "hidden" && after.overflowX === "hidden") || (before.overflowY !== "hidden" && after.overflowY === "hidden")) return "scroll-breakage";
  if (before.scrollWidth <= before.clientWidth + 2 && after.scrollWidth > after.clientWidth + 2) return "layout-breakage";

  const controls = Array.from(document.querySelectorAll<HTMLElement>("button, a, input, select, textarea, [role='button']"));
  // Inspect both the light-DOM host and its open shadow descendants. The
  // actual fixed/sticky prompt is inside a shadow root, while translation
  // hosts themselves normally remain ordinary flow elements.
  const overlays = extensionOverlayElements(document);
  const viewportWidth = document.documentElement.clientWidth || document.defaultView?.innerWidth || 0;
  for (const overlay of overlays) {
    const overlayRect = overlay.getBoundingClientRect();
    if (viewportWidth > 0 && (overlayRect.left < -2 || overlayRect.right > viewportWidth + 2)) return "layout-breakage";
    // Normal translation hosts live in the page's flow and are intentionally
    // adjacent to the source block. Only fixed/sticky extension UI can cover
    // an unrelated host control and should participate in this check.
    const position = document.defaultView?.getComputedStyle(overlay).position;
    if (position !== "fixed" && position !== "sticky") continue;
    if (controls.some((control) => control !== overlay && intersects(overlayRect, control.getBoundingClientRect()))) return "interaction-breakage";
  }
  return undefined;
}

export function createCompatibilityProbe({ document, report }: ProbeDependencies): { stop(): void } {
  const before = snapshot(document);
  let scheduled = false;
  let stopped = false;
  const observer = new MutationObserver((records) => {
    // Host-page mutations must not be attributed to the extension. The
    // extension host insertion and mutations inside its open shadow roots are
    // the only events that can trigger this rollback probe.
    if (!records.some(mutationTouchesExtension)) return;
    for (const host of Array.from(document.querySelectorAll<HTMLElement>("[data-web-translation-extension-shell], [data-web-translation-translation], [data-web-translation-compatibility-notice], [data-web-translation-provider-notice], [data-web-translation-tab-session-prompt], [data-web-translation-react-coordinator]"))) {
      if (host.shadowRoot) observer.observe(host.shadowRoot, { attributes: true, childList: true, characterData: true, subtree: true });
    }
    if (scheduled || stopped) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (stopped) return;
      const failure = detectCompatibilityProbeFailure(document, before);
      if (failure) report(failure);
    });
  });
  observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true, attributeFilter: ["class", "style"] });
  for (const host of Array.from(document.querySelectorAll<HTMLElement>("[data-web-translation-extension-shell], [data-web-translation-translation], [data-web-translation-compatibility-notice], [data-web-translation-provider-notice], [data-web-translation-tab-session-prompt], [data-web-translation-react-coordinator]"))) {
    if (host.shadowRoot) observer.observe(host.shadowRoot, { attributes: true, childList: true, characterData: true, subtree: true });
  }
  return {
    stop() {
      stopped = true;
      observer.disconnect();
    },
  };
}
