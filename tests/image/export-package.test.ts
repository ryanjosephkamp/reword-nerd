import {
  IMAGE_PACKAGE_FIXED_DATE,
  buildImagePromptPackage,
  type ImagePackageBuildOptions,
  type ImagePackageManifestV1,
  type ImagePackageSnapshot,
  type ImagePackageSnapshotItem,
} from "../../src/image/export";
import { hashImagePackageBlob } from "../../src/image/export/package";
import { DEFAULT_IMAGE_PROMPT_SETTINGS } from "../../src/image/contracts";
import { BlobReader, Uint8ArrayWriter, ZipReader, type FileEntry } from "@zip.js/zip.js";

const HASH_A = "a".repeat(64);
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);

function directProvenance(name = "source.png") {
  return {
    intakeKind: "direct" as const,
    sourceName: name,
    sourcePath: null,
    containerChain: [],
    containerName: null,
    containerHash: null,
    containerPath: null,
    pageNumber: null,
    relationshipId: null,
  };
}

function snapshotItem(overrides: Partial<ImagePackageSnapshotItem> = {}): ImagePackageSnapshotItem {
  const sourceBytes = new Blob([PNG], { type: "image/png" });
  return {
    occurrenceId: "occurrence-a",
    incarnation: 1,
    sourceBytes,
    byteCount: sourceBytes.size,
    sourceHash: HASH_A,
    mimeType: "image/png",
    fileExtension: "png",
    dimensions: { width: 3, height: 2, megapixels: 0.000006 },
    provenance: directProvenance(),
    settings: { ...DEFAULT_IMAGE_PROMPT_SETTINGS },
    ocr: {
      status: "off",
      detectedText: null,
      reviewedText: null,
      operationGeneration: 0,
      reviewRevision: 0,
    },
    warnings: ["Exact source bytes are preserved and may retain EXIF or location metadata."],
    reviewRevision: 0,
    expectedProfileVersion: "2026-08-14-v1",
    expectedProfileVerifiedAt: "2026-08-14",
    ...overrides,
  };
}

function validSnapshot(items: readonly ImagePackageSnapshotItem[] = [snapshotItem()]): ImagePackageSnapshot {
  return {
    sessionGeneration: 2,
    reviewGeneration: 7,
    confirmedReviewGeneration: 7,
    items,
  };
}

function dependencies(overrides: Partial<ImagePackageBuildOptions> = {}): ImagePackageBuildOptions {
  return {
    decoder: {
      async decode() {
        return { width: 3, height: 2, close: () => undefined };
      },
    },
    hash: async () => HASH_A,
    ...overrides,
  };
}

async function failure(
  snapshot: ImagePackageSnapshot,
  options: ImagePackageBuildOptions = dependencies(),
) {
  const result = await buildImagePromptPackage(snapshot, options);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected a safe package failure.");
  expect(result.error.message.length).toBeLessThan(180);
  expect(result.error.message).not.toContain("source.png");
  return result.error.code;
}

