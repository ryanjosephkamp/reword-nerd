import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig({
  cacheDir: "output/studio/unified-cache/vite",
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react()],
  optimizeDeps: { include: ["pako/lib/zlib/inflate.js", "pako/lib/zlib/zstream.js", "zod"] },
  server: {
    // Generated test/export HTML must not reload and erase an in-memory session.
    watch: { ignored: ["**/output/**"] },
    fs: {
      // Permit an isolated worktree to reuse installed dependencies via a symlink.
      allow: [
        import.meta.dirname,
        realpathSync(resolve(import.meta.dirname, "node_modules")),
      ],
    },
  },
  build: {
    rollupOptions: {
      input: {
        text: resolve(import.meta.dirname, "index.html"),
        image: resolve(import.meta.dirname, "image/index.html"),
      },
      output: {
        assetFileNames: (asset) =>
          asset.name === "eng.traineddata.gz"
            ? "assets/eng.traineddata.gz"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
});
