import { expect, test } from "@playwright/test";
import { chromium, type BrowserContext } from "playwright";
import { execFile as execFileCallback } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

async function createLocalhostCertificate(directory: string) {
  const keyPath = path.join(directory, "localhost-key.pem");
  const certificatePath = path.join(directory, "localhost-cert.pem");
  await execFile("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-keyout",
    keyPath,
    "-out",
    certificatePath,
    "-days",
    "1",
    "-nodes",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
  ]);
  return Promise.all([readFile(keyPath), readFile(certificatePath)]);
}

test("真实 dist 默认不注入页面，也不拥有本地网站主机权限", async () => {
  const contentBundle = await readFile(path.resolve("dist/content-script.js"), "utf8");
  expect(contentBundle).not.toContain("baiduCredentials");
  expect(contentBundle).not.toContain("storage.local");
  expect(contentBundle).not.toContain("Download the React DevTools");
  expect((await stat(path.resolve("dist/content-script.js"))).size).toBeLessThan(300_000);
  const profileDirectory = await mkdtemp(path.join(tmpdir(), "web-translation-extension-"));
  const fixture = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><body><main data-local-fixture></main></body></html>");
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error("本地夹具未能分配端口");

  let context: BrowserContext | undefined;

  try {
    context = await chromium.launchPersistentContext(profileDirectory, {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${path.resolve("dist")}`,
        `--load-extension=${path.resolve("dist")}`,
      ],
    });
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    expect(extensionId).not.toHaveLength(0);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.getByText("尚未配置翻译服务")).toBeVisible();

    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.getByLabel("百度 APPID").fill("test-app");
    await options.getByLabel("密钥").fill("x");
    await options.getByRole("button", { name: "保存凭据" }).click();
    await expect(options.getByText("已配置翻译服务")).toBeVisible();
    await expect(options.getByLabel("密钥")).toHaveValue("");
    await expect(options.locator("body")).not.toContainText("x");

    const localPage = await context.newPage();
    await localPage.goto(`http://127.0.0.1:${address.port}/`);
    const shellMarker = localPage.locator("[data-web-translation-extension-shell='ready']");
    await expect(shellMarker).toHaveCount(0);

    await localPage.bringToFront();
    await expect(shellMarker).toHaveCount(0);
    await expect(worker.evaluate(() => chrome.permissions.contains({ origins: ["http://127.0.0.1/*"] }))).resolves.toBe(false);
  } finally {
    await context?.close();
    await new Promise<void>((resolve, reject) => fixture.close((error) => (error ? reject(error) : resolve())));
    await rm(profileDirectory, { recursive: true, force: true });
  }
});

test("预授权后的用户开启链路：真实 dist 在可视静态文本下显示 Fake 译文", async () => {
  test.setTimeout(90_000);
  const profileDirectory = await mkdtemp(path.join(tmpdir(), "web-translation-extension-"));
  const extensionDirectory = await mkdtemp(path.join(tmpdir(), "web-translation-extension-dist-"));
  const childFixture = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end('<!doctype html><html><body><p data-fixture-id="frame-body">A readable permitted frame sentence.</p></body></html>');
  });
  await new Promise<void>((resolve) => childFixture.listen(0, "127.0.0.1", resolve));
  const childAddress = childFixture.address();
  if (!childAddress || typeof childAddress === "string") throw new Error("子 frame 夹具未能分配端口");
  const [deniedKey, deniedCertificate] = await createLocalhostCertificate(extensionDirectory);
  const deniedFixture = createSecureServer({ key: deniedKey, cert: deniedCertificate }, (_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end('<!doctype html><html><body><p data-fixture-id="denied-frame-body">A readable denied frame sentence.</p></body></html>');
  });
  await new Promise<void>((resolve) => deniedFixture.listen(0, "127.0.0.1", resolve));
  const deniedAddress = deniedFixture.address();
  if (!deniedAddress || typeof deniedAddress === "string") throw new Error("未授权子 frame 夹具未能分配端口");
  const fixture = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (request.url === "/same-origin-frame") {
      response.end('<!doctype html><html><body><p data-fixture-id="same-origin-frame-body">A readable same-origin frame sentence.</p></body></html>');
      return;
    }
    response.end(`<!doctype html><html><head><title>Web translation fixture</title><style>body { color: fuchsia; background: #fff; } main > div { display: none !important; }</style></head><body>
      <main>
        <h1 data-fixture-id="title">This is a readable English sentence.</h1>
        <p data-fixture-id="body" data-web-translation-static-block>This is a readable English sentence.</p>
        <p data-fixture-id="long-paragraph" data-web-translation-static-block>${"Sentence. ".repeat(120)}<br><br>Final paragraph.</p>
        <ul><li data-fixture-id="list-item">This is a readable English sentence.</li></ul>
        <article data-fixture-id="post">This is a readable English sentence.</article>
        <article data-fixture-id="comment">This is a readable English sentence.</article>
        <figure><figcaption data-fixture-id="caption">This is a readable English sentence.</figcaption></figure>
        <blockquote data-fixture-id="quote">This is a readable English sentence.</blockquote>
        <section id="shadow-host"></section>
        <section id="closed-shadow-host"></section>
        <canvas id="synthetic-canvas" aria-label="Synthetic canvas words"></canvas>
        <img id="synthetic-image" alt="Synthetic image words" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">
        <iframe id="same-origin-frame" title="same origin synthetic frame" src="/same-origin-frame"></iframe>
        <iframe id="permitted-frame" title="permitted synthetic frame" src="http://127.0.0.1:${childAddress.port}/embedded"></iframe>
        <iframe id="unpermitted-frame" title="unpermitted synthetic frame" src="https://127.0.0.1:${deniedAddress.port}/unavailable"></iframe>
        <section id="excluded">
          <nav><p>A navigation sentence.</p></nav><menu><p>A menu sentence.</p></menu><button>An action label.</button>
          <pre>A code expression.</pre><form><p>A form value.</p></form><p contenteditable="true">An editable value.</p>
          <p data-username>An account name.</p><p aria-hidden="true">A hidden sentence.</p><p><a href="#">A linked label.</a></p>
        </section>
      </main>
      <script>
        const shadow = document.querySelector('#shadow-host').attachShadow({ mode: 'open' });
        shadow.innerHTML = '<p data-fixture-id="shadow-body">A readable open shadow sentence.</p><div id="nested-shadow-host"></div>';
        shadow.querySelector('#nested-shadow-host')?.attachShadow({ mode: 'open' }).append(document.createRange().createContextualFragment('<p data-fixture-id="nested-shadow-body">A readable nested shadow sentence.</p>'));
        const closed = document.querySelector('#closed-shadow-host').attachShadow({ mode: 'closed' });
        const closedSource = document.createElement('p');
        closedSource.textContent = 'A closed shadow sentence that must stay unread.';
        closed.append(closedSource);
        window.__closedShadowSource = closedSource;
      </script>
    </body></html>`);
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error("本地夹具未能分配端口");
  // Harness 只复制生产构建 JS；临时 manifest 预授权本地夹具，原生 optional-host 提示由 #13 的 Chrome Stable 人工验收覆盖。
  await cp(path.resolve("dist"), extensionDirectory, { recursive: true });
  const manifestPath = path.join(extensionDirectory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  manifest.host_permissions = ["http://127.0.0.1/*"];
  await writeFile(manifestPath, JSON.stringify(manifest));
  let context: BrowserContext | undefined;

  try {
    context = await chromium.launchPersistentContext(profileDirectory, {
      channel: "chromium",
      headless: true,
      ignoreHTTPSErrors: true,
      args: [`--disable-extensions-except=${extensionDirectory}`, `--load-extension=${extensionDirectory}`],
    });
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    const localPage = await context.newPage();
    await localPage.goto(`http://127.0.0.1:${address.port}/`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    const submittedCharacters = () => popup.evaluate(async () => {
      const result = await chrome.runtime.sendMessage({ type: "translation-usage.get" }) as {
        snapshot?: { submittedCharacters?: unknown };
      };
      return typeof result.snapshot?.submittedCharacters === "number" ? result.snapshot.submittedCharacters : -1;
    });
    await localPage.bringToFront();
    await popup.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(popup.getByRole("button", { name: "开启此网站翻译" })).toBeVisible();
    await popup.getByRole("button", { name: "开启此网站翻译" }).click();
    await expect(popup.getByText("此网站翻译已开启")).toBeVisible();
    const translationHost = localPage.locator("[data-web-translation-translation='root']");
    const confirmation = localPage.locator("[data-web-translation-tab-session-prompt]");
    await expect(confirmation).toHaveCount(1);
    await expect(translationHost).toHaveCount(0);
    const submittedBeforeConfirmation = await submittedCharacters();
    await confirmation.locator("button[data-action='accept']").click();
    await expect.poll(submittedCharacters, { intervals: [10] }).toBeGreaterThan(submittedBeforeConfirmation);

    const source = localPage.locator("[data-fixture-id='body']");
    await expect(source).toHaveText("This is a readable English sentence.");
    for (const fixtureId of ["title", "body", "list-item", "post", "comment", "caption", "quote"]) {
      await localPage.locator(`[data-fixture-id='${fixtureId}']`).scrollIntoViewIfNeeded();
      const host = localPage.locator(`[data-fixture-id='${fixtureId}'] + [data-web-translation-translation='root']`);
      await expect(host).toHaveCount(1);
      await expect(host).toBeVisible();
    }
    await expect(localPage.locator("#excluded [data-web-translation-translation='root']")).toHaveCount(0);
    await localPage.evaluate(() => document.querySelector("#shadow-host")?.shadowRoot?.querySelector<HTMLElement>("[data-fixture-id='shadow-body']")?.scrollIntoView({ block: "center" }));
    await expect.poll(() => localPage.evaluate(() => document.querySelector("#shadow-host")?.shadowRoot?.querySelector("[data-fixture-id='shadow-body']")?.nextElementSibling?.shadowRoot?.textContent ?? ""), { timeout: 25_000 }).toContain("这是可见文本块的固定中文译文。");
    await expect.poll(() => localPage.evaluate(() => document.querySelector("#shadow-host")?.shadowRoot?.querySelector("#nested-shadow-host")?.shadowRoot?.querySelector("[data-fixture-id='nested-shadow-body']")?.nextElementSibling?.shadowRoot?.textContent ?? ""), { timeout: 25_000 }).toContain("这是可见文本块的固定中文译文。");
    await expect.poll(() => localPage.evaluate(() => Boolean((window as Window & { __closedShadowSource?: Element }).__closedShadowSource?.nextElementSibling))).toBe(false);
    await expect(localPage.locator("#synthetic-canvas + [data-web-translation-translation='root'], #synthetic-image + [data-web-translation-translation='root']")).toHaveCount(0);
    await localPage.locator("#same-origin-frame").scrollIntoViewIfNeeded();
    const sameOriginFrame = localPage.frameLocator("#same-origin-frame");
    await expect(sameOriginFrame.locator("[data-web-translation-extension-shell='ready']")).toHaveCount(1);
    await expect(sameOriginFrame.locator("[data-web-translation-tab-session-prompt]")).toHaveCount(0);
    const sameOriginFrameHost = sameOriginFrame.locator("[data-fixture-id='same-origin-frame-body'] + [data-web-translation-translation='root']");
    await expect(sameOriginFrameHost).toHaveCount(1);
    await expect.poll(() => sameOriginFrameHost.evaluate((host) => host.shadowRoot?.textContent || ""), { timeout: 25_000 }).toContain("这是可见文本块的固定中文译文。");
    await localPage.locator("#permitted-frame").scrollIntoViewIfNeeded();
    const permittedFrame = localPage.frameLocator("#permitted-frame");
    await expect(permittedFrame.locator("[data-web-translation-extension-shell='ready']")).toHaveCount(1);
    await expect(permittedFrame.locator("[data-web-translation-tab-session-prompt]")).toHaveCount(0);
    const permittedFrameHost = permittedFrame.locator("[data-fixture-id='frame-body'] + [data-web-translation-translation='root']");
    await expect(permittedFrameHost).toHaveCount(1);
    await expect.poll(() => permittedFrameHost.evaluate((host) => host.shadowRoot?.textContent ?? ""), { timeout: 25_000 }).toContain("这是可见文本块的固定中文译文。");
    const submittedBeforeDeniedFrame = await submittedCharacters();
    await localPage.locator("#unpermitted-frame").scrollIntoViewIfNeeded();
    const deniedFrame = localPage.frameLocator("#unpermitted-frame");
    await expect(deniedFrame.locator("[data-fixture-id='denied-frame-body']")).toBeVisible();
    await localPage.waitForTimeout(350);
    await expect(deniedFrame.locator("[data-web-translation-extension-shell]")).toHaveCount(0);
    await expect(deniedFrame.locator("[data-web-translation-translation='root']")).toHaveCount(0);
    await expect(await submittedCharacters()).toBe(submittedBeforeDeniedFrame);
    const submittedBeforeChildRoute = await submittedCharacters();
    await permittedFrame.locator("body").evaluate(() => {
      history.pushState({ localFixture: true }, "", "/embedded-next");
      document.body.innerHTML = '<p data-fixture-id="frame-route-body">A readable permitted frame sentence.</p>';
    });
    await localPage.locator("#permitted-frame").scrollIntoViewIfNeeded();
    const routedFrameHost = permittedFrame.locator("[data-fixture-id='frame-route-body'] + [data-web-translation-translation='root']");
    await expect(routedFrameHost).toHaveCount(1);
    await expect.poll(() => routedFrameHost.evaluate((host) => host.shadowRoot?.textContent ?? ""), { timeout: 25_000 }).toContain("这是可见文本块的固定中文译文。");
    await expect.poll(submittedCharacters, { intervals: [10] }).toBeGreaterThan(submittedBeforeChildRoute);
    await expect.poll(() => sameOriginFrameHost.evaluate((host) => host.shadowRoot?.textContent ?? "")).toContain("这是可见文本块的固定中文译文。");
    await permittedFrame.locator("body").evaluate(() => {
      const block = document.createElement("p");
      block.id = "frame-unload-pending";
      block.textContent = `${"Sentence. ".repeat(120)}Final frame sentence.`;
      document.body.append(block);
    });
    await localPage.locator("#permitted-frame").scrollIntoViewIfNeeded();
    await permittedFrame.locator("#frame-unload-pending").scrollIntoViewIfNeeded();
    const pendingFrameHost = permittedFrame.locator("#frame-unload-pending + [data-web-translation-translation='root']");
    await expect(pendingFrameHost).toHaveCount(1);
    await expect(pendingFrameHost.locator(".translation__loading")).toBeVisible();
    const oldPendingFrameHost = await pendingFrameHost.elementHandle();
    const submittedAfterPendingStart = await submittedCharacters();
    await localPage.locator("#permitted-frame").evaluate((frame, nextSource) => {
      frame.setAttribute("src", nextSource as string);
    }, `http://127.0.0.1:${childAddress.port}/reloaded-document`);
    await expect.poll(async () => {
      try {
        return await oldPendingFrameHost?.evaluate((host) => !host.isConnected);
      } catch {
        // A full iframe navigation destroys the old execution context, which
        // is the browser-level equivalent of an unloaded host.
        return true;
      }
    }).toBe(true);
    await localPage.locator("#permitted-frame").scrollIntoViewIfNeeded();
    const reloadedFrameHost = permittedFrame.locator("[data-fixture-id='frame-body'] + [data-web-translation-translation='root']");
    await expect(reloadedFrameHost).toHaveCount(1);
    await expect.poll(() => reloadedFrameHost.evaluate((host) => host.shadowRoot?.textContent ?? ""), { timeout: 25_000 }).toContain("这是可见文本块的固定中文译文。");
    await expect.poll(submittedCharacters, { intervals: [10] }).toBeGreaterThan(submittedAfterPendingStart);
    await expect.poll(() => sameOriginFrameHost.evaluate((host) => host.shadowRoot?.textContent ?? "")).toContain("这是可见文本块的固定中文译文。");
    await expect.poll(() => translationHost.first().evaluate((host) => host.shadowRoot?.textContent ?? "")).toContain("这是可见文本块的固定中文译文。");
    const firstTranslationHost = translationHost.first();
    await expect(firstTranslationHost).toBeVisible();
    await expect.poll(() => localPage.evaluate(() => document.querySelector("[data-web-translation-translation='root']")?.shadowRoot?.textContent ?? "")).toContain("这是可见文本块的固定中文译文。");
    await localPage.locator("[data-fixture-id='long-paragraph']").scrollIntoViewIfNeeded();
    const longHost = localPage.locator("[data-fixture-id='long-paragraph'] + [data-web-translation-translation='root']");
    await expect(longHost).toHaveCount(1);
    await expect.poll(() => longHost.evaluate((host) => host.shadowRoot?.querySelector(".translation__text")?.textContent ?? ""), { timeout: 25_000 }).toContain("\n\n这是可见文本块的固定中文译文。");
    await expect.poll(() => longHost.evaluate((host) => (host.shadowRoot?.querySelector(".translation__text")?.textContent?.match(/这是可见文本块的固定中文译文。/g) ?? []).length), { timeout: 25_000 }).toBe(3);
    await popup.getByLabel("目标语言").selectOption("jp");
    await expect(popup.getByText("目标语言：日语")).toBeVisible();
    await expect.poll(() => localPage.evaluate(() => document.querySelector("[data-web-translation-translation='root']")?.shadowRoot?.textContent ?? ""), { intervals: [10] }).toContain("正在翻译…");
    await expect.poll(() => localPage.evaluate(() => document.querySelector("[data-web-translation-translation='root']")?.shadowRoot?.textContent ?? ""), { timeout: 25_000 }).toContain("自动识别 → 日语");
    await expect.poll(() => localPage.evaluate(() => getComputedStyle(document.querySelector("[data-web-translation-translation='root']")!.shadowRoot!.querySelector(".translation")!).color)).toBe("rgb(36, 41, 47)");
    await expect(source).toHaveCSS("color", "rgb(255, 0, 255)");
    await localPage.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => localPage.evaluate(() => getComputedStyle(document.querySelector("[data-web-translation-translation='root']")!.shadowRoot!.querySelector(".translation")!).color)).toBe("rgb(240, 246, 252)");
    await localPage.evaluate(() => document.querySelector<HTMLButtonElement>("[data-web-translation-translation='root']")!.shadowRoot!.querySelector("button")!.click());
    await expect.poll(() => localPage.evaluate(() => Boolean(document.querySelector("[data-web-translation-translation='root']")!.shadowRoot!.querySelector(".translation__text")))).toBe(false);
    const expandedAt = Date.now();
    await localPage.evaluate(() => document.querySelector<HTMLButtonElement>("[data-web-translation-translation='root']")!.shadowRoot!.querySelector("button")!.click());
    await expect.poll(() => localPage.evaluate(() => document.querySelector("[data-web-translation-translation='root']")!.shadowRoot!.querySelector(".translation__text")?.textContent ?? ""), { intervals: [10] }).toBe("这是可见文本块的固定中文译文。");
    expect(Date.now() - expandedAt).toBeLessThan(125);

    // #20: the real production bundle must defer dynamic offscreen content
    // until it crosses the actual viewport, then survive virtual-node reuse.
    await localPage.evaluate(() => {
      const block = document.createElement("p");
      block.id = "dynamic-offscreen";
      block.textContent = "This is readable English content that will be translated.";
      block.style.marginTop = "2400px";
      document.querySelector("main")!.append(block);
    });
    await localPage.waitForTimeout(350);
    await expect(localPage.locator("#dynamic-offscreen + [data-web-translation-translation='root']")).toHaveCount(0);
    await localPage.locator("#dynamic-offscreen").scrollIntoViewIfNeeded();
    const dynamicHost = localPage.locator("#dynamic-offscreen + [data-web-translation-translation='root']");
    await expect(dynamicHost).toHaveCount(1);
    await expect(dynamicHost.locator(".translation__loading")).toBeVisible();
    const oldDynamicHost = await dynamicHost.elementHandle();

    await localPage.evaluate(() => {
      const block = document.querySelector<HTMLElement>("#dynamic-offscreen")!;
      block.textContent = "This replacement is readable English content for translation.";
    });
    await expect.poll(() => oldDynamicHost?.evaluate((host) => !host.isConnected)).toBe(true);
    await expect(dynamicHost).toHaveCount(1);
    await expect(dynamicHost.locator(".translation__loading")).toBeVisible();
    const hostBeforeMove = await dynamicHost.elementHandle();
    await localPage.evaluate(() => {
      const destination = document.createElement("section");
      destination.id = "dynamic-move-destination";
      const block = document.querySelector<HTMLElement>("#dynamic-offscreen")!;
      block.remove();
      destination.append(block);
      document.querySelector("main")!.append(destination);
    });
    await expect.poll(() => hostBeforeMove?.evaluate((host) => !host.isConnected)).toBe(true);
    const movedHost = localPage.locator("#dynamic-move-destination #dynamic-offscreen + [data-web-translation-translation='root']");
    await expect(movedHost).toHaveCount(1);
    await expect.poll(() => movedHost.evaluate((host) => host.shadowRoot?.textContent ?? ""), { timeout: 15_000 }).toContain("这是可见文本块的固定中文译文。");

    for (const index of [0, 1, 2, 3]) {
      await localPage.evaluate((itemIndex) => {
        const block = document.createElement("p");
        block.dataset.dynamicFeedIndex = String(itemIndex);
        if (itemIndex === 0) block.append(document.createElement("span"));
        else block.textContent = `This readable English content is item ${itemIndex} for translation.`;
        block.style.marginTop = "760px";
        document.querySelector("main")!.append(block);
      }, index);
      if (index === 0) await localPage.evaluate(() => { document.querySelector<HTMLElement>("[data-dynamic-feed-index='0'] span")!.textContent = "This readable English content is item 0 for translation."; });
      const block = localPage.locator(`[data-dynamic-feed-index='${index}']`);
      await block.scrollIntoViewIfNeeded();
      const host = localPage.locator(`[data-dynamic-feed-index='${index}'] + [data-web-translation-translation='root']`);
      await expect(host).toHaveCount(1);
      await expect.poll(() => host.evaluate((element) => element.shadowRoot?.textContent ?? ""), { timeout: 15_000 }).toContain("这是可见文本块的固定中文译文。");
    }
    const metricsBeforeIdle = await localPage.evaluate(() => JSON.parse(document.querySelector<HTMLElement>("[data-web-translation-extension-shell]")?.dataset.dynamicMetrics ?? "{}") as { sampleCount?: number; totalRequestCount?: number });
    await localPage.waitForTimeout(450);
    const stableHostCount = await localPage.locator("[data-dynamic-feed-index] + [data-web-translation-translation='root']").count();
    await localPage.waitForTimeout(450);
    expect(await localPage.locator("[data-dynamic-feed-index] + [data-web-translation-translation='root']").count()).toBe(stableHostCount);
    const dynamicMetrics = await localPage.evaluate(() => JSON.parse(document.querySelector<HTMLElement>("[data-web-translation-extension-shell]")?.dataset.dynamicMetrics ?? "{}") as { sampleCount?: number; p95ScanDurationMs?: number; slowestScanDurationMs?: number; totalRequestCount?: number });
    expect(dynamicMetrics.sampleCount).toBe(metricsBeforeIdle.sampleCount);
    expect(dynamicMetrics.totalRequestCount).toBe(metricsBeforeIdle.totalRequestCount);
    expect(dynamicMetrics.sampleCount, JSON.stringify(dynamicMetrics)).toBeGreaterThanOrEqual(5);
    expect(dynamicMetrics.p95ScanDurationMs, JSON.stringify(dynamicMetrics)).toBeLessThanOrEqual(100);

    // #21: a real History API SPA transition must detach an in-flight A host.
    // Its later Fake response may not revive that host; the new route gets B only.
    const submittedBeforeRouteA = await submittedCharacters();
    await localPage.evaluate(() => {
      const block = document.createElement("p");
      block.id = "spa-route-a";
      block.textContent = "A readable English sentence about translation.";
      document.querySelector("main")!.append(block);
    });
    await localPage.locator("#spa-route-a").scrollIntoViewIfNeeded();
    const routeAHost = localPage.locator("#spa-route-a + [data-web-translation-translation='root']");
    await expect(routeAHost).toHaveCount(1);
    await expect(routeAHost.locator(".translation__loading")).toBeVisible();
    await expect.poll(submittedCharacters, { intervals: [10] }).toBeGreaterThan(submittedBeforeRouteA);
    const submittedAfterRouteA = await submittedCharacters();
    const oldRouteHost = await routeAHost.elementHandle();
    await localPage.evaluate(() => {
      history.pushState({ localFixture: true }, "", "/spa-route-b");
      document.querySelector("main")!.innerHTML = '<p id="spa-route-b">A readable English sentence about translation.</p>';
    });
    await expect.poll(() => oldRouteHost?.evaluate((host) => !host.isConnected)).toBe(true);
    await expect.poll(() => localPage.locator("[data-web-translation-extension-shell]").getAttribute("data-page-session"), { intervals: [20] }).toBe("idle");
    await expect(localPage.locator("[data-web-translation-tab-session-prompt]")).toHaveCount(0);
    const routeBHost = localPage.locator("#spa-route-b + [data-web-translation-translation='root']");
    await expect(routeBHost).toHaveCount(1);
    await expect.poll(() => routeBHost.evaluate((host) => host.shadowRoot?.textContent ?? ""), { timeout: 20_000 }).toContain("这是可见文本块的固定中文译文。");
    await expect.poll(submittedCharacters, { intervals: [10] }).toBeGreaterThan(submittedAfterRouteA);
    expect(await oldRouteHost?.evaluate((host) => host.isConnected)).toBe(false);
    await expect(localPage.locator("[data-web-translation-translation='root']")).toHaveCount(1);

    // B 已成功后，同文档同文本应复用页面缓存；随后的 pushState 必须
    // 清掉该缓存，使 C 再次进入真实 adapter 提交边界。度量只读取数值用量。
    const submittedBeforeCacheHit = await submittedCharacters();
    await localPage.evaluate(() => {
      const block = document.createElement("p");
      block.id = "spa-cache-hit";
      block.textContent = "A readable English sentence about translation.";
      document.querySelector("main")!.append(block);
    });
    await localPage.locator("#spa-cache-hit").scrollIntoViewIfNeeded();
    const cachedHost = localPage.locator("#spa-cache-hit + [data-web-translation-translation='root']");
    await expect(cachedHost).toHaveCount(1);
    await expect.poll(() => cachedHost.evaluate((host) => host.shadowRoot?.textContent ?? "")).toContain("这是可见文本块的固定中文译文。");
    expect(await submittedCharacters()).toBe(submittedBeforeCacheHit);

    const submittedBeforeRouteC = await submittedCharacters();
    await localPage.evaluate(() => {
      history.pushState({ localFixture: true }, "", "/spa-route-c");
      document.querySelector("main")!.innerHTML = '<p id="spa-route-c">A readable English sentence about translation.</p>';
    });
    await expect.poll(() => localPage.locator("[data-web-translation-extension-shell]").getAttribute("data-page-session"), { intervals: [20] }).toBe("idle");
    await expect(localPage.locator("[data-web-translation-tab-session-prompt]")).toHaveCount(0);
    const routeCHost = localPage.locator("#spa-route-c + [data-web-translation-translation='root']");
    await expect(routeCHost).toHaveCount(1);
    await expect.poll(() => routeCHost.evaluate((host) => host.shadowRoot?.textContent ?? ""), { timeout: 20_000 }).toContain("这是可见文本块的固定中文译文。");
    await expect.poll(submittedCharacters, { intervals: [10] }).toBeGreaterThan(submittedBeforeRouteC);
    await expect(localPage.locator("[data-web-translation-translation='root']")).toHaveCount(1);

    // #22: 同 hostname 的第二个标签页仍有独立的前台停留确认；A 在后台
    // 新增内容不会提交，已有成功译文保留。这里仅比较数值用量，不读取内容。
    const submittedBeforeBackground = await submittedCharacters();
    const secondPage = await context.newPage();
    await secondPage.goto(`http://127.0.0.1:${address.port}/second-tab`);
    await secondPage.bringToFront();
    const secondConfirmation = secondPage.locator("[data-web-translation-tab-session-prompt]");
    await expect(secondConfirmation).toHaveCount(1);
    await expect(secondPage.locator("[data-web-translation-translation='root']")).toHaveCount(0);
    await expect(await submittedCharacters()).toBe(submittedBeforeBackground);
    await expect(routeCHost).toHaveCount(1);
    await expect.poll(() => routeCHost.evaluate((host) => host.shadowRoot?.textContent ?? "")).toContain("这是可见文本块的固定中文译文。");

    await localPage.evaluate(() => {
      const block = document.createElement("p");
      block.id = "background-dynamic";
      block.textContent = "This readable English content was added while the tab is in background.";
      document.querySelector("main")!.append(block);
    });
    await localPage.waitForTimeout(450);
    await expect(localPage.locator("#background-dynamic + [data-web-translation-translation='root']")).toHaveCount(0);
    await expect(await submittedCharacters()).toBe(submittedBeforeBackground);

    await secondConfirmation.locator("button[data-action='accept']").click();
    await expect.poll(submittedCharacters, { intervals: [10] }).toBeGreaterThan(submittedBeforeBackground);
    const secondTranslation = secondPage.locator("[data-fixture-id='body'] + [data-web-translation-translation='root']");
    await expect.poll(() => secondTranslation.evaluate((host) => host.shadowRoot?.textContent ?? ""), { timeout: 20_000 }).toContain("自动识别 → 日语");

    // A 重新前台后必须出现新确认；关闭等同拒绝，不会默许新动态内容。
    const submittedBeforeReturn = await submittedCharacters();
    await localPage.bringToFront();
    const returnConfirmation = localPage.locator("[data-web-translation-tab-session-prompt]");
    await expect(returnConfirmation).toHaveCount(1);
    await localPage.evaluate(() => {
      const block = document.createElement("p");
      block.id = "return-dynamic";
      block.textContent = "This readable English content awaits a new confirmation.";
      document.querySelector("main")!.append(block);
    });
    await localPage.waitForTimeout(450);
    await expect(localPage.locator("#return-dynamic + [data-web-translation-translation='root']")).toHaveCount(0);
    await returnConfirmation.locator("button[data-action='close']").click();
    await expect(returnConfirmation).toHaveCount(0);
    await localPage.waitForTimeout(450);
    await expect(await submittedCharacters()).toBe(submittedBeforeReturn);
    await expect(routeCHost).toHaveCount(1);

    // hostname 级关闭必须由 worker 广播到 A/B：扩展 UI 全部移除，宿主原文不变。
    await popup.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(popup.getByRole("button", { name: "关闭此网站翻译" })).toBeVisible();
    await popup.getByRole("button", { name: "关闭此网站翻译" }).click();
    await expect(popup.getByRole("button", { name: "开启此网站翻译" })).toBeVisible();
    await expect(localPage.locator("[data-web-translation-translation='root']")).toHaveCount(0);
    await expect(secondPage.locator("[data-web-translation-translation='root']")).toHaveCount(0);
    await expect(localPage.locator("[data-web-translation-tab-session-prompt]")).toHaveCount(0);
    await expect(secondPage.locator("[data-web-translation-tab-session-prompt]")).toHaveCount(0);
    await expect(localPage.locator("#spa-route-c")).toHaveText("A readable English sentence about translation.");
    await expect(secondPage.locator("[data-fixture-id='body']")).toHaveText("This is a readable English sentence.");
  } finally {
    await context?.close();
    await new Promise<void>((resolve, reject) => fixture.close((error) => (error ? reject(error) : resolve())));
    await new Promise<void>((resolve, reject) => childFixture.close((error) => (error ? reject(error) : resolve())));
    await new Promise<void>((resolve, reject) => deniedFixture.close((error) => (error ? reject(error) : resolve())));
    await rm(profileDirectory, { recursive: true, force: true });
    await rm(extensionDirectory, { recursive: true, force: true });
  }
});
