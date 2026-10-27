import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: [import.meta.dirname, dirname(realpathSync(resolve(import.meta.dirname, "node_modules/pdfjs-dist")))] } },
  test: {
    environment: "jsdom",
    maxWorkers: 2,
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    exclude: ["preview-app/**", "outputs/**", "output/**", "tests/e2e/**", "node_modules/**", "dist/**", ".worktrees/**"],
  },
});
