import { expect, test } from "@playwright/test";
import { chromium, type BrowserContext } from "playwright";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

for (const scenario of ["success", "authentication-failure"] as const) {
  test(`真实 dist 人工烟囱两次确认后处理离线模拟 ${scenario}`, async () => {
    test.setTimeout(60_000);
    const profileDirectory = await mkdtemp(path.join(tmpdir(), "web-translation-extension-"));
    const extensionDirectory = await mkdtemp(path.join(tmpdir(), "web-translation-extension-dist-"));
    await cp(path.resolve("dist"), extensionDirectory, { recursive: true });
    const manifestPath = path.join(extensionDirectory, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    // This test isolates the complete smoke flow from Chrome's optional permission
    // prompt. The real manual acceptance still covers requesting this origin
    // from a user gesture.
    manifest.host_permissions = ["https://fanyi-api.baidu.com/*"];
    await writeFile(manifestPath, JSON.stringify(manifest));

    let context: BrowserContext | undefined;
    try {
      context = await chromium.launchPersistentContext(profileDirectory, {
        channel: "chromium",
        headless: true,
        args: [`--disable-extensions-except=${extensionDirectory}`, `--load-extension=${extensionDirectory}`],
      });
      let [worker] = context.serviceWorkers();
      if (!worker) worker = await context.waitForEvent("serviceworker");
      // Exercise the bundled adapter and native worker APIs. Replace only the
      // external transport, with offline mode as a second no-network boundary.
      await context.setOffline(true);
      await worker.evaluate((scenario) => {
        const probe = globalThis as typeof globalThis & { smokeFetchCount: number };
        probe.smokeFetchCount = 0;
        globalThis.fetch = async () => {
          probe.smokeFetchCount += 1;
          const body = scenario === "success"
            ? { from: "en", to: "zh", trans_result: [{ dst: "本地固定结果" }] }
            : { error_code: "54001", error_msg: "provider detail must not be displayed" };
          return new Response(JSON.stringify(body), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        };
      }, scenario);
      const extensionId = new URL(worker.url()).host;
      const options = await context.newPage();
      await options.goto(`chrome-extension://${extensionId}/options.html`);
      await options.getByLabel("百度 APPID").fill("test-app");
      await options.getByLabel("密钥").fill("test-secret");
      await options.getByRole("button", { name: "保存凭据" }).click();
      await expect(options.getByText("已配置翻译服务")).toBeVisible();

      for (const label of ["当前免费额度与计费条款", "QPS", "可用语言方向", "单次长度", "数据处理条款"]) {
        await options.getByLabel(label).check();
      }
      await options.getByRole("button", { name: "准备人工烟囱测试" }).click();

      await expect(options.getByText(/本次将提交 \d+ 个源字符。/u)).toBeVisible();
      await expect(options.getByRole("alert")).toHaveCount(0);
      expect(await worker.evaluate(() => (globalThis as typeof globalThis & { smokeFetchCount: number }).smokeFetchCount)).toBe(0);
      await options.getByRole("button", { name: "确认并发送一次人工烟囱请求" }).click();
      await expect(options.getByRole("button", { name: "准备人工烟囱测试", exact: true })).toBeEnabled();
      if (scenario === "success") {
        await expect(options.getByText("人工烟囱已通过；重新确认当前标签页后，后续页面翻译将使用百度。")).toBeVisible();
        await expect(options.getByRole("alert")).toHaveCount(0);
      } else {
        await expect(options.getByRole("alert")).toContainText("百度鉴权失败");
        await expect(options.getByRole("alert")).not.toContainText("未分类异常");
      }
      await expect(options.locator("body")).not.toContainText("provider detail must not be displayed");
      expect(await worker.evaluate(() => (globalThis as typeof globalThis & { smokeFetchCount: number }).smokeFetchCount)).toBe(1);
      await options.reload();
      await expect(options.getByText(/已估算提交 19 个源字符/u)).toBeVisible();
    } finally {
      await context?.close();
      await rm(profileDirectory, { recursive: true, force: true });
      await rm(extensionDirectory, { recursive: true, force: true });
    }
  });
}
