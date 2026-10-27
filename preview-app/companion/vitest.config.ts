import { defineConfig } from "vitest/config";
export default defineConfig({
  cacheDir: "output/studio/runner-cache",
  test: { environment: "node", include: ["companion/**/*.test.ts"], globals: false, maxWorkers: 2 },
});
