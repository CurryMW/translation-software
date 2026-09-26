import { openDiscoveryRootsWithin } from "./static-content-discovery";

export interface DynamicContentCandidate {
  readonly element: HTMLElement;
  readonly text: string;
  readonly normalizedText: string;
}

export interface DynamicContentActionStats {
  readonly requestCount: number;
  readonly domInsertions: number;
}

export interface DynamicContentMetrics {
  readonly sampleCount: number;
  readonly p95ScanDurationMs: number;
  readonly slowestScanDurationMs: number;
  readonly requestCount: number;
  readonly totalRequestCount: number;
  readonly queueDepth: number;
  readonly domInsertions: number;
}

export interface DynamicVisibleContentControllerOptions {
  readonly document: Document;
  readonly discover: (root: ParentNode) => readonly DynamicContentCandidate[];
  readonly isPotentialCandidateRoot?: (element: HTMLElement) => boolean;
  readonly isIgnoredNode?: (node: Node) => boolean;
  readonly onVisible: (candidate: DynamicContentCandidate) => DynamicContentActionStats;
  readonly onHidden: (element: HTMLElement, candidate: DynamicContentCandidate) => void;
  readonly onInvalidated: (element: HTMLElement, previous: DynamicContentCandidate) => void;
  readonly onRemoved: (element: HTMLElement, candidate: DynamicContentCandidate) => void;
  readonly onMetrics?: (metrics: DynamicContentMetrics) => void;
  /** Current unresolved translation-task count, supplied by the content seam. */
  readonly queueDepth?: () => number;
  /** Extra host attributes whose changes can alter an active site exception. */
  readonly observeAttributes?: boolean;
  readonly now?: () => number;
  /** Text mutations wait briefly so typing and streamed updates submit once. */
  readonly stableTextDelayMs?: number;
  readonly setTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
}

interface ScanSample {
  readonly durationMs: number;
  readonly requestCount: number;
  readonly queueDepth: number;
  readonly domInsertions: number;
}

/**
 * Observer-driven index for dynamically-added readable blocks. Mutation
 * batches only discover affected subtrees; the browser's IntersectionObserver
 * is the sole normal-browser gate that may submit a translation task.
 */
export class DynamicVisibleContentController {
  private readonly candidates = new Map<HTMLElement, DynamicContentCandidate>();
  private readonly visible = new Set<HTMLElement>();
  private readonly samples: ScanSample[] = [];
  private readonly now: () => number;
  private readonly stableTextDelayMs: number;
  private readonly setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  private readonly intersectionObserver?: IntersectionObserver;
  private readonly mutationObserver: MutationObserver;
  private readonly observedMutationRoots = new Set<Node>();
  private mutationPending = false;
  private pendingMutations: MutationRecord[] = [];
  private pendingRemovedCandidates = new Set<HTMLElement>();
  private pendingTextRoots = new Set<HTMLElement>();
  private pendingStableCandidates = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  private started = false;
  private fallbackFramePending = false;
  private totalRequestCount = 0;

  constructor(private readonly options: DynamicVisibleContentControllerOptions) {
    this.now = options.now ?? (() => performance.now());
    // 200ms matches the existing visible-loading responsiveness gate while
    // absorbing common streamed or word-by-word page edits.
    this.stableTextDelayMs = options.stableTextDelayMs ?? 200;
    this.setTimer = options.setTimeout ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimeout ?? ((timer) => clearTimeout(timer));
    this.mutationObserver = new MutationObserver((records) => this.onMutations(records));
    if (typeof IntersectionObserver !== "undefined") {
      this.intersectionObserver = new IntersectionObserver((entries) => this.onIntersections(entries), { root: null, rootMargin: "0px", threshold: 0 });
    }
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const root = this.options.document.body;
    if (!root) return;
    this.scanRoots([root]);
    if (!this.intersectionObserver) {
      const view = this.options.document.defaultView;
      view?.addEventListener("scroll", this.scheduleFallbackCheck, { passive: true });
      view?.addEventListener("resize", this.scheduleFallbackCheck);
      this.checkFallbackVisibility();
    }
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.mutationObserver.disconnect();
    this.observedMutationRoots.clear();
    this.intersectionObserver?.disconnect();
    const view = this.options.document.defaultView;
    view?.removeEventListener("scroll", this.scheduleFallbackCheck);
    view?.removeEventListener("resize", this.scheduleFallbackCheck);
    for (const timer of this.pendingStableCandidates.values()) this.clearTimer(timer);
    this.pendingStableCandidates.clear();
    this.candidates.clear();
    this.visible.clear();
  }

