import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environmentMatchGlobs: [["tests/ui/**/*.test.tsx", "jsdom"]],
    setupFiles: ["tests/setup.ts"],
  },
});
