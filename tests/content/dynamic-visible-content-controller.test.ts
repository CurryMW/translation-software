// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  document.documentElement.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

function visibleBounds() {
  return { top: 10, right: 200, bottom: 60, left: 10, width: 190, height: 50, x: 10, y: 10, toJSON: () => ({}) };
}

function hiddenBounds() {
  return { top: 900, right: 200, bottom: 950, left: 10, width: 190, height: 50, x: 10, y: 900, toJSON: () => ({}) };
}

function discoverParagraphs(root: ParentNode) {
  const direct = root instanceof HTMLElement && root.matches("p") ? [root] : [];
  return [...direct, ...Array.from(root.querySelectorAll<HTMLElement>("p"))].map((element) => ({ element, text: element.textContent ?? "", normalizedText: element.textContent ?? "" }));
}

class FakeIntersectionObserver {
  static latest: FakeIntersectionObserver | undefined;
  readonly observed = new Set<Element>();
  readonly options: IntersectionObserverInit | undefined;
  constructor(readonly callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.options = options;
    FakeIntersectionObserver.latest = this;
  }
  observe = (element: Element) => { this.observed.add(element); };
  unobserve = (element: Element) => { this.observed.delete(element); };
  disconnect = () => { this.observed.clear(); };
  takeRecords = () => [];
  emit(element: Element, isIntersecting: boolean, intersectionRatio = isIntersecting ? 1 : 0) {
    this.callback([{ target: element, isIntersecting, intersectionRatio, boundingClientRect: element.getBoundingClientRect(), intersectionRect: element.getBoundingClientRect(), rootBounds: null, time: 0 }], this as unknown as IntersectionObserver);
  }
  emitBatch(elements: Element[]) {
    this.callback(elements.map((element) => ({ target: element, isIntersecting: true, intersectionRatio: 1, boundingClientRect: element.getBoundingClientRect(), intersectionRect: element.getBoundingClientRect(), rootBounds: null, time: 0 })), this as unknown as IntersectionObserver);
  }
}

