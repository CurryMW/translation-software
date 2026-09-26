// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverFirstStaticContentBlock, discoverStaticContentBlocks, discoverStaticContentBlocksWithin } from "../../src/content/static-content-discovery";

afterEach(() => { document.documentElement.innerHTML = ""; });

function makeVisible(element: Element): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ top: 20, right: 600, bottom: 80, left: 20, width: 580, height: 60 }),
  });
}

function visibleFixture(): void {
  for (const element of Array.from(document.querySelectorAll("[data-fixture-id]"))) makeVisible(element);
}

describe("静态页面内容发现行为接缝", () => {
  it("以与普通 DOM 相同的安全边界发现开放及嵌套开放 Shadow DOM，并静默跳过 closed Shadow DOM", () => {
    document.body.innerHTML = `
      <p data-fixture-id="ordinary">A readable ordinary document sentence.</p>
      <section data-fixture-id="open-host"></section>
      <section data-fixture-id="closed-host"></section>
    `;
    const openHost = document.querySelector<HTMLElement>("[data-fixture-id='open-host']")!;
    const openRoot = openHost.attachShadow({ mode: "open" });
    openRoot.innerHTML = `
      <p data-fixture-id="open-shadow">A readable open shadow sentence.</p>
      <div data-fixture-id="nested-host"></div>
    `;
    const nestedRoot = openRoot.querySelector<HTMLElement>("[data-fixture-id='nested-host']")!.attachShadow({ mode: "open" });
    nestedRoot.innerHTML = '<p data-fixture-id="nested-open-shadow">A readable nested shadow sentence.</p>';
    const closedRoot = document.querySelector<HTMLElement>("[data-fixture-id='closed-host']")!.attachShadow({ mode: "closed" });
    closedRoot.innerHTML = '<p data-fixture-id="closed-shadow">A readable closed shadow sentence.</p>';
    for (const element of [
      document.querySelector<HTMLElement>("[data-fixture-id='ordinary']")!,
      openRoot.querySelector<HTMLElement>("[data-fixture-id='open-shadow']")!,
      nestedRoot.querySelector<HTMLElement>("[data-fixture-id='nested-open-shadow']")!,
    ]) makeVisible(element);

    const result = discoverStaticContentBlocks(document);

    expect(result.candidates.map(({ element }) => element.dataset.fixtureId)).toEqual([
      "ordinary", "open-shadow", "nested-open-shadow",
    ]);
    expect(result.candidates.map(({ text }) => text)).not.toContain("A readable closed shadow sentence.");
  });

  it("为每种默认阅读内容块产生一个候选", () => {
    document.body.innerHTML = `
      <h1 data-fixture-id="title">A concise foreign heading</h1>
      <p data-fixture-id="body">A readable foreign paragraph.</p>
      <ul><li data-fixture-id="list-item">A readable list item.</li></ul>
      <article data-fixture-id="post">A standalone post body.</article>
      <article data-fixture-id="comment">A standalone comment body.</article>
      <figure><figcaption data-fixture-id="caption">A descriptive caption.</figcaption></figure>
      <blockquote data-fixture-id="quote">A quoted foreign statement.</blockquote>
    `;
    visibleFixture();

    const result = discoverStaticContentBlocks(document);

    expect(result.candidates.map(({ element }) => element.dataset.fixtureId)).toEqual([
      "title", "body", "list-item", "post", "comment", "caption", "quote",
    ]);
    expect(result.skipped).toEqual([]);
  });

  it("首候选预检与完整发现的第一个候选一致，且不遍历后续元素", () => {
    document.body.innerHTML = `
      <p data-fixture-id="first">This is the first readable sentence.</p>
      <p data-fixture-id="later">This is a later readable sentence.</p>
    `;
    visibleFixture();
    const later = document.querySelector<HTMLElement>("[data-fixture-id='later']")!;
    Object.defineProperty(later, "getBoundingClientRect", {
      configurable: true,
      value: () => { throw new Error("首候选预检不应检查后续元素"); },
    });

    expect(discoverFirstStaticContentBlock(document)?.element.dataset.fixtureId).toBe("first");
  });

  it("增量发现索引结构可见但屏外的新块，视口门由动态控制器负责", () => {
    document.body.innerHTML = '<p data-fixture-id="offscreen-dynamic">This is readable English content that will be translated.</p>';
    const block = document.querySelector<HTMLElement>("[data-fixture-id='offscreen-dynamic']")!;
    Object.defineProperty(block, "getBoundingClientRect", { configurable: true, value: () => ({ top: 1600, right: 600, bottom: 1660, left: 20, width: 580, height: 60 }) });

    expect(discoverStaticContentBlocks(document).candidates).toEqual([]);
    expect(discoverStaticContentBlocksWithin(document, block).candidates.map(({ element }) => element.dataset.fixtureId)).toEqual(["offscreen-dynamic"]);
  });

  it("发现 UI、链接、账号文本，同时仍跳过表单、隐藏内容和扩展自身 DOM", () => {
    document.body.innerHTML = `
      <nav><p data-fixture-id="navigation">A navigation sentence.</p></nav>
      <div role="toolbar"><p data-fixture-id="toolbar">A toolbar sentence.</p></div>
      <menu><p data-fixture-id="menu">A menu sentence.</p></menu>
      <footer><p data-fixture-id="footer">A footer sentence.</p></footer>
      <aside data-ad><p data-fixture-id="advertisement">An advertisement sentence.</p></aside>
      <form><p data-fixture-id="form">A form sentence.</p></form>
      <div contenteditable="true"><p data-fixture-id="editable">An editable sentence.</p></div>
      <p data-fixture-id="username" data-username>An account name.</p>
      <p data-fixture-id="author" rel="author">An author name.</p>
      <p data-fixture-id="linked-only"><a href="#">A linked sentence.</a></p>
      <p data-fixture-id="linked-incomplete">Read <a href="#">this</a></p>
      <p data-fixture-id="linked-complete">One independent sentence. <a href="#">Reference</a> Another independent sentence.</p>
      <p data-fixture-id="linked-short-safe">Bonjour monde <a href="#">Reference</a></p>
      <p data-fixture-id="linked-single-word-safe">Bonjour <a href="#">Reference</a></p>
      <p data-fixture-id="linked-single-word-title">Amazing <a href="#">Reference</a></p>
      <p data-fixture-id="linked-non-english-incomplete">Lire <a href="#">Reference</a></p>
      <a href="#"><article data-fixture-id="linked-wrapper">A wrapped link sentence.</article></a>
      <a href="#"><p data-fixture-id="linked-paragraph-wrapper">A wrapped link paragraph.</p></a>
      <a href="#" role="article" data-fixture-id="linked-role-article">A wrapped link article.</a>
      <div role="LINK external"><article data-fixture-id="linked-uppercase-role">A wrapped role link article.</article></div>
      <p data-fixture-id="aria-hidden" aria-hidden="true">A hidden sentence.</p>
      <p data-fixture-id="collapsed" aria-expanded="false">A collapsed sentence.</p>
      <p data-fixture-id="display-none" style="display: none">A hidden sentence.</p>
      <p data-fixture-id="visibility-hidden" style="visibility: hidden">A hidden sentence.</p>
      <p data-fixture-id="opacity-hidden" style="opacity: 0">A hidden sentence.</p>
      <p data-fixture-id="offscreen">An offscreen sentence.</p>
      <div data-web-translation-translation="root"><p data-fixture-id="extension">An extension sentence.</p></div>
    `;
    visibleFixture();
    Object.defineProperty(document.querySelector("[data-fixture-id='offscreen']"), "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top: 1200, right: 600, bottom: 1260, left: 20, width: 580, height: 60 }),
    });
    const log = vi.spyOn(console, "log");

    const result = discoverStaticContentBlocks(document);

    expect(result.candidates.map(({ element }) => element.dataset.fixtureId)).toEqual(["navigation", "toolbar", "menu", "footer", "advertisement", "username", "author", "linked-only", "linked-incomplete", "linked-complete", "linked-short-safe", "linked-single-word-safe", "linked-single-word-title", "linked-non-english-incomplete", "linked-wrapper", "linked-paragraph-wrapper", "linked-role-article", "linked-uppercase-role"]);
    expect(result.candidates.find(({ element }) => element.dataset.fixtureId === "linked-complete")?.normalizedText.length).toBe("One independent sentence. Reference Another independent sentence.".length);
    expect(result.skipped.filter(({ element }) => element.dataset.fixtureId).map(({ element }) => element.dataset.fixtureId)).toEqual([
      "form", "editable", "aria-hidden", "collapsed", "display-none", "visibility-hidden", "opacity-hidden", "offscreen", "extension",
    ]);
    expect(log).not.toHaveBeenCalled();
  });

  it("只保留最小完整语义块，并保留短外语短语而跳过无语言文本", () => {
    document.body.innerHTML = `
      <article data-fixture-id="parent"><p data-fixture-id="child">A nested readable paragraph.</p></article>
      <p data-fixture-id="short">Bonjour monde</p>
      <p data-fixture-id="number">12345</p>
      <p data-fixture-id="punctuation">!?…</p>
      <p data-fixture-id="emoji">🦊✨</p>
    `;
    visibleFixture();

    const result = discoverStaticContentBlocks(document);

    expect(result.candidates.map(({ element }) => element.dataset.fixtureId)).toEqual(["child", "short"]);
    expect(result.skipped.filter(({ element }) => element.dataset.fixtureId).map(({ element, reason }) => [element.dataset.fixtureId, reason])).toEqual([
      ["parent", "nested-readable-block"],
      ["number", "not-translatable"],
      ["punctuation", "not-translatable"],
      ["emoji", "not-translatable"],
    ]);
  });

  it("发现层保留含 Unicode 字母的中文阅读内容，把方向与混合比例交给语言策略", () => {
    document.body.innerHTML = `
      <p data-fixture-id="chinese">这是一段可以翻译为其他目标语言的阅读内容。</p>
      <p data-fixture-id="number">12345</p>
    `;
    visibleFixture();

    const result = discoverStaticContentBlocks(document);

    expect(result.candidates.map(({ element }) => element.dataset.fixtureId)).toEqual(["chinese"]);
    expect(result.skipped.map(({ element, reason }) => [element.dataset.fixtureId, reason])).toEqual([["number", "not-translatable"]]);
  });

  it("覆盖核心站点的语义内容锚点，同时排除虚拟列表元数据、代码和嵌套评论 UI", () => {
    document.body.innerHTML = `
      <section data-site-fixture="x">
        <article data-fixture-id="x-post">
          <div data-testid="tweetText" data-fixture-id="x-text">A synthetic timeline post with readable text.</div>
          <div data-testid="User-Name"><span data-username>synthetic-user</span></div>
          <button data-testid="bookmark">Bookmark</button>
        </article>
      </section>
      <main data-site-fixture="wikipedia">
        <h1 data-fixture-id="wiki-title">A synthetic encyclopedia heading</h1>
        <p data-fixture-id="wiki-paragraph">A paragraph with <a href="/synthetic-link">an excluded inline link</a> and readable prose.</p>
      </main>
      <section data-site-fixture="github">
        <h2 data-fixture-id="github-title">A synthetic discussion title</h2>
        <div class="markdown-body" data-fixture-id="github-body">
          <p data-fixture-id="github-prose">A discussion paragraph with <code>inline_code()</code> kept outside the prose boundary.</p>
          <pre data-fixture-id="github-code"><code>const secret = "synthetic";</code></pre>
        </div>
      </section>
      <table data-site-fixture="hacker-news"><tbody>
        <tr class="athing comtr"><td><div class="commtext c00" data-fixture-id="hn-parent">A synthetic parent comment.</div></td></tr>
        <tr class="athing comtr"><td><div class="commtext c00" data-fixture-id="hn-child">A synthetic nested child comment with <a href="/reply">reply metadata</a>.</div></td></tr>
        <tr class="athing comtr"><td><div class="commtext c00" data-fixture-id="hn-link-only"><a href="/story">A linked-only comment</a></div></td></tr>
      </tbody></table>
    `;
    visibleFixture();
    for (const element of Array.from(document.querySelectorAll<HTMLElement>("[data-fixture-id='x-text'], [data-fixture-id='github-body'], [data-fixture-id='hn-parent'], [data-fixture-id='hn-child'], [data-fixture-id='hn-link-only']"))) {
      makeVisible(element);
    }

    const result = discoverStaticContentBlocks(document);

    expect(result.candidates.map(({ element }) => element.dataset.fixtureId)).toEqual([
      "x-text", "wiki-title", "wiki-paragraph", "github-title", "github-prose", "hn-parent", "hn-child", "hn-link-only",
    ]);
    expect(result.candidates.find(({ element }) => element.dataset.fixtureId === "wiki-paragraph")?.text).toBe("A paragraph with an excluded inline link and readable prose.");
    expect(result.candidates.find(({ element }) => element.dataset.fixtureId === "github-prose")?.text).toBe("A discussion paragraph with kept outside the prose boundary.");
    expect(result.skipped.filter(({ element }) => element.dataset.fixtureId).map(({ element, reason }) => [element.dataset.fixtureId, reason])).toEqual([
      ["x-post", "nested-readable-block"],
      ["github-code", "unsafe-context"],
    ]);
  });

  it("可翻译 UI 和账号标签，但仍跳过编辑内容和代码", () => {
    document.body.innerHTML = `
      <p data-fixture-id="button-only"><button>An action label.</button></p>
      <p data-fixture-id="role-button-only"><span role="button">A role action label.</span></p>
      <p data-fixture-id="editable-only"><span contenteditable="true">An editable value.</span></p>
      <p data-fixture-id="username-only"><span data-username>An account name.</span></p>
      <p data-fixture-id="code-only"><code>A code expression.</code></p>
      <p data-fixture-id="link-only"><a href="#">A linked label.</a></p>
    `;
    visibleFixture();

    const result = discoverStaticContentBlocks(document);

    expect(result.candidates.map(({ element }) => element.dataset.fixtureId)).toEqual(["button-only", "role-button-only", "username-only", "link-only"]);
    expect(result.skipped.filter(({ element }) => element.dataset.fixtureId).map(({ element, reason }) => [element.dataset.fixtureId, reason])).toEqual([
      ["editable-only", "excluded-descendant-content"],
      ["code-only", "excluded-descendant-content"],
    ]);
  });

  it("移除候选内部的 UI 容器和不可见后代，只保留完整安全片段", () => {
    const safeSentence = "A complete reading sentence.";
    document.body.innerHTML = `
      <article data-fixture-id="safe-fragment">${safeSentence}
        <nav><p>A navigation label.</p></nav><menu>A menu label.</menu><footer>A footer label.</footer><aside>An aside label.</aside>
        <span aria-hidden="true">A hidden label.</span><span hidden>A hidden label.</span><span aria-expanded="false">A hidden label.</span>
        <span style="display: none">A hidden label.</span><span style="visibility: hidden">A hidden label.</span><span style="opacity: 0">A hidden label.</span>
      </article>
      <article data-fixture-id="incomplete-fragment"><nav>A navigation label.</nav><span aria-hidden="true">A hidden label.</span></article>
    `;
    visibleFixture();

    const result = discoverStaticContentBlocks(document);

    expect(result.candidates.map(({ element }) => element.dataset.fixtureId)).toEqual(["safe-fragment", "incomplete-fragment"]);
    expect(result.candidates[0]?.normalizedText).toContain("A complete reading sentence.");
    expect(result.skipped.filter(({ element }) => element.dataset.fixtureId).map(({ element, reason }) => [element.dataset.fixtureId, reason])).toEqual([]);
  });
});
