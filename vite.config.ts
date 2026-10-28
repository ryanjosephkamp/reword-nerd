import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;
const pdfjsRoot = resolve(root, "node_modules/pdfjs-dist");
// pdf.js fetches these by name at run time: character maps for CJK text, the standard fonts
// for PDFs that don't embed them, and the decoders for JPEG 2000 and JBIG2 pictures.
const PDFJS_FOLDERS = ["cmaps", "standard_fonts", "wasm"] as const;

function pdfjsSupportFiles(): Plugin {
  return {
    name: "pdfjs-support-files",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /\/pdfjs\/(cmaps|standard_fonts|wasm)\/([\w.-]+)$/.exec(request.url ?? "");
        if (!match) return next();
        try {
          response.end(readFileSync(join(pdfjsRoot, match[1], match[2])));
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      for (const folder of PDFJS_FOLDERS) {
        for (const name of readdirSync(join(pdfjsRoot, folder))) {
          if (name.startsWith("LICENSE")) continue;
          this.emitFile({
            type: "asset",
            fileName: `pdfjs/${folder}/${name}`,
            source: readFileSync(join(pdfjsRoot, folder, name)),
          });
        }
      }
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react(), pdfjsSupportFiles()],
  build: {
    rollupOptions: {
      input: {
        landing: resolve(root, "index.html"),
        app: resolve(root, "app/index.html"),
      },
      output: {
        // The OCR language file is fetched by name at run time.
        assetFileNames: (asset) =>
          asset.names?.includes("eng.traineddata.gz")
            ? "assets/eng.traineddata.gz"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
