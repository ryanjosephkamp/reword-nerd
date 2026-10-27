import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { loadImagePackage } from "../image-companion/package.ts";
import {
  prepareJob,
  nextAttempt,
  getStatus,
  exportJob,
} from "../image-companion/runner.ts";
import {
  IMAGE_CONNECTION,
  IMAGE_PREPARATION_CAPABILITY,
} from "./image-policy.mjs";
const hash = (b) => createHash("sha256").update(b).digest("hex");
const MAX_PACKAGE = 24 * 1024 * 1024;
const files = [
  "package.zip",
  "reference.png",
  "prompt.txt",
  "saved-configuration.json",
  "audit.json",
  "review.html",
];
async function bounded(path, max = MAX_PACKAGE) {
  const s = await lstat(path);
  if (!s.isFile() || s.isSymbolicLink() || s.size > max)
    throw Error("Unsafe or oversized image artifact");
  return readFile(path);
}
export async function createImagePreparation(root) {
  root = resolve(root);
  const job = join(root, "job"),
    review = join(root, "review");
  let busy = false;
  async function exists(path) {
    try {
      const s = await lstat(path);
      if (s.isSymbolicLink()) throw Error("Image state symlink rejected");
      return true;
    } catch (e) {
      if (e.code === "ENOENT") return false;
      throw e;
    }
  }
  async function snapshot() {
    if (!(await exists(root)) || !(await exists(join(job, "state.json"))))
      return null;
    const status = await getStatus(job);
    const exported = await exists(review);
    if (exported) await seal();
    return {
      ...status,
      location: root,
      generationAvailable: false,
      operation: "offline-image-preparation",
      blocker: IMAGE_CONNECTION.reason,
      exported,
      artifacts: exported ? files : [],
    };
  }
  async function seal(create = false, pkg = null) {
    if (!(await exists(review))) throw Error("Image review is not exported");
    const path = join(root, "preparation.json");
    const artifacts = {};
    for (const name of files) {
      const bytes = await bounded(
        join(review, name),
        name === "review.html" ? 32 * 1024 * 1024 : MAX_PACKAGE,
      );
      artifacts[name] = { sha256: hash(bytes), byteLength: bytes.length };
    }
    if (create) {
      await writeFile(
        path,
        JSON.stringify(
          {
            kind: "reword-offline-image-preparation",
            schemaVersion: 1,
            createdAt: new Date().toISOString(),
            packageSha256: pkg.packageSha256,
            referenceSha256: pkg.referenceSha256,
            promptSha256: pkg.promptSha256,
            configurationSha256: hash(JSON.stringify(pkg.configuration)),
            discovery: IMAGE_CONNECTION,
            acceptedByUser: false,
            artifacts,
          },
          null,
          2,
        ),
        { flag: "wx", mode: 0o600 },
      );
    } else {
      const receipt = JSON.parse(await bounded(path, 64 * 1024));
      const status = await getStatus(job);
      const audit = JSON.parse(await bounded(join(review, "audit.json")));
      const currentState = JSON.parse(await bounded(join(job, "state.json")));
      if (JSON.stringify(audit.state) !== JSON.stringify(currentState))
        throw Error(
          "Image preparation history is stale; retain this review and export the changed job separately",
        );
      if (
        receipt.kind !== "reword-offline-image-preparation" ||
        receipt.schemaVersion !== 1 ||
        receipt.acceptedByUser !== false ||
        receipt.packageSha256 !== status.packageSha256 ||
        receipt.referenceSha256 !== status.referenceSha256 ||
        receipt.promptSha256 !== status.promptSha256 ||
        receipt.configurationSha256 !==
          hash(JSON.stringify(status.savedConfiguration)) ||
        JSON.stringify(receipt.artifacts) !== JSON.stringify(artifacts)
      )
        throw Error("Image preparation custody mismatch");
    }
  }
  async function finish(pkg) {
    await nextAttempt(job, { capability: IMAGE_PREPARATION_CAPABILITY });
    if (!(await exists(review))) {
      await exportJob(job, review);
      await seal(true, pkg);
    } else if (!(await exists(join(root, "preparation.json")))) {
      throw Error(
        "Interrupted review export is preserved; use the image CLI with a fresh export destination",
      );
    }
    return snapshot();
  }
  return {
    capabilities: IMAGE_CONNECTION,
    snapshot,
    async prepare(bytes) {
      if (busy) throw Error("One image preparation at a time");
      busy = true;
      try {
        if (bytes.length > MAX_PACKAGE)
          throw Error("Image package exceeds 24 MiB");
        const pkg = await loadImagePackage(bytes); // canonical reconstruction before creating local state
        if (await exists(root)) {
          const selected = await bounded(join(root, "selected-package.zip"));
          if (hash(selected) !== pkg.packageSha256)
            throw Error(
              "Conflicting image package: this launch preserves one image job",
            );
          if (!(await exists(join(job, "state.json"))))
            throw Error(
              "Interrupted preparation has no complete job state; preserve it and use a fresh launch",
            );
          return { idempotent: true, job: await finish(pkg) };
        }
        await mkdir(root, { mode: 0o700 });
        await writeFile(join(root, "selected-package.zip"), bytes, {
          flag: "wx",
          mode: 0o600,
        });
        await prepareJob(join(root, "selected-package.zip"), job, {
          mode: "host-assisted",
          host: "Not executed; offline image preparation",
          model: null,
        });
        return { idempotent: false, job: await finish(pkg) };
      } finally {
        busy = false;
      }
    },
    async artifact(name) {
      if (!files.includes(name)) throw Error("Unknown image artifact");
      const s = await snapshot();
      if (!s?.exported) throw Error("Image review is not exported");
      return bounded(
        join(review, name),
        name === "review.html" ? 32 * 1024 * 1024 : MAX_PACKAGE,
      );
    },
  };
}
