import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { CURATED_MODEL_PROFILES } from "../../src/domain";
import type { ExportDocumentInput } from "../../src/export";

const encoder = new TextEncoder();
const markerValues = {
  stage1: "<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>",
  stage2: "<<<INSERT_STAGE_2_REWRITE_RESPONSE>>>",
  stage3: "<<<INSERT_STAGE_3_VERIFICATION_RESPONSE>>>",
};

function upload(name: string, bytes: Uint8Array): File {
  return {
    name,
    size: bytes.byteLength,
    type: "text/plain",
    arrayBuffer: async () => bytes.slice().buffer,
  } as File;
}

function documentInput(): ExportDocumentInput {
  return {
    documentId: "workspace-only-id",
    documentName: "Résumé notes.txt",
    documentFormat: "text",
    original: upload("Résumé notes.txt", encoder.encode("original bytes 😀")),
    reviewedExtractedText: "Reviewed 😀\n",
    resolvedSettings: {
      tone: "academic",
      formality: "formal",
      length: "concise",
      outputLanguage: "English",
      customRequirements: "Keep citations.",
    },
    chosenProfile: {
      ...CURATED_MODEL_PROFILES.find((profile) => profile.id === "openai-general")!,
      workflowNote: "Use the stages in order.",
    },
    promptSet: {
      decompose: "stage one",
      rewrite: "stage two",
      verify: "stage three",
      final: "stage four",
    },
    warnings: ["Converted safely."],
    contextAssessment: {
      estimateLabel: "Estimated tokens",
      sourceTokens: 3,
      workflowTokens: 3_012,
      contextWindowTokens: 1_050_000,
      ratio: 3_012 / 1_050_000,
      oversized: false,
      acknowledgmentRequired: false,
    },
    reviewed: true,
    contextWarningAcknowledged: false,
    uploadOrdinal: 7,
  };
}

