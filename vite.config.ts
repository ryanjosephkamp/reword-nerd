import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;
const pdfjsRoot = resolve(root, "node_modules/pdfjs-dist");
// pdf.js fetches these by name at run time: character maps for CJK text, the standard fonts
// for PDFs that don't embed them, and the decoders for JPEG 2000 and JBIG2 pictures. Their
// LICENSE files are copied beside them.
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

const LICENSE_FILE = /^(licen[cs]e|copying|ofl)([.-].*)?$/i;

/** The package directory that holds a bundled module, or null for the app's own code. */
function packageDir(id: string): string | null {
  const path = id.split("?")[0]!.replace(/\\/g, "/");
  const at = path.lastIndexOf("/node_modules/");
  if (at < 0) return null;
  const rest = path.slice(at + "/node_modules/".length).split("/");
  const name = rest[0]!.startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0]!;
  return join(path.slice(0, at), "node_modules", name);
}

/**
 * Writes third-party-licenses.txt into the site: THIRD-PARTY-NOTICES.md, then the license
 * text of every package the build bundled, read from that package's own files. A package's
 * dependencies are included too, since some packages ship a prebuilt browser file that
 * already contains them (jszip carries pako; Tesseract's worker carries zlibjs).
 */
function thirdPartyLicenses(): Plugin {
  return {
    name: "third-party-licenses",
    apply: "build",
    generateBundle() {
      type Meta = {
        name: string;
        version: string;
        license?: string;
        dependencies?: Record<string, string>;
      };
      const read = (dir: string) =>
        JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Meta;
      const dirs = new Set<string>();
      const queue: string[] = [];
      for (const id of this.getModuleIds()) {
        const dir = packageDir(id);
        if (dir && existsSync(join(dir, "package.json"))) queue.push(dir);
      }
      while (queue.length > 0) {
        const dir = queue.pop()!;
        if (dirs.has(dir)) continue;
        dirs.add(dir);
        for (const dep of Object.keys(read(dir).dependencies ?? {})) {
          const found = [join(dir, "node_modules", dep), join(root, "node_modules", dep)].find(
            (d) => existsSync(join(d, "package.json")),
          );
          if (found) queue.push(found);
        }
      }
      const entries = [...dirs]
        .map((dir) => {
          const meta = read(dir);
          const file = readdirSync(dir).find((name) => LICENSE_FILE.test(name));
          const text = file ? readFileSync(join(dir, file), "utf8").trim() : null;
          return { name: meta.name, version: meta.version, license: meta.license, text };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      const rule = "=".repeat(72);
      const parts = [
        readFileSync(resolve(root, "THIRD-PARTY-NOTICES.md"), "utf8").trim(),
        "",
        rule,
        "License texts of the bundled packages and their dependencies",
        rule,
        ...entries.flatMap(({ name, version, license, text }) => [
          "",
          `${name} ${version}`,
          `License: ${license ?? "not stated"}`,
          "-".repeat(72),
          text ?? "The package ships no license file; its license is the one named above.",
        ]),
        "",
      ];
      this.emitFile({
        type: "asset",
        fileName: "third-party-licenses.txt",
        source: parts.join("\n"),
      });
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react(), pdfjsSupportFiles(), thirdPartyLicenses()],
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
