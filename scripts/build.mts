import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const outdir = "dist";
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await cp("static", outdir, { recursive: true });

await build({
  entryPoints: {
    popup: "src/popup/main.tsx",
    options: "src/options/main.tsx",
    "service-worker": "src/background/service-worker.ts",
    "content-script": "src/content/content-script.ts",
  },
  outdir,
  bundle: true,
  format: "iife",
  target: "chrome120",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
  minify: true,
  entryNames: "[name]",
  loader: { ".css": "css" },
});
