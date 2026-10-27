import { defineConfig } from "vitest/config";
export default defineConfig({ cacheDir: "output/studio/collections/cache/vitest", test: { environment: "node", include: ["local-companion/collections/**/*.test.ts"], maxWorkers: 1 } });