async function sha256(source: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await source.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function realSnapshot(items: readonly ImagePackageSnapshotItem[] = [snapshotItem()]): Promise<ImagePackageSnapshot> {
  const withHashes = await Promise.all(items.map(async (item) => ({ ...item, sourceHash: await sha256(item.sourceBytes) })));
  return validSnapshot(withHashes);
}

function realDependencies(): ImagePackageBuildOptions {
  return dependencies({ hash: sha256 });
}

async function readArchive(blob: Blob) {
  const reader = new ZipReader(new BlobReader(blob), { checkSignature: true });
  const entries = await reader.getEntries();
  const files = new Map<string, Uint8Array>();
  for (const entry of entries) {
    if (entry.directory) continue;
    files.set(entry.filename, await (entry as FileEntry).getData(new Uint8ArrayWriter(), { checkSignature: true }));
  }
  await reader.close();
  return { entries, files };
}

describe("Image package public revalidation", () => {
  it("does not start a digest when cancellation wins the owned-Blob read", async () => {
    // Catches nested hash awaits beginning expensive digest work after the current build was cancelled.
    const controller = new AbortController();
    const source = new Blob([PNG], { type: "image/png" });
    Object.defineProperty(source, "arrayBuffer", {
      value: async () => {
        controller.abort();
        return PNG.slice().buffer;
      },
    });
    const digest = vi.spyOn(crypto.subtle, "digest");
    await expect(hashImagePackageBlob(source, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(digest).not.toHaveBeenCalled();
    digest.mockRestore();
  });

  it("fails closed on invalid snapshot shapes, counts, and confirmation tokens", async () => {
    // Catches JavaScript callers bypassing the synchronous snapshot contract.
    expect(await failure({ ...validSnapshot(), confirmedReviewGeneration: 6 })).toBe("INVALID_SNAPSHOT");
    expect(await failure({ ...validSnapshot(), items: [] })).toBe("INVALID_SNAPSHOT");
    expect(await failure({ ...validSnapshot(), items: Array.from({ length: 101 }, (_, index) => snapshotItem({ occurrenceId: `id-${index}` })) })).toBe("INVALID_SNAPSHOT");
    expect(await failure({ ...validSnapshot(), extra: true } as unknown as ImagePackageSnapshot)).toBe("INVALID_SNAPSHOT");
    expect(await failure(validSnapshot([{ ...snapshotItem(), extra: true } as unknown as ImagePackageSnapshotItem]))).toBe("INVALID_SNAPSHOT");
  });

  it("revalidates source signature, MIME, extension, size, hash, and dimensions", async () => {
    // Catches snapshot metadata being trusted instead of recomputed from owned bytes.
    const corrupt = new Blob([new Uint8Array(PNG.length)], { type: "image/png" });
    expect(await failure(validSnapshot([snapshotItem({ sourceBytes: corrupt })]))).toBe("SOURCE_REVALIDATION_FAILED");
    expect(await failure(validSnapshot([snapshotItem({ mimeType: "image/jpeg" })]))).toBe("SOURCE_REVALIDATION_FAILED");
    expect(await failure(validSnapshot([snapshotItem({ fileExtension: "jpg" })]))).toBe("SOURCE_REVALIDATION_FAILED");
    expect(await failure(validSnapshot([snapshotItem({ byteCount: PNG.byteLength + 1 })]))).toBe("SOURCE_REVALIDATION_FAILED");
    expect(await failure(validSnapshot([snapshotItem({ sourceHash: "b".repeat(64) })]))).toBe("SOURCE_REVALIDATION_FAILED");
    expect(await failure(validSnapshot([snapshotItem({ dimensions: { width: 4, height: 2, megapixels: 0.000008 } })]))).toBe("SOURCE_REVALIDATION_FAILED");
    expect(await failure(validSnapshot(), dependencies({ hash: async () => { throw new Error("sensitive hash failure"); } }))).toBe("HASH_UNAVAILABLE");
  });

  it("enforces count, per-source, cumulative-byte, pixel, and axis limits before decode", async () => {
    // Catches oversized forged snapshots crossing the export boundary.
    expect(await failure(validSnapshot([snapshotItem({ byteCount: 20 * 1024 * 1024 + 1 })]))).toBe("INVALID_SNAPSHOT");
    expect(await failure(validSnapshot([snapshotItem({ dimensions: { width: 16_385, height: 1, megapixels: 0.016385 } })]))).toBe("INVALID_SNAPSHOT");
    expect(await failure(validSnapshot([snapshotItem({ dimensions: { width: 10_000, height: 4_001, megapixels: 40.01 } })]))).toBe("INVALID_SNAPSHOT");
    const oversizedDeclarations = Array.from({ length: 6 }, (_, index) => snapshotItem({
      occurrenceId: `id-${index}`,
      byteCount: 20 * 1024 * 1024,
    }));
    expect(await failure(validSnapshot(oversizedDeclarations))).toBe("INVALID_SNAPSHOT");
  });

  it("rejects unresolved or malformed OCR and malformed settings", async () => {
    // Catches unreviewed/sensitive OCR or forged controls entering prompt prose.
    for (const status of ["processing", "needs-review"] as const) {
      expect(await failure(validSnapshot([snapshotItem({
        ocr: { status, detectedText: "PRIVATE", reviewedText: null, operationGeneration: 1, reviewRevision: 1 },
      })]))).toBe("INVALID_SNAPSHOT");
    }
    expect(await failure(validSnapshot([snapshotItem({
      ocr: { status: "accepted", detectedText: "draft", reviewedText: null, operationGeneration: 1, reviewRevision: 1 },
    })]))).toBe("INVALID_SNAPSHOT");
    expect(await failure(validSnapshot([snapshotItem({
      ocr: { status: "accepted", detectedText: null, reviewedText: "x".repeat(20_001), operationGeneration: 1, reviewRevision: 1 },
    })]))).toBe("INVALID_SNAPSHOT");
    expect(await failure(validSnapshot([snapshotItem({
      settings: { ...DEFAULT_IMAGE_PROMPT_SETTINGS, aspectRatio: "2:1" as "1:1" },
    })]))).toBe("INVALID_SNAPSHOT");
    expect(await failure(validSnapshot([snapshotItem({
      settings: { ...DEFAULT_IMAGE_PROMPT_SETTINGS, extra: true } as unknown as ImagePackageSnapshotItem["settings"],
    })]))).toBe("INVALID_SNAPSHOT");
  });

  it("requires the exact current profile identity without fallback", async () => {
    // Catches prompt guidance changing after confirmation or an unknown family falling back silently.
    expect(await failure(validSnapshot([snapshotItem({ expectedProfileVersion: "stale" })]))).toBe("PROFILE_VERSION_MISMATCH");
    expect(await failure(validSnapshot([snapshotItem({ expectedProfileVerifiedAt: "1999-01-01" })]))).toBe("PROFILE_VERSION_MISMATCH");
    expect(await failure(validSnapshot([snapshotItem({
      settings: { ...DEFAULT_IMAGE_PROMPT_SETTINGS, modelFamily: "unknown" as "openai-gpt-image" },
    })]))).toBe("INVALID_SNAPSHOT");
  });

  it("validates provenance structure, path safety, compatibility fields, and PDF pages", async () => {
    // Catches source/container path lies or traversal entering exported metadata.
    expect(await failure(validSnapshot([snapshotItem({ provenance: directProvenance("bad\u0000.png") })]))).toBe("INVALID_SNAPSHOT");
    expect(await failure(validSnapshot([snapshotItem({ provenance: { ...directProvenance(), sourcePath: "../source.png" } })]))).toBe("INVALID_SNAPSHOT");
    expect(await failure(validSnapshot([snapshotItem({
      provenance: {
        intakeKind: "pdf-extracted",
        sourceName: "figure.png",
        sourcePath: "figures/figure.png",
        containerChain: [{ kind: "pdf", name: "paper.pdf", sha256: "f".repeat(64), path: null, byteCount: 100 }],
        containerName: "wrong.pdf",
        containerHash: "f".repeat(64),
        containerPath: null,
        pageNumber: 0,
        relationshipId: null,
      },
    })]))).toBe("INVALID_SNAPSHOT");
    expect(await failure(validSnapshot([snapshotItem({
      provenance: {
        intakeKind: "folder",
        sourceName: "source.png",
        sourcePath: "folder/source.png",
        containerChain: [{ kind: "folder", name: "folder", sha256: "f".repeat(64), path: "folder", byteCount: 10 }],
        containerName: "folder",
        containerHash: "f".repeat(64),
        containerPath: "folder",
        pageNumber: null,
        relationshipId: null,
      },
    })]))).toBe("INVALID_SNAPSHOT");
  });

  it("rejects provenance paths that exceed the retained UTF-8 path and segment limits before decode", async () => {
    // Catches multibyte path declarations bypassing the same 1024/255-byte limits enforced at intake.
    let decodes = 0;
    const options = dependencies({
      decoder: {
        async decode() {
          decodes += 1;
          return { width: 3, height: 2, close: () => undefined };
        },
      },
    });
    const overlongSegment = `${"é".repeat(128)}.png`;
    const overlongPath = Array.from({ length: 5 }, () => "a".repeat(250)).join("/");
    for (const sourcePath of [overlongSegment, overlongPath]) {
      expect(await failure(validSnapshot([snapshotItem({
        provenance: {
          intakeKind: "folder",
          sourceName: "source.png",
          sourcePath,
          containerChain: [{ kind: "folder", name: "folder", sha256: null, path: null, byteCount: null }],
          containerName: "folder",
          containerHash: null,
          containerPath: null,
          pageNumber: null,
          relationshipId: null,
        },
      })]), options)).toBe("INVALID_SNAPSHOT");
    }
    expect(decodes).toBe(0);
  });

  it("accepts only provenance histories emitted by direct, folder, ZIP, PDF, and DOCX intake", async () => {
    // Catches repeated containers and impossible PDF/DOCX nesting being laundered into exported metadata.
    const folder = { kind: "folder" as const, name: "folder", sha256: null, path: null, byteCount: null };
    const zip = { kind: "zip" as const, name: "bundle.zip", sha256: "f".repeat(64), path: null, byteCount: 1_000 };
    const pdf = { kind: "pdf" as const, name: "paper.pdf", sha256: "e".repeat(64), path: "folder/paper.pdf", byteCount: 900 };
    const docx = { kind: "docx" as const, name: "paper.docx", sha256: "d".repeat(64), path: "docs/paper.docx", byteCount: 800 };

    const impossible = [
      {
        intakeKind: "folder" as const,
        sourceName: "source.png",
        sourcePath: "folder/source.png",
        containerChain: [folder, folder],
        containerName: "folder",
        containerHash: null,
        containerPath: null,
        pageNumber: null,
        relationshipId: null,
      },
      {
        intakeKind: "zip" as const,
        sourceName: "source.png",
        sourcePath: "images/source.png",
        containerChain: [zip, zip],
        containerName: "bundle.zip",
        containerHash: "f".repeat(64),
        containerPath: null,
        pageNumber: null,
        relationshipId: null,
      },
      {
        intakeKind: "pdf-extracted" as const,
        sourceName: "figure.png",
        sourcePath: null,
        containerChain: [docx, pdf],
        containerName: "paper.pdf",
        containerHash: "e".repeat(64),
        containerPath: "folder/paper.pdf",
        pageNumber: 1,
        relationshipId: null,
      },
      {
        intakeKind: "docx-extracted" as const,
        sourceName: "figure.png",
        sourcePath: "unexpected/source.png",
        containerChain: [pdf, docx],
        containerName: "paper.docx",
        containerHash: "d".repeat(64),
        containerPath: "docs/paper.docx",
        pageNumber: null,
        relationshipId: null,
      },
    ];
    for (const provenance of impossible) {
      expect(await failure(validSnapshot([snapshotItem({ provenance })]))).toBe("INVALID_SNAPSHOT");
    }

    const validFolderPdf = {
      intakeKind: "pdf-extracted" as const,
      sourceName: "figure.png",
      sourcePath: null,
      containerChain: [folder, pdf],
      containerName: "paper.pdf",
      containerHash: "e".repeat(64),
      containerPath: "folder/paper.pdf",
      pageNumber: 1,
      relationshipId: null,
    };
    const validZipDocx = {
      intakeKind: "docx-extracted" as const,
      sourceName: "docx-image-001.png",
      sourcePath: null,
      containerChain: [zip, docx],
      containerName: "paper.docx",
      containerHash: "d".repeat(64),
      containerPath: "docs/paper.docx",
      pageNumber: null,
      relationshipId: null,
    };
    expect((await buildImagePromptPackage(validSnapshot([snapshotItem({ provenance: validFolderPdf })]), dependencies())).ok).toBe(true);
    expect((await buildImagePromptPackage(validSnapshot([snapshotItem({ provenance: validZipDocx })]), dependencies())).ok).toBe(true);
  });

  it("decodes sequentially, closes every handle, and observes cancellation between sources", async () => {
    // Catches 100 high-resolution decodes running concurrently or decoded resources leaking.
    let active = 0;
    let peak = 0;
    let closed = 0;
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const snapshot = validSnapshot([
      snapshotItem({ occurrenceId: "first" }),
      snapshotItem({ occurrenceId: "second" }),
    ]);
    const promise = buildImagePromptPackage(snapshot, dependencies({
      decoder: {
        async decode() {
          active += 1;
          peak = Math.max(peak, active);
          if (closed === 0) await firstPending;
          return { width: 3, height: 2, close: () => { active -= 1; closed += 1; } };
        },
      },
    }));
    await Promise.resolve();
    releaseFirst();
    await promise;
    expect({ peak, closed, active }).toEqual({ peak: 1, closed: 2, active: 0 });

    const controller = new AbortController();
    let decodes = 0;
    await expect(buildImagePromptPackage(snapshot, dependencies({
      signal: controller.signal,
      decoder: {
        async decode() {
          decodes += 1;
          if (decodes === 1) controller.abort();
          return { width: 3, height: 2, close: () => undefined };
        },
      },
    }))).rejects.toMatchObject({ name: "AbortError" });
    expect(decodes).toBe(1);
  });

  it("propagates AbortError when abort wins a decoder or hash rejection race", async () => {
    // Catches an injected adapter's ordinary rejection being misreported after cancellation became current.
    for (const phase of ["decode", "hash"] as const) {
      const controller = new AbortController();
      const options = dependencies({
        signal: controller.signal,
        decoder: {
          async decode() {
            if (phase === "decode") {
              controller.abort();
              throw new Error("adapter rejected after abort");
            }
            return { width: 3, height: 2, close: () => undefined };
          },
        },
        hash: async () => {
          if (phase === "hash") {
            controller.abort();
            throw new Error("hash rejected after abort");
          }
          return HASH_A;
        },
      });
      await expect(buildImagePromptPackage(validSnapshot(), options)).rejects.toMatchObject({ name: "AbortError" });
    }
  });

  it("builds the exact schema-1 tree with honest inventory hashes and source bytes", async () => {
    // Catches missing/extra artifacts, trusted hashes, source transcoding, or self-hash claims.
    const snapshot = await realSnapshot();
    const result = await buildImagePromptPackage(snapshot, realDependencies());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.packageName).toBe("reword-nerd-image-prompt-package.zip");
    expect(result.output.packageByteCount).toBe(result.output.packageBytes.size);
    expect(result.output.packageSha256).toBe(await sha256(result.output.packageBytes));
    expect({
      packageByteCount: result.output.packageByteCount,
      packageSha256: result.output.packageSha256,
    }).toEqual({
      packageByteCount: 14_599,
      packageSha256: "4bb6074719a34b93bfc25e66d5338774d7272aa17998026fcd1f8826da5e2069",
    });
    expect(result.output.previewPairs).toHaveLength(1);

    const { entries, files } = await readArchive(result.output.packageBytes);
    expect(entries.map((entry) => entry.filename)).toEqual([
      "OPEN-ME-FULL.html",
      "OPEN-ME.html",
      "README.md",
      "manifest.json",
      "pairs/001-source/OPEN-ME.html",
      "pairs/001-source/metadata.json",
      "pairs/001-source/prompt.txt",
      "pairs/001-source/run-card.md",
      "pairs/001-source/source.png",
    ]);
    expect(entries.every((entry) => !entry.directory
      && !(entry as typeof entry & { dataDescriptor?: boolean }).dataDescriptor
      && entry.comment === "")).toBe(true);
    expect([...new Set(entries.map((entry) => entry.lastModDate.toISOString()))]).toEqual(["1980-01-01T00:00:00.000Z"]);
    expect([...new Set(entries.map((entry) => entry.unixMode))]).toEqual([0o100644]);
    expect(files.get("pairs/001-source/source.png")).toEqual(PNG);

    const manifest = JSON.parse(new TextDecoder().decode(files.get("manifest.json"))) as ImagePackageManifestV1;
    expect(Object.keys(manifest)).toEqual([
      "schemaVersion", "package", "privacy", "rootArtifacts", "pairs", "artifactInventory", "manifestSelfRecord",
    ]);
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      package: { format: "image-reference-prompt-package", pairCount: 1, pairOrder: "confirmed-queue-order" },
      privacy: { generatedLocally: true, networkRequests: false, originalContainersIncluded: false, sourceBytesMayRetainExifOrLocation: true },
      manifestSelfRecord: { path: "manifest.json", sha256: null, reason: "self-referential-artifact" },
    });
    const nonManifest = [...files.keys()].filter((path) => path !== "manifest.json").sort();
    expect(manifest.artifactInventory.map((artifact) => artifact.path)).toEqual(nonManifest);
    for (const artifact of manifest.artifactInventory) {
      const bytes = files.get(artifact.path)!;
      expect(artifact.byteCount).toBe(bytes.byteLength);
      expect(artifact.sha256).toBe(await sha256(new Blob([bytes.slice().buffer])));
    }
    const metadata = new TextDecoder().decode(files.get("pairs/001-source/metadata.json"));
    expect(metadata.endsWith("\n")).toBe(true);
    expect(metadata).not.toMatch(/occurrenceId|incarnation|reviewRevision|sessionGeneration|buildGeneration|metadataSha256|openMeSha256/u);
    expect(new TextDecoder().decode(files.get("pairs/001-source/prompt.txt"))).toMatch(/Goal: Faithful rendition[\s\S]*\n$/u);
    expect(new TextDecoder().decode(files.get("pairs/001-source/run-card.md"))).toMatch(/^# Provider run card[\s\S]*\n$/u);
    const packageReadme = new TextDecoder().decode(files.get("README.md"));
    expect(packageReadme).toMatch(/EXIF|location|one source image|one prompt|stochastic|ownership|provider/u);
    expect(packageReadme).toMatch(/Direct-image[\s\S]{0,100}DOCX[\s\S]{0,100}preserved exactly/iu);
    expect(packageReadme).toMatch(/PDF[\s\S]{0,100}rasterized PNG[\s\S]{0,120}not original PDF image-stream bytes/iu);
  });

  it("retains duplicate pairs, queue order semantics, and deterministic bytes", async () => {
    // Catches deduplication, random IDs, object identity, or archive insertion timing affecting output.
    const first = snapshotItem({ occurrenceId: "random-a", provenance: directProvenance("duplicate.png") });
    const second = snapshotItem({
      occurrenceId: "random-b",
      provenance: directProvenance("duplicate.png"),
      settings: { ...DEFAULT_IMAGE_PROMPT_SETTINGS, requestedChanges: "Use an orange border." },
    });
    const snapshot = await realSnapshot([first, second]);
    const one = await buildImagePromptPackage(snapshot, realDependencies());
    const equivalent = await buildImagePromptPackage({
      ...snapshot,
      sessionGeneration: 999,
      items: snapshot.items.map((item, index) => ({ ...item, occurrenceId: `other-${index}`, incarnation: 100 + index, reviewRevision: 50 + index })),
    }, realDependencies());
    expect(one.ok && equivalent.ok).toBe(true);
    if (!one.ok || !equivalent.ok) return;
    expect(new Uint8Array(await one.output.packageBytes.arrayBuffer())).toEqual(new Uint8Array(await equivalent.output.packageBytes.arrayBuffer()));
    expect(one.output.packageSha256).toBe(equivalent.output.packageSha256);
    expect(one.output.manifest.pairs.map((pair) => pair.key)).toEqual(["001-duplicate", "002-duplicate"]);

    const reversed = await buildImagePromptPackage({ ...snapshot, items: [...snapshot.items].reverse() }, realDependencies());
    expect(reversed.ok).toBe(true);
    if (reversed.ok) expect(reversed.output.packageSha256).not.toBe(one.output.packageSha256);
  });

  it("ignores mutation of the exported Date object and sends sorted paths to injected archives", async () => {
    // Catches a caller-mutated exported Date or map traversal affecting fixed ZIP metadata/order.
    const snapshot = await realSnapshot();
    const before = await buildImagePromptPackage(snapshot, realDependencies());
    const originalTime = IMAGE_PACKAGE_FIXED_DATE.getTime();
    IMAGE_PACKAGE_FIXED_DATE.setUTCFullYear(2035);
    const after = await buildImagePromptPackage(snapshot, realDependencies());
    IMAGE_PACKAGE_FIXED_DATE.setTime(originalTime);
    expect(before.ok && after.ok).toBe(true);
    if (before.ok && after.ok) {
      expect(new Uint8Array(await before.output.packageBytes.arrayBuffer())).toEqual(new Uint8Array(await after.output.packageBytes.arrayBuffer()));
    }

    const added: string[] = [];
    const injected = await buildImagePromptPackage(snapshot, dependencies({
      hash: sha256,
      createArchive: () => ({
        add(path) { added.push(path); },
        async close() { return new Blob(["archive"], { type: "application/zip" }); },
      }),
    }));
    expect(injected.ok).toBe(true);
    expect(added).toEqual([...added].sort());
  });

  it("stops archive entry work when cancellation wins the first awaited add", async () => {
    // Catches a cancelled archive continuing through later entries or closing into a stale ZIP.
    const controller = new AbortController();
    let announceFirst!: () => void;
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => { announceFirst = resolve; });
    const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const add = vi.fn(async () => {
      if (add.mock.calls.length === 1) {
        announceFirst();
        await firstRelease;
      }
    });
    const close = vi.fn(async () => new Blob(["archive"], { type: "application/zip" }));
    const build = buildImagePromptPackage(validSnapshot(), dependencies({
      signal: controller.signal,
      createArchive: () => ({ add, close }),
    }));

    await firstStarted;
    controller.abort();
    releaseFirst();
    await expect(build).rejects.toMatchObject({ name: "AbortError" });
    expect(add).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it("records generated and omitted full-HTML branches without exporting source containers", async () => {
    // Catches a large self-contained artifact allocation or original PDF/DOCX/ZIP container export.
    const small = await buildImagePromptPackage(await realSnapshot(), realDependencies());
    expect(small.ok && small.output.manifest.rootArtifacts.fullOpenMe.status).toBe("generated");

    const largeBytes = new Uint8Array(9 * 1024 * 1024);
    largeBytes.set(PNG);
    const largeBlob = new Blob([largeBytes], { type: "image/png" });
    const large = validSnapshot([snapshotItem({
      sourceBytes: largeBlob,
      byteCount: largeBlob.size,
      sourceHash: HASH_A,
      provenance: {
        intakeKind: "pdf-extracted",
        sourceName: "figure.png",
        sourcePath: null,
        containerChain: [{ kind: "pdf", name: "source.pdf", sha256: "f".repeat(64), path: null, byteCount: 10_000_000 }],
        containerName: "source.pdf",
        containerHash: "f".repeat(64),
        containerPath: null,
        pageNumber: 1,
        relationshipId: null,
      },
    })]);
    const added: string[] = [];
    const omitted = await buildImagePromptPackage(large, dependencies({
      createArchive: () => ({
        add(path) { added.push(path); },
        async close() { return new Blob(["archive"], { type: "application/zip" }); },
      }),
    }));
    expect(omitted.ok).toBe(true);
    if (!omitted.ok) return;
    expect(omitted.output.manifest.rootArtifacts.fullOpenMe).toEqual({
      status: "omitted",
      path: null,
      byteCount: null,
      sha256: null,
      limitBytes: 33_554_432,
      reason: "encoded-size-limit",
    });
    expect(added).not.toContain("OPEN-ME-FULL.html");
    expect(added.every((path) => !/\.pdf$|\.docx$|\.zip$/u.test(path))).toBe(true);
    expect(added).toContain("pairs/001-figure/source.png");
  });

  it("fails safely when archive creation fails", async () => {
    // Catches raw archive exceptions or source names escaping into UI errors.
    expect(await failure(validSnapshot(), dependencies({
      createArchive: () => ({
        add() {},
        async close() { throw new Error("source.png private archive detail"); },
      }),
    }))).toBe("ARCHIVE_GENERATION_FAILED");
  });
});
