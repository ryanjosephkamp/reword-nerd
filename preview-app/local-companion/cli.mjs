#!/usr/bin/env node
import { build } from "esbuild";
import { readFile, mkdir, mkdtemp } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "output/studio/local-text");
await mkdir(out, { recursive: true });
const buildDir = await mkdtemp(out + "/build-");
const entry = join(buildDir, "server.mjs");
const bundle = async (source, destination) => build({
  entryPoints: [join(root, source)],
  outfile: destination,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  logLevel: "silent",
  plugins: [
    {
      name: "canonical-raw",
      setup(b) {
        b.onResolve({ filter: /\?raw$/ }, (a) => ({
          path: resolve(a.resolveDir, a.path.slice(0, -4)),
          namespace: "raw",
        }));
        b.onLoad({ filter: /.*/, namespace: "raw" }, async (a) => ({
          contents: `export default ${JSON.stringify(await readFile(a.path, "utf8"))}`,
          loader: "js",
        }));
      },
    },
  ],
});
await bundle("local-companion/server.mjs", entry);
const imageEntry = join(buildDir, "collection-image.mjs"), imageLauncherEntry = join(buildDir, "collection-launcher.mjs");
await bundle("local-companion/collections/image-entry.mjs", imageEntry);
await bundle("local-companion/collections/image-launch.mjs", imageLauncherEntry);
const args = process.argv.slice(2);
if (args.some(a => ["--allow-terminal-tasks", "--allow-one-terminal-task", "--agent-test-one-task"].includes(a))) throw Error("Earlier terminal records remain readable. New sends use --allow-collection-images with explicit UI runtime selection.");
const portIndex = args.indexOf("--port");
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 0;
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw Error("Invalid port");
const stateIndex = args.indexOf("--state");
const stateRoot =
  stateIndex >= 0
    ? resolve(args[stateIndex + 1])
    : await mkdtemp(out + "/launch-");
const { createService } = await import(pathToFileURL(entry).href);
const { collectionImageLauncher } = await import(pathToFileURL(imageLauncherEntry).href);
const { COLLECTION_IMAGE_BOUNDARY } = await import("./collections/boundary.mjs");
const textEnabled = args.includes("--allow-collection-text") || args.includes("--live"), imageEnabled = args.includes("--allow-collection-images");
const smokeBudgetRoot = args.includes("--collection-smoke-budgets") ? join(root,"output/studio/collections/authorization") : null;
if(smokeBudgetRoot) await mkdir(smokeBudgetRoot,{recursive:true,mode:0o700});
const service = await createService({
  root: stateRoot,
  dist: join(root, "dist"),
  port,
  live: false,
  collectionOptions: {textEnabled,imageEnabled,imageBoundary:COLLECTION_IMAGE_BOUNDARY.status === "offline-verified",imageStart:collectionImageLauncher(imageEntry),smokeBudgetRoot},
  handoffReviewer: join(root, "local-companion/handoff/review-launch.mjs"),
  terminalRunner: join(root, "local-companion/handoff/terminal-run.mjs"),
  terminalEnabled: false,
  terminalRepeatable: false,
  terminalTestBudget: false,
});
console.log(
  JSON.stringify(
    {
      pid: process.pid,
      collectionTextEnabled:textEnabled,
      collectionImagesEnabled:imageEnabled,
      smokeBudgetRoot,
      url: service.url,
      state: service.root,
      legacyExecutionEnabled: false,
      note: textEnabled || imageEnabled
        ? "Explicit collection sends only. Catalog discovery requires the visible refresh action. Text uses at most four stages; images use one normal task with uncapped internal operations. No task starts at startup."
        : "Review-only: no startup discovery or execution. Existing exact artifacts remain available; catalog refresh is an explicit read-only action.",
    },
    null,
    2,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await service.close();
    process.exit(0);
  });