describe("动态可视内容控制器", () => {
  it("只在实际进入视口时提交屏外新增块，rootMargin 为零", async () => {
    const source = document.createElement("p");
    source.textContent = "A dynamic readable English sentence.";
    document.body.append(source);
    Object.defineProperty(source, "getBoundingClientRect", { configurable: true, value: hiddenBounds });
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

    const { DynamicVisibleContentController } = await import("../../src/content/dynamic-visible-content-controller");
    const submitted: string[] = [];
    const controller = new DynamicVisibleContentController({
      document,
      discover: discoverParagraphs,
      onVisible: (candidate) => { submitted.push(candidate.normalizedText); return { requestCount: 1, domInsertions: 1 }; },
      onHidden: () => undefined,
      onInvalidated: () => undefined,
      onRemoved: () => undefined,
    });
    controller.start();

    expect(FakeIntersectionObserver.latest?.options?.rootMargin).toBe("0px");
    expect(submitted).toEqual([]);
    Object.defineProperty(source, "getBoundingClientRect", { configurable: true, value: visibleBounds });
    FakeIntersectionObserver.latest?.emit(source, true);
    expect(submitted).toEqual(["A dynamic readable English sentence."]);
  });

  it("观察既有开放 Shadow root 的新增块，并只在可见事件后提交", async () => {
    const host = document.createElement("section");
    const shadow = host.attachShadow({ mode: "open" });
    document.body.append(host);
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const { DynamicVisibleContentController } = await import("../../src/content/dynamic-visible-content-controller");
    const submitted: string[] = [];
    const controller = new DynamicVisibleContentController({
      document,
      discover: discoverParagraphs,
      onVisible: (candidate) => { submitted.push(candidate.normalizedText); return { requestCount: 1, domInsertions: 0 }; },
      onHidden: () => undefined,
      onInvalidated: () => undefined,
      onRemoved: () => undefined,
    });
    controller.start();
    const source = document.createElement("p");
    source.textContent = "A dynamic open shadow sentence.";
    Object.defineProperty(source, "getBoundingClientRect", { configurable: true, value: visibleBounds });
    shadow.append(source);

    await vi.waitFor(() => expect(controller.currentCandidate(source)?.normalizedText).toBe("A dynamic open shadow sentence."));
    expect(submitted).toEqual([]);
    FakeIntersectionObserver.latest?.emit(source, true);
    expect(submitted).toEqual(["A dynamic open shadow sentence."]);
  });

  it("节点复用时先失效旧身份，延迟旧结果不会被新的候选接受", async () => {
    const source = document.createElement("p");
    source.textContent = "Old reusable content.";
    document.body.append(source);
    Object.defineProperty(source, "getBoundingClientRect", { configurable: true, value: visibleBounds });
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const { DynamicVisibleContentController } = await import("../../src/content/dynamic-visible-content-controller");
    const invalidated: string[] = [];
    const controller = new DynamicVisibleContentController({
      document,
      discover: discoverParagraphs,
      onVisible: () => ({ requestCount: 1, domInsertions: 0 }),
      onHidden: () => undefined,
      onInvalidated: (_element, previous) => { invalidated.push(previous.normalizedText); },
      onRemoved: () => undefined,
    });
    controller.start();
    source.textContent = "New reusable content.";
    await vi.waitFor(() => expect(invalidated).toEqual(["Old reusable content."]));
    expect(controller.currentCandidate(source)?.normalizedText).toBe("New reusable content.");
  });

  it("可见块连续改写时立即失效旧结果，并只在文字稳定 200ms 后重新提交一次", async () => {
    vi.useFakeTimers();
    const source = document.createElement("p");
    source.textContent = "First readable version.";
    document.body.append(source);
    Object.defineProperty(source, "getBoundingClientRect", { configurable: true, value: visibleBounds });
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const { DynamicVisibleContentController } = await import("../../src/content/dynamic-visible-content-controller");
    const submitted: string[] = [];
    const invalidated: string[] = [];
    const controller = new DynamicVisibleContentController({
      document,
      discover: discoverParagraphs,
      onVisible: (candidate) => { submitted.push(candidate.normalizedText); return { requestCount: 1, domInsertions: 0 }; },
      onHidden: () => undefined,
      onInvalidated: (_element, candidate) => { invalidated.push(candidate.normalizedText); },
      onRemoved: () => undefined,
    });
    controller.start();
    FakeIntersectionObserver.latest?.emit(source, true);
    expect(submitted).toEqual(["First readable version."]);

    source.textContent = "Second readable version.";
    await vi.advanceTimersByTimeAsync(0);
    source.textContent = "Third readable version.";
    await vi.advanceTimersByTimeAsync(0);
    source.textContent = "Final readable version.";
    await vi.advanceTimersByTimeAsync(0);

    expect(invalidated).toEqual(["First readable version.", "Second readable version.", "Third readable version."]);
    expect(submitted).toEqual(["First readable version."]);
    await vi.advanceTimersByTimeAsync(199);
    expect(submitted).toEqual(["First readable version."]);
    await vi.advanceTimersByTimeAsync(1);
    expect(submitted).toEqual(["First readable version.", "Final readable version."]);
  });

  it("空的既有候选根被逐字填充时不提交首字符，只在稳定后提交最终文本", async () => {
    vi.useFakeTimers();
    const source = document.createElement("p");
    document.body.append(source);
    Object.defineProperty(source, "getBoundingClientRect", { configurable: true, value: visibleBounds });
    vi.stubGlobal("IntersectionObserver", undefined);
    const { DynamicVisibleContentController } = await import("../../src/content/dynamic-visible-content-controller");
    const submitted: string[] = [];
    const controller = new DynamicVisibleContentController({
      document,
      discover: (root) => discoverParagraphs(root).filter((candidate) => candidate.normalizedText.length > 0),
      isPotentialCandidateRoot: (element) => element.matches("p"),
      onVisible: (candidate) => { submitted.push(candidate.normalizedText); return { requestCount: 1, domInsertions: 0 }; },
      onHidden: () => undefined,
      onInvalidated: () => undefined,
      onRemoved: () => undefined,
    });
    controller.start();
    source.textContent = "T";
    await vi.advanceTimersByTimeAsync(50);
    source.textContent = "Th";
    await vi.advanceTimersByTimeAsync(50);
    source.textContent = "The final readable text.";
    await vi.advanceTimersByTimeAsync(199);
    expect(submitted).toEqual([]);
    const samplesBeforeTimer = controller.metrics().sampleCount;
    await vi.advanceTimersByTimeAsync(1);
    expect(submitted).toEqual(["The final readable text."]);
    expect(controller.metrics().sampleCount).toBe(samplesBeforeTimer);
    controller.stop();
  });

  it("同一可见性批次按文档阅读顺序提交，而不依赖 observer entry 顺序", async () => {
    const first = document.createElement("p");
    const second = document.createElement("p");
    first.textContent = "First readable block.";
    second.textContent = "Second readable block.";
    document.body.append(first, second);
    for (const element of [first, second]) Object.defineProperty(element, "getBoundingClientRect", { configurable: true, value: visibleBounds });
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const { DynamicVisibleContentController } = await import("../../src/content/dynamic-visible-content-controller");
    const submitted: string[] = [];
    const controller = new DynamicVisibleContentController({
      document,
      discover: discoverParagraphs,
      onVisible: (candidate) => { submitted.push(candidate.normalizedText); return { requestCount: 1, domInsertions: 0 }; },
      onHidden: () => undefined,
      onInvalidated: () => undefined,
      onRemoved: () => undefined,
    });
    controller.start();
    FakeIntersectionObserver.latest?.emitBatch([second, first]);
    expect(submitted).toEqual(["First readable block.", "Second readable block."]);
  });

  it("扩展自身 DOM 变动被忽略；静止后不产生新的扫描或请求", async () => {
    const source = document.createElement("p");
    source.textContent = "Readable dynamic content.";
    document.body.append(source);
    Object.defineProperty(source, "getBoundingClientRect", { configurable: true, value: visibleBounds });
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const { DynamicVisibleContentController } = await import("../../src/content/dynamic-visible-content-controller");
    let scans = 0;
    let requests = 0;
    const controller = new DynamicVisibleContentController({
      document,
      discover: (root) => { scans += 1; return discoverParagraphs(root); },
      isIgnoredNode: (node) => node instanceof Element && Boolean(node.closest("[data-web-translation-translation]")),
      onVisible: () => { requests += 1; return { requestCount: 1, domInsertions: 0 }; },
      onHidden: () => undefined,
      onInvalidated: () => undefined,
      onRemoved: () => undefined,
    });
    controller.start();
    FakeIntersectionObserver.latest?.emit(source, true);
    const afterStartScans = scans;
    const extensionHost = document.createElement("div");
    extensionHost.dataset.webTranslationTranslation = "root";
    document.body.append(extensionHost);
    await Promise.resolve();

    expect(scans).toBe(afterStartScans);
    expect(requests).toBe(1);
    extensionHost.remove();
    await Promise.resolve();
    expect(scans).toBe(afterStartScans);
    expect(requests).toBe(1);
    expect(controller.metrics().sampleCount).toBeGreaterThan(0);
  });

  it("累积连续 mutation batch，并为直接追加的可读根节点建立观察", async () => {
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const { DynamicVisibleContentController } = await import("../../src/content/dynamic-visible-content-controller");
    const controller = new DynamicVisibleContentController({
      document,
      discover: discoverParagraphs,
      onVisible: () => ({ requestCount: 0, domInsertions: 0 }),
      onHidden: () => undefined,
      onInvalidated: () => undefined,
      onRemoved: () => undefined,
    });
    controller.start();
    const first = document.createElement("p");
    const second = document.createElement("p");
    first.textContent = "First appended readable block.";
    second.textContent = "Second appended readable block.";
    document.body.append(first);
    await Promise.resolve();
    document.body.append(second);

    await vi.waitFor(() => {
      expect(controller.currentCandidate(first)?.normalizedText).toBe("First appended readable block.");
      expect(controller.currentCandidate(second)?.normalizedText).toBe("Second appended readable block.");
    });
  });

  it("指标使用可注入的未完成请求深度，而不是候选索引规模", async () => {
    const source = document.createElement("p");
    source.textContent = "Indexed but not pending.";
    document.body.append(source);
    Object.defineProperty(source, "getBoundingClientRect", { configurable: true, value: hiddenBounds });
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const { DynamicVisibleContentController } = await import("../../src/content/dynamic-visible-content-controller");
    const controller = new DynamicVisibleContentController({
      document,
      discover: discoverParagraphs,
      queueDepth: () => 7,
      onVisible: () => ({ requestCount: 0, domInsertions: 0 }),
      onHidden: () => undefined,
      onInvalidated: () => undefined,
      onRemoved: () => undefined,
    });
    controller.start();
    expect(controller.metrics().queueDepth).toBe(7);
  });

  it("子节点文本变为空时使既有候选失效并移除观察，而非保留旧译文身份", async () => {
    const source = document.createElement("p");
    source.textContent = "A readable block before it becomes empty.";
    document.body.append(source);
    Object.defineProperty(source, "getBoundingClientRect", { configurable: true, value: visibleBounds });
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const { DynamicVisibleContentController } = await import("../../src/content/dynamic-visible-content-controller");
    const invalidated: string[] = [];
    const controller = new DynamicVisibleContentController({
      document,
      discover: (root) => discoverParagraphs(root).filter((candidate) => candidate.normalizedText.trim().length > 0),
      onVisible: () => ({ requestCount: 1, domInsertions: 0 }),
      onHidden: () => undefined,
      onInvalidated: (_element, candidate) => { invalidated.push(candidate.normalizedText); },
      onRemoved: () => undefined,
    });
    controller.start();
    source.textContent = "";

    await vi.waitFor(() => expect(invalidated).toEqual(["A readable block before it becomes empty."]));
    expect(controller.currentCandidate(source)).toBeUndefined();
    expect(FakeIntersectionObserver.latest?.observed.has(source)).toBe(false);
  });

  it("无 IntersectionObserver 的兼容路径将滚动 burst 合并为一个动画帧检查", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const frames: FrameRequestCallback[] = [];
    Object.defineProperty(window, "requestAnimationFrame", { configurable: true, value: vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length; }) });
    const source = document.createElement("p");
    source.textContent = "A readable fallback block.";
    document.body.append(source);
    Object.defineProperty(source, "getBoundingClientRect", { configurable: true, value: visibleBounds });
    const { DynamicVisibleContentController } = await import("../../src/content/dynamic-visible-content-controller");
    const controller = new DynamicVisibleContentController({
      document,
      discover: discoverParagraphs,
      onVisible: () => ({ requestCount: 1, domInsertions: 0 }),
      onHidden: () => undefined,
      onInvalidated: () => undefined,
      onRemoved: () => undefined,
    });
    controller.start();
    const beforeBurstSamples = controller.metrics().sampleCount;
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));

    expect(frames).toHaveLength(1);
    expect(controller.metrics().sampleCount).toBe(beforeBurstSamples);
    frames[0]?.(0);
    expect(controller.metrics().sampleCount).toBe(beforeBurstSamples + 1);
  });

  it("重叠的新增子树和已索引祖先不会把仍被发现的候选错误剪除", async () => {
    const article = document.createElement("article");
    article.textContent = "Standalone readable article.";
    document.body.append(article);
    Object.defineProperty(article, "getBoundingClientRect", { configurable: true, value: visibleBounds });
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const { DynamicVisibleContentController } = await import("../../src/content/dynamic-visible-content-controller");
    const invalidated: HTMLElement[] = [];
    const discover = (root: ParentNode) => {
      const elements = [
        ...(root instanceof HTMLElement && root.matches("article, p") ? [root] : []),
        ...Array.from(root.querySelectorAll<HTMLElement>("article, p")),
      ];
      return elements.map((element) => ({ element, text: element.textContent ?? "", normalizedText: element.textContent ?? "" }));
    };
    const controller = new DynamicVisibleContentController({
      document,
      discover,
      onVisible: () => ({ requestCount: 0, domInsertions: 0 }),
      onHidden: () => undefined,
      onInvalidated: (element) => { invalidated.push(element); },
      onRemoved: () => undefined,
    });
    controller.start();
    const paragraph = document.createElement("p");
    paragraph.textContent = "Nested readable paragraph.";
    Object.defineProperty(paragraph, "getBoundingClientRect", { configurable: true, value: visibleBounds });
    article.append(paragraph);

    await vi.waitFor(() => expect(controller.currentCandidate(paragraph)?.normalizedText).toBe("Nested readable paragraph."));
    expect(FakeIntersectionObserver.latest?.observed.has(paragraph)).toBe(true);
    expect(invalidated).not.toContain(paragraph);
  });

  it("同一 task 内移除再插入的节点仍按 removedNodes 失效，避免复用旧译文身份", async () => {
    const firstParent = document.createElement("section");
    const secondParent = document.createElement("section");
    const source = document.createElement("p");
    source.textContent = "A synchronously moved readable block.";
    firstParent.append(source);
    document.body.append(firstParent, secondParent);
    Object.defineProperty(source, "getBoundingClientRect", { configurable: true, value: visibleBounds });
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const { DynamicVisibleContentController } = await import("../../src/content/dynamic-visible-content-controller");
    const invalidated: HTMLElement[] = [];
    const controller = new DynamicVisibleContentController({
      document,
      discover: discoverParagraphs,
      onVisible: () => ({ requestCount: 1, domInsertions: 0 }),
      onHidden: () => undefined,
      onInvalidated: (element) => { invalidated.push(element); },
      onRemoved: () => undefined,
    });
    controller.start();
    source.remove();
    secondParent.append(source);

    await vi.waitFor(() => expect(invalidated).toContain(source));
    await vi.waitFor(() => expect(controller.currentCandidate(source)?.normalizedText).toBe("A synchronously moved readable block."));
  });

  it("原本为空的潜在阅读容器及其 span 子节点异步填入文本后进入候选索引", async () => {
    const source = document.createElement("p");
    const wrapper = document.createElement("span");
    source.append(wrapper);
    document.body.append(source);
    Object.defineProperty(source, "getBoundingClientRect", { configurable: true, value: hiddenBounds });
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const { DynamicVisibleContentController } = await import("../../src/content/dynamic-visible-content-controller");
    const controller = new DynamicVisibleContentController({
      document,
      discover: (root) => discoverParagraphs(root).filter((candidate) => candidate.normalizedText.length > 0),
      isPotentialCandidateRoot: (element) => element.matches("p"),
      onVisible: () => ({ requestCount: 1, domInsertions: 0 }),
      onHidden: () => undefined,
      onInvalidated: () => undefined,
      onRemoved: () => undefined,
    });
    controller.start();
    expect(controller.currentCandidate(source)).toBeUndefined();
    wrapper.textContent = "This text arrived after its empty container.";

    await vi.waitFor(() => expect(controller.currentCandidate(source)?.normalizedText).toBe("This text arrived after its empty container."));
    expect(FakeIntersectionObserver.latest?.observed.has(source)).toBe(true);
  });
});
