import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig({
  cacheDir: "output/studio/unified-cache/vitest",
  plugins: [react()],
  server: {
    fs: {
      // Keep worker and OCR asset imports inside the project or its dependencies.
      allow: [
        import.meta.dirname,
        realpathSync(resolve(import.meta.dirname, "node_modules")),
      ],
    },
  },
  test: {
    maxWorkers: 2,
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    exclude: ["tests/e2e/**", "companion/**", "local-companion/**", "image-companion/**", "image-runtime-prototype/**", "native-image-gate/**", "provider-integration/**", "output/**", "node_modules/**", "dist/**", ".worktrees/**"],
  },
});