  currentCandidate(element: HTMLElement): DynamicContentCandidate | undefined {
    return this.candidates.get(element);
  }

  /** Explicit compatibility rescan; normal runtime updates are observer-driven. */
  scan(root: ParentNode): void {
    if (!this.started) return;
    this.removeDisconnectedCandidates();
    this.scanRoots([root]);
    if (!this.intersectionObserver) this.checkFallbackVisibility();
  }

  metrics(): DynamicContentMetrics {
    const durations = this.samples.map(({ durationMs }) => durationMs).sort((left, right) => left - right);
    const percentileIndex = durations.length ? Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1) : 0;
    const latest = this.samples.at(-1);
    return {
      sampleCount: this.samples.length,
      p95ScanDurationMs: durations[percentileIndex] ?? 0,
      slowestScanDurationMs: durations.at(-1) ?? 0,
      requestCount: latest?.requestCount ?? 0,
      totalRequestCount: this.totalRequestCount,
      queueDepth: latest?.queueDepth ?? this.candidates.size,
      domInsertions: latest?.domInsertions ?? 0,
    };
  }

  private onMutations(records: MutationRecord[]): void {
    if (!this.started || records.every((record) => this.isIgnoredMutation(record))) return;
    this.pendingMutations.push(...records);
    if (this.mutationPending) return;
    this.mutationPending = true;
    queueMicrotask(() => {
      this.mutationPending = false;
      if (!this.started) return;
      const roots = new Set<ParentNode>();
      const pending = this.pendingMutations.splice(0);
      for (const record of pending) {
        if (this.isIgnoredMutation(record)) continue;
        if (record.type === "childList") this.collectRemovedCandidates(record.removedNodes);
        if (record.type === "childList" && record.addedNodes.length) {
          const addedElements = Array.from(record.addedNodes).filter((node): node is HTMLElement => node instanceof HTMLElement && !this.isIgnoredNode(node));
          if (addedElements.length) {
            for (const node of addedElements) roots.add(node);
          }
        }
        if (record.type === "attributes" && this.options.observeAttributes) roots.add(this.options.document.body);
        const affectedRoot = this.indexedAncestor(record.target) ?? this.potentialCandidateAncestor(record.target);
        if (affectedRoot) {
          roots.add(affectedRoot);
          if (record.type === "characterData" || (record.type === "childList" && !Array.from(record.addedNodes).some((node) => node instanceof HTMLElement))) {
            this.pendingTextRoots.add(affectedRoot);
          }
        }
      }
      this.invalidateMovedCandidates();
      this.removeDisconnectedCandidates();
      if (roots.size) {
        this.scanRoots([...roots]);
        if (!this.intersectionObserver) this.checkFallbackVisibility();
      }
    });
  }

  private isIgnoredMutation(record: MutationRecord): boolean {
    if (this.isIgnoredNode(record.target)) return true;
    if (record.type !== "childList") return false;
    const changedNodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
    return changedNodes.length > 0 && changedNodes.every((node) => this.isIgnoredNode(node));
  }

  private isIgnoredNode(node: Node): boolean {
    return this.options.isIgnoredNode?.(node) ?? false;
  }

  private scanRoots(roots: readonly ParentNode[]): void {
    const startedAt = this.now();
    let requestCount = 0;
    let domInsertions = 0;
    const scanned = new Set<HTMLElement>();
    // Discovery owns recursive Shadow traversal. The controller expands roots
    // only to register MutationObserver targets, so nested roots are not
    // repeatedly rediscovered during one affected-subtree scan.
    this.observeMutationRoots([...new Set(roots.flatMap((root) => openDiscoveryRootsWithin(root)))]);
    for (const root of roots) {
      if (this.isIgnoredNode(root)) continue;
      const discoveredInRoot = new Set<HTMLElement>();
      for (const candidate of this.options.discover(root)) {
        discoveredInRoot.add(candidate.element);
        if (scanned.has(candidate.element) || this.isIgnoredNode(candidate.element)) continue;
        scanned.add(candidate.element);
        const previous = this.candidates.get(candidate.element);
        if (previous?.normalizedText === candidate.normalizedText) continue;
        const wasStreamingText = this.pendingTextRoots.has(candidate.element);
        if (previous) {
          const { wasVisible, wasSettling } = this.detachCandidate(candidate.element);
          this.options.onInvalidated(candidate.element, previous);
          if (wasVisible || wasSettling || wasStreamingText) this.scheduleStableCandidate(candidate);
        } else if (wasStreamingText) {
          this.scheduleStableCandidate(candidate);
        }
        this.candidates.set(candidate.element, candidate);
        this.intersectionObserver?.observe(candidate.element);
        if (!this.intersectionObserver && this.isActuallyVisible(candidate.element)) {
          const result = this.markVisible(candidate);
          requestCount += result.requestCount;
          domInsertions += result.domInsertions;
        }
      }
      for (const [element, previous] of this.candidates) {
        if (!this.isWithinRoot(element, root) || discoveredInRoot.has(element) || !element.isConnected) continue;
        this.detachCandidate(element);
        this.options.onInvalidated(element, previous);
      }
    }
    this.pendingTextRoots.clear();
    this.recordSample(startedAt, requestCount, domInsertions);
  }

  private removeDisconnectedCandidates(): void {
    for (const [element, candidate] of this.candidates) {
      if (element.isConnected) continue;
      this.detachCandidate(element);
      this.options.onRemoved(element, candidate);
    }
  }

  private collectRemovedCandidates(removedNodes: NodeList): void {
    for (const removed of Array.from(removedNodes)) {
      for (const element of this.candidates.keys()) {
        if (removed === element || (removed instanceof Element && this.isComposedDescendantOf(element, removed))) this.pendingRemovedCandidates.add(element);
      }
    }
  }

  private observeMutationRoots(roots: readonly ParentNode[]): void {
    for (const root of roots) {
      const target = root instanceof Document ? root.documentElement : root;
      if (!target || this.observedMutationRoots.has(target)) continue;
      this.mutationObserver.observe(target, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: Boolean(this.options.observeAttributes),
      });
      this.observedMutationRoots.add(target);
    }
  }

  private invalidateMovedCandidates(): void {
    for (const element of this.pendingRemovedCandidates) {
      const candidate = this.candidates.get(element);
      if (!candidate) continue;
      this.detachCandidate(element);
      this.options.onInvalidated(element, candidate);
    }
    this.pendingRemovedCandidates.clear();
  }

  /** Removes every observation tied to one candidate before reporting its lifecycle end. */
  private detachCandidate(element: HTMLElement): { wasVisible: boolean; wasSettling: boolean } {
    const wasVisible = this.visible.delete(element);
    const wasSettling = this.pendingStableCandidates.has(element);
    this.intersectionObserver?.unobserve(element);
    this.cancelStableCandidate(element);
    this.candidates.delete(element);
    return { wasVisible, wasSettling };
  }

  private onIntersections(entries: IntersectionObserverEntry[]): void {
    const startedAt = this.now();
    let requestCount = 0;
    let domInsertions = 0;
    for (const entry of [...entries].sort((left, right) => this.compareDocumentOrder(left.target, right.target))) {
      const candidate = this.candidates.get(entry.target as HTMLElement);
      if (!candidate) continue;
      const result = this.updateCandidateVisibility(candidate, entry.isIntersecting && entry.intersectionRatio > 0 && this.isActuallyVisible(candidate.element));
      requestCount += result.requestCount;
      domInsertions += result.domInsertions;
    }
    this.recordSample(startedAt, requestCount, domInsertions);
  }

  private compareDocumentOrder(left: Element, right: Element): number {
    if (left === right) return 0;
    return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  }

  private markVisible(candidate: DynamicContentCandidate): DynamicContentActionStats {
    if (this.pendingStableCandidates.has(candidate.element)) return { requestCount: 0, domInsertions: 0 };
    if (this.visible.has(candidate.element)) return { requestCount: 0, domInsertions: 0 };
    this.visible.add(candidate.element);
    return this.options.onVisible(candidate);
  }

  private updateCandidateVisibility(candidate: DynamicContentCandidate, isVisible: boolean): DynamicContentActionStats {
    if (isVisible) return this.markVisible(candidate);
    this.cancelStableCandidate(candidate.element);
    if (this.visible.delete(candidate.element)) this.options.onHidden(candidate.element, candidate);
    return { requestCount: 0, domInsertions: 0 };
  }

  private scheduleStableCandidate(candidate: DynamicContentCandidate): void {
    const timer = this.setTimer(() => {
      this.pendingStableCandidates.delete(candidate.element);
      if (!this.started || this.candidates.get(candidate.element) !== candidate || !this.isActuallyVisible(candidate.element)) return;
      const result = this.markVisible(candidate);
      this.totalRequestCount += result.requestCount;
      this.options.onMetrics?.(this.metrics());
    }, this.stableTextDelayMs);
    this.pendingStableCandidates.set(candidate.element, timer);
  }

  private cancelStableCandidate(element: HTMLElement): void {
    const timer = this.pendingStableCandidates.get(element);
    if (timer === undefined) return;
    this.clearTimer(timer);
    this.pendingStableCandidates.delete(element);
  }

  private readonly scheduleFallbackCheck = (): void => {
    if (this.fallbackFramePending) return;
    this.fallbackFramePending = true;
    const view = this.options.document.defaultView;
    const schedule = view?.requestAnimationFrame?.bind(view) ?? ((callback: FrameRequestCallback) => setTimeout(() => callback(this.now()), 0) as unknown as number);
    schedule(() => {
      this.fallbackFramePending = false;
      this.checkFallbackVisibility();
    });
  };

  private checkFallbackVisibility(): void {
    const startedAt = this.now();
    let requestCount = 0;
    let domInsertions = 0;
    for (const candidate of this.candidates.values()) {
      const result = this.updateCandidateVisibility(candidate, this.isActuallyVisible(candidate.element));
      requestCount += result.requestCount;
      domInsertions += result.domInsertions;
    }
    this.recordSample(startedAt, requestCount, domInsertions);
  }

  private indexedAncestor(node: Node): HTMLElement | undefined {
    for (let current = node instanceof HTMLElement ? node : node.parentElement; current; current = current.parentElement) {
      if (this.candidates.has(current)) return current;
    }
    return undefined;
  }

  private potentialCandidateAncestor(node: Node): HTMLElement | undefined {
    for (let current = node instanceof HTMLElement ? node : node.parentElement; current; current = current.parentElement) {
      if (this.options.isPotentialCandidateRoot?.(current)) return current;
    }
    return undefined;
  }

  private isWithinRoot(element: HTMLElement, root: ParentNode): boolean {
    return this.isComposedDescendantOf(element, root);
  }

  private isComposedDescendantOf(element: HTMLElement, root: Node): boolean {
    let current: Node | null = element;
    while (current) {
      if (current === root) return true;
      if (current.parentNode) {
        current = current.parentNode;
        continue;
      }
      const treeRoot = current.getRootNode();
      current = treeRoot instanceof ShadowRoot ? treeRoot.host : null;
    }
    return false;
  }

  private isActuallyVisible(element: HTMLElement): boolean {
    const view = this.options.document.defaultView;
    if (!view || !element.isConnected) return false;
    const bounds = element.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.right > 0 && bounds.top < view.innerHeight && bounds.left < view.innerWidth;
  }

  private recordSample(startedAt: number, requestCount: number, domInsertions: number): void {
    this.totalRequestCount += requestCount;
    this.samples.push({ durationMs: Math.max(0, this.now() - startedAt), requestCount, queueDepth: this.options.queueDepth?.() ?? 0, domInsertions });
    if (this.samples.length > 128) this.samples.shift();
    this.options.onMetrics?.(this.metrics());
  }
}
