import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const fixture = await readFile(new URL("../tests/manual-fixtures/index.html", import.meta.url));
const coreSiteHardeningFixture = await readFile(new URL("../tests/manual-fixtures/core-site-hardening.html", import.meta.url));
const port = Number(process.env.TRANSLATION_FIXTURE_PORT ?? 4173);

const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const body = path === "/core-site-hardening.html" ? coreSiteHardeningFixture : fixture;
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(body);
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(
    `本地验收页已启动：\n- http://127.0.0.1:${port}/\n- http://localhost:${port}/\n- http://127.0.0.1:${port}/core-site-hardening.html\n`,
  );
});