describe("prompt-package export", () => {
  it.each(CURATED_MODEL_PROFILES)("accepts the $label profile family at the package boundary", async (profile) => {
    const { buildPromptPackage } = await import("../../src/export");
    const source = documentInput();
    source.chosenProfile = { ...profile };
    source.contextAssessment = {
      ...source.contextAssessment,
      contextWindowTokens: profile.contextWindowTokens,
      ratio: profile.contextWindowTokens === null ? null : 3_012 / profile.contextWindowTokens,
    };

    const result = await buildPromptPackage([source]);

    expect(result.ok).toBe(true);
  });

  it("archives a confirmed document as a schema-v2 package with byte-preserved original", async () => {
    // This catches omissions or transformations of the immutable original and reviewed extraction export contract.
    const { buildPromptPackage } = await import("../../src/export");
    const source = documentInput();

    const result = await buildPromptPackage([source]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("fixture should export");
    expect(result.filename).toBe("reword-nerd-prompt-package.zip");
    expect(result.manifest.schemaVersion).toBe(2);
    expect(result.manifest.package.version).toBe("0.2.0");
    expect(result.manifest.documents).toHaveLength(1);
    expect(result.manifest.documents[0]).toMatchObject({
      key: "resume-notes--ea27ac66cf6a",
      exportOrdinal: 0,
      original: {
        path: "documents/resume-notes--ea27ac66cf6a/original.txt",
        sha256: "ea27ac66cf6a1ab2cb26e2c8a40df911c79cd428e52321ffd653399c158702d5",
      },
      reviewedExtraction: {
        path: "documents/resume-notes--ea27ac66cf6a/reviewed-extraction.md",
        unicodeCodePointCount: 11,
        sha256: "411ed191751617cc2382ef551395aa32216bdc628dba78643372e96760f91f74",
      },
      combined: {
        markdown: { path: "documents/resume-notes--ea27ac66cf6a/combined-prompts.md" },
        html: { path: "documents/resume-notes--ea27ac66cf6a/combined-prompts.html" },
      },
    });

    const archive = await JSZip.loadAsync(result.blob, { checkCRC32: true });
    const original = await archive.file("documents/resume-notes--ea27ac66cf6a/original.txt")?.async("uint8array");
    expect(Array.from(original ?? [])).toEqual(Array.from(encoder.encode("original bytes 😀")));
    await expect(
      archive.file("documents/resume-notes--ea27ac66cf6a/reviewed-extraction.md")?.async("string"),
    ).resolves.toBe("Reviewed 😀\n");
  });

  it("creates self-contained Markdown and HTML companions from the canonical prompt bytes", async () => {
    // This catches combined files omitting the runbook, changing prompt text, or introducing remote resources.
    const { buildPromptPackage } = await import("../../src/export");
    const source = documentInput();
    source.promptSet.decompose = "stage one\n````\nembedded fence";
    source.promptSet.rewrite = "stage two </script><img src=x onerror=alert(1)>";

    const result = await buildPromptPackage([source]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("fixture should export");
    expect(result.artifacts).toHaveLength(1);
    const artifact = result.artifacts[0];
    expect(artifact.documentKey).toBe(result.manifest.documents[0].key);
    expect(artifact.runbook).toMatchObject({
      documentKey: result.manifest.documents[0].key,
      originalDisplayName: source.documentName,
      package: { version: "0.2.0" },
      model: {
        id: "openai-general",
        promptStrategy: { id: "openai-chatgpt-v1", version: "2026-08-11-v1" },
      },
      settings: source.resolvedSettings,
      responseMarkers: markerValues,
    });
    expect(Object.isFrozen(artifact.runbook)).toBe(true);
    expect(Object.isFrozen(artifact.runbook.model)).toBe(true);
    expect(Object.isFrozen(artifact.runbook.settings)).toBe(true);
    expect(artifact.promptBlocks.map((block) => [block.stage, block.content])).toEqual([
      ["decompose", source.promptSet.decompose],
      ["rewrite", source.promptSet.rewrite],
      ["verify", source.promptSet.verify],
      ["final", source.promptSet.final],
    ]);
    expect(artifact.markdown.startsWith(artifact.runbookMarkdown)).toBe(true);
    expect(artifact.markdown).toContain("`````text\nstage one\n````\nembedded fence\n`````");

    const parsed = new DOMParser().parseFromString(artifact.html, "text/html");
    expect(parsed.querySelectorAll(".prompt-section pre > code")).toHaveLength(4);
    expect(Array.from(parsed.querySelectorAll(".prompt-section pre > code"), (node) => node.textContent)).toEqual([
      source.promptSet.decompose,
      source.promptSet.rewrite,
      source.promptSet.verify,
      source.promptSet.final,
    ]);
    expect(parsed.querySelectorAll("button[data-copy-target]")).toHaveLength(4);
    expect(parsed.querySelectorAll("script")).toHaveLength(1);
    expect(parsed.querySelector("img")).toBeNull();
    expect(parsed.querySelector("script[src], link[href], img[src], iframe[src]")).toBeNull();

    const archive = await JSZip.loadAsync(result.blob, { checkCRC32: true });
    const record = result.manifest.documents[0];
    await expect(archive.file(record.combined.markdown.path)?.async("string")).resolves.toBe(artifact.markdown);
    await expect(archive.file(record.combined.html.path)?.async("string")).resolves.toBe(artifact.html);
    await expect(archive.file("README.md")?.async("string")).resolves.toBe(artifact.runbookMarkdown);
  });

  it("returns a safe hash error when generated prompt hashing fails after input validation", async () => {
    // This catches a late Web Crypto failure escaping the export boundary as a raw exception.
    const { buildPromptPackage } = await import("../../src/export");
    let calls = 0;
    const source = documentInput();
    const before = JSON.stringify(source);

    const result = await buildPromptPackage([source], {
      hasher: {
        digest: async () => {
          calls += 1;
          if (calls === 3) throw new Error("private browser provider detail");
          return new Uint8Array(32).buffer;
        },
      },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "HASH_UNAVAILABLE" } });
    expect(JSON.stringify(source)).toBe(before);
  });

  it("rejects incomplete export snapshots before archive construction", async () => {
    // This catches an archive being assembled from documents whose review or warning gate is incomplete.
    const { buildPromptPackage } = await import("../../src/export");
    let archiveCalls = 0;
    const incomplete = { ...documentInput(), reviewed: false };

    const result = await buildPromptPackage([incomplete], {
      createArchive: () => {
        archiveCalls += 1;
        throw new Error("must not construct an archive");
      },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "REVIEW_REQUIRED" } });
    expect(archiveCalls).toBe(0);
  });

  it("rejects every remaining explicit precondition before archive construction", async () => {
    // This catches invalid snapshots reaching JSZip despite an export gate that should fail closed.
    const { buildPromptPackage } = await import("../../src/export");
    const invalids: Array<[string, ExportDocumentInput[], string]> = [
      ["empty", [], "NO_DOCUMENTS"],
      ["missing reviewed text", [{ ...documentInput(), reviewedExtractedText: "" }], "INVALID_INPUT"],
      ["blank reviewed text", [{ ...documentInput(), reviewedExtractedText: " \n\t " }], "INVALID_INPUT"],
      ["missing prompt", [{ ...documentInput(), promptSet: { ...documentInput().promptSet, final: "" } }], "INVALID_INPUT"],
      ["missing acknowledgement", [{ ...documentInput(), contextAssessment: { ...documentInput().contextAssessment, acknowledgmentRequired: true }, contextWarningAcknowledged: false }], "CONTEXT_ACKNOWLEDGMENT_REQUIRED"],
    ];
    for (const [, inputs, code] of invalids) {
      let archiveCalls = 0;
      const result = await buildPromptPackage(inputs, { createArchive: () => { archiveCalls += 1; throw new Error("not reached"); } });
      expect(result).toMatchObject({ ok: false, error: { code } });
      expect(archiveCalls).toBe(0);
    }
  });

  it("creates byte-identical sorted archives with no directory entries", async () => {
    // This catches hidden input-order, clock, or folder metadata affecting reproducible packages.
    const { buildPromptPackage } = await import("../../src/export");
    const first = documentInput();
    const second = {
      ...documentInput(),
      documentId: "second",
      documentName: "A file.md",
      documentFormat: "markdown" as const,
      original: upload("A file.md", encoder.encode("second original")),
      reviewedExtractedText: "second reviewed",
      uploadOrdinal: 1,
    };
    const snapshots = [JSON.stringify(first), JSON.stringify(second)];

    const [one, two] = await Promise.all([
      buildPromptPackage([first, second]),
      buildPromptPackage([first, second]),
    ]);

    expect(one.ok && two.ok).toBe(true);
    if (!one.ok || !two.ok) throw new Error("fixtures should export");
    expect(Array.from(new Uint8Array(await one.blob.arrayBuffer()))).toEqual(Array.from(new Uint8Array(await two.blob.arrayBuffer())));
    expect([JSON.stringify(first), JSON.stringify(second)]).toEqual(snapshots);
    const zip = await JSZip.loadAsync(one.blob, { checkCRC32: true });
    const paths = Object.keys(zip.files);
    expect(paths).toEqual([...paths].sort());
    expect(Object.values(zip.files).every((entry) => !entry.dir)).toBe(true);
    expect(zip.files["documents/a-file--b75998421ec1/original.md"].date.toISOString()).toBe("1980-01-01T00:00:00.000Z");
  });

  it("assigns duplicate keys by stable upload ordinal after the required sort", async () => {
    // This catches collision suffixes depending on mutable array order rather than the export-order tie breaker.
    const { buildPromptPackage } = await import("../../src/export");
    const later = { ...documentInput(), uploadOrdinal: 9 };
    const earlier = { ...documentInput(), uploadOrdinal: 2 };

    const result = await buildPromptPackage([later, earlier]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("fixtures should export");
    expect(result.manifest.documents.map((document) => document.key)).toEqual([
      "resume-notes--ea27ac66cf6a",
      "resume-notes--ea27ac66cf6a--2",
    ]);
  });

  it("uses a synchronous deep snapshot when caller-owned fields mutate during hashing", async () => {
    // This catches awaiting before snapshotting, which can silently export caller mutations made while hashing is pending.
    const { buildPromptPackage } = await import("../../src/export");
    const source = documentInput();
    let releaseFirstDigest: (() => void) | undefined;
    let firstDigestStarted: (() => void) | undefined;
    const digestStarted = new Promise<void>((resolve) => { firstDigestStarted = resolve; });
    const holdFirstDigest = new Promise<void>((resolve) => { releaseFirstDigest = resolve; });
    let calls = 0;

    const pending = buildPromptPackage([source], {
      hasher: {
        digest: async (bytes) => {
          calls += 1;
          if (calls === 1) {
            firstDigestStarted?.();
            await holdFirstDigest;
          }
          return crypto.subtle.digest("SHA-256", bytes);
        },
      },
    });
    await digestStarted;
    source.promptSet.decompose = "MUTATED PROMPT";
    source.resolvedSettings.outputLanguage = "Mutated";
    source.chosenProfile.label = "Mutated profile";
    source.warnings.push("Mutated warning");
    source.contextAssessment.workflowTokens = 1;
    releaseFirstDigest?.();

    const result = await pending;
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("fixture should export");
    const record = result.manifest.documents[0];
    expect(record.settings.outputLanguage).toBe("English");
    expect(record.model.label).toBe("OpenAI / ChatGPT");
    expect(record.reviewedExtraction.warnings).toEqual(["Converted safely."]);
    expect(record.contextAssessment.workflowTokens).toBe(3_012);
    const archive = await JSZip.loadAsync(result.blob, { checkCRC32: true });
    await expect(archive.file(record.prompts.decompose.path)?.async("string")).resolves.toBe("stage one");
    for (const stage of ["decompose", "rewrite", "verify", "final"] as const) {
      const text = await archive.file(record.prompts[stage].path)?.async("uint8array");
      const digest = await crypto.subtle.digest("SHA-256", (text ?? new Uint8Array()).slice().buffer);
      expect(Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")).toBe(record.prompts[stage].sha256);
    }
    await expect(archive.file("README.md")?.async("string")).resolves.not.toContain("Mutated");
  });

  it("rejects malformed runtime values and duplicate upload ordinals before archive creation", async () => {
    // This catches TypeScript-only assumptions allowing malformed UI/runtime values to throw or reach archive construction.
    const { buildPromptPackage } = await import("../../src/export");
    const valid = documentInput();
    const invalids: unknown[] = [
      null,
      [{}],
      [{ ...valid, documentFormat: "rtf" }],
      [{ ...valid, documentName: " \t " }],
      [{ ...valid, original: { name: "bad" } }],
      [{ ...valid, warnings: [42] }],
      [{ ...valid, contextAssessment: null }],
      [{ ...valid, reviewed: "yes" }],
      [{ ...valid, contextWarningAcknowledged: "no" }],
      [{ ...valid, uploadOrdinal: 1 }, { ...documentInput(), uploadOrdinal: 1 }],
    ];
    for (const input of invalids) {
      let archives = 0;
      const result = await buildPromptPackage(input as ExportDocumentInput[], {
        createArchive: () => { archives += 1; throw new Error("must not be called"); },
      });
      expect(result).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
      expect(archives).toBe(0);
    }
  });

  it("produces the same package when distinct upload ordinals are supplied in reverse array order", async () => {
    // This catches export ordering that accidentally preserves caller array order instead of the documented stable comparator.
    const { buildPromptPackage } = await import("../../src/export");
    const a = { ...documentInput(), documentName: "Alpha.txt", uploadOrdinal: 1 };
    const b = { ...documentInput(), documentName: "Beta.txt", uploadOrdinal: 2 };
    const forward = await buildPromptPackage([a, b]);
    const reversed = await buildPromptPackage([b, a]);

    expect(forward.ok && reversed.ok).toBe(true);
    if (!forward.ok || !reversed.ok) throw new Error("fixtures should export");
    expect(Array.from(new Uint8Array(await forward.blob.arrayBuffer()))).toEqual(Array.from(new Uint8Array(await reversed.blob.arrayBuffer())));
  });

  it("serializes the complete manifest and runbook contract against the archived bytes", async () => {
    // This catches manifest/runbook drift from archive contents, marker loss, or omitted profile/settings/context provenance.
    const { buildPromptPackage } = await import("../../src/export");
    const result = await buildPromptPackage([documentInput()]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("fixture should export");
    expect(Object.keys(result.manifest)).toEqual(["schemaVersion", "package", "archive", "workflow", "documents"]);
    expect(result.manifest.workflow).toEqual({
      mode: "manual",
      stages: ["decompose", "rewrite", "verify", "final"],
      responseMarkers: markerValues,
    });
    const document = result.manifest.documents[0];
    expect(Object.keys(document)).toEqual([
      "key", "exportOrdinal", "originalDisplayName", "format", "original", "reviewedExtraction",
      "settings", "model", "contextAssessment", "contextWarningAcknowledged", "prompts", "combined",
    ]);
    expect(document.settings).toEqual(documentInput().resolvedSettings);
    expect(document.model).toEqual({
      id: documentInput().chosenProfile.id,
      family: documentInput().chosenProfile.family,
      label: documentInput().chosenProfile.label,
      contextWindowTokens: documentInput().chosenProfile.contextWindowTokens,
      lastReviewed: documentInput().chosenProfile.lastReviewed,
      workflowNote: documentInput().chosenProfile.workflowNote,
      promptStrategy: {
        id: documentInput().chosenProfile.promptStrategy.id,
        version: documentInput().chosenProfile.promptStrategy.version,
        referenceModel: documentInput().chosenProfile.promptStrategy.referenceModel,
        reviewedAt: documentInput().chosenProfile.promptStrategy.reviewedAt,
      },
    });
    expect(document.reviewedExtraction.warnings).toEqual(["Converted safely."]);
    expect(document.contextAssessment).toEqual(documentInput().contextAssessment);

    const archive = await JSZip.loadAsync(result.blob, { checkCRC32: true });
    const manifestText = await archive.file("manifest.json")?.async("string");
    expect(manifestText).toBe(`${JSON.stringify(result.manifest, null, 2)}\n`);
    const paths = [
      document.original.path,
      document.reviewedExtraction.path,
      ...(["decompose", "rewrite", "verify", "final"] as const).map((stage) => document.prompts[stage].path),
      document.combined.markdown.path,
      document.combined.html.path,
    ];
    const hashes = [
      document.original.sha256,
      document.reviewedExtraction.sha256,
      ...(["decompose", "rewrite", "verify", "final"] as const).map((stage) => document.prompts[stage].sha256),
      document.combined.markdown.sha256,
      document.combined.html.sha256,
    ];
    expect(Object.keys(archive.files)).toEqual([
      "README.md",
      document.combined.html.path,
      document.combined.markdown.path,
      document.original.path,
      document.prompts.decompose.path,
      document.prompts.rewrite.path,
      document.prompts.verify.path,
      document.prompts.final.path,
      document.reviewedExtraction.path,
      "manifest.json",
    ]);
    for (const [index, path] of paths.entries()) {
      const bytes = await archive.file(path)?.async("uint8array");
      const digest = await crypto.subtle.digest("SHA-256", (bytes ?? new Uint8Array()).slice().buffer);
      expect(Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")).toBe(hashes[index]);
    }
    const runbook = await archive.file("README.md")?.async("string");
    expect(runbook).toContain(`Selected model: ${document.model.label}`);
    expect(runbook).toContain("Context estimate: 3012; known limit: 1050000; required warning acknowledged: not required.");
    expect(runbook).toContain("Reference model: GPT-5.6 Sol");
    expect(runbook).toContain("Guidance version: 2026-08-11-v1");
    expect(runbook).toContain(JSON.stringify(document.settings));
    expect(runbook).toContain(document.model.workflowNote);
    expect(runbook).toContain(document.original.path);
    expect(runbook).toContain(document.reviewedExtraction.path);
    for (const stage of ["decompose", "rewrite", "verify", "final"] as const) {
      expect(runbook).toContain(document.prompts[stage].path);
    }
    for (const marker of Object.values(markerValues)) expect(runbook).toContain(marker);
    expect(runbook).toContain("start a new conversation; run Stage 1; copy its response into the Stage 1 marker in Stage 2; run Stage 2; fill both prior markers in Stage 3; run Stage 3; fill all three markers in Stage 4; run Stage 4; review the final output.");
  });

  it("maps each external read/hash/archive failure without constructing a partial package", async () => {
    // This catches raw dependency exceptions or an archive invocation after an expected export failure.
    const { buildPromptPackage } = await import("../../src/export");
    const unreadable = { ...documentInput(), original: { arrayBuffer: async () => { throw new Error("private path"); } } as unknown as File };
    await expect(buildPromptPackage([unreadable])).resolves.toMatchObject({ ok: false, error: { code: "FILE_READ_FAILED" } });
    const nonBinaryRead = { ...documentInput(), original: { arrayBuffer: async () => "not binary" } as unknown as File };
    await expect(buildPromptPackage([nonBinaryRead])).resolves.toMatchObject({ ok: false, error: { code: "FILE_READ_FAILED" } });

    for (const failingCall of [1, 2, 3, 4, 5, 6, 7, 8]) {
      let calls = 0;
      let archiveCalls = 0;
      const result = await buildPromptPackage([documentInput()], {
        hasher: {
          digest: async (bytes) => {
            calls += 1;
            if (calls === failingCall) throw new Error("provider internals");
            return crypto.subtle.digest("SHA-256", bytes);
          },
        },
        createArchive: () => {
          archiveCalls += 1;
          throw new Error("must not reach archive after hash failure");
        },
      });
      expect(result).toMatchObject({ ok: false, error: { code: "HASH_UNAVAILABLE" } });
      expect(archiveCalls).toBe(0);
    }

    const fileFailure = await buildPromptPackage([documentInput()], {
      createArchive: () => ({ file: () => { throw new Error("JSZip file failure"); }, generateAsync: async () => new Blob() }),
    });
    const generationFailure = await buildPromptPackage([documentInput()], {
      createArchive: () => ({ file: () => undefined, generateAsync: async () => { throw new Error("JSZip generation failure"); } }),
    });
    expect(fileFailure).toMatchObject({ ok: false, error: { code: "ARCHIVE_GENERATION_FAILED" } });
    expect(generationFailure).toMatchObject({ ok: false, error: { code: "ARCHIVE_GENERATION_FAILED" } });
  });

  it("writes fixed UNIX metadata with STORE originals and DEFLATE generated entries", async () => {
    // This catches ZIP metadata that would break byte stability or recompress the immutable uploaded original.
    const { buildPromptPackage } = await import("../../src/export");
    const result = await buildPromptPackage([documentInput()]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("fixture should export");
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const entries: Array<{ name: string; compression: number; time: number; date: number; platform: number; permissions: number }> = [];
    for (let offset = 0; offset <= bytes.byteLength - 46; offset += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) continue;
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      entries.push({
        name: new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameLength)),
        compression: view.getUint16(offset + 10, true),
        time: view.getUint16(offset + 12, true),
        date: view.getUint16(offset + 14, true),
        platform: view.getUint16(offset + 4, true) >>> 8,
        permissions: view.getUint32(offset + 38, true) >>> 16,
      });
      offset += 46 + nameLength + extraLength + commentLength - 1;
    }
    expect(entries.map((entry) => entry.name)).toEqual([...entries.map((entry) => entry.name)].sort());
    for (const entry of entries) {
      expect(entry.time).toBe(0);
      expect(entry.date).toBe(0x21);
      expect(entry.platform).toBe(3);
      expect(entry.permissions).toBe(0o100644);
      expect(entry.compression).toBe(entry.name.endsWith("/original.txt") ? 0 : 8);
    }
  });
});
