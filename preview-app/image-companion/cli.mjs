#!/usr/bin/env node
import { build } from "esbuild";
import { readFile, mkdir } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "output/studio/image-companion-build");
await mkdir(out, { recursive: true });
const entry = join(out, `cli-${process.pid}.mjs`);
await build({
  entryPoints: [join(root, "image-companion/cli.ts")],
  outfile: entry,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  logLevel: "silent",
  plugins: [
    {
      name: "canonical-raw-prompts",
      setup(builder) {
        builder.onResolve({ filter: /\?raw$/ }, (args) => ({
          path: resolve(args.resolveDir, args.path.slice(0, -4)),
          namespace: "prompt-text",
        }));
        builder.onLoad({ filter: /.*/, namespace: "prompt-text" }, async (args) => ({
          contents: `export default ${JSON.stringify(await readFile(args.path, "utf8"))}`,
          loader: "js",
        }));
      },
    },
  ],
});
await import(pathToFileURL(entry).href);
