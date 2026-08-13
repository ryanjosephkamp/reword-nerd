import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import {
  CURATED_MODEL_PROFILES,
  DEFAULT_CODE_REWRITE_OPTIONS,
  DEFAULT_SETTINGS,
  assessSourceContext,
  confirmProjectReview,
  createProjectPromptSnapshot,
  readFolderProject,
  readZipProject,
} from "../../src/domain";
import type { WorkspaceProject } from "../../src/domain";
import { renderPromptBundle, renderPromptSource } from "../../src/prompting";
import type { ExportProjectInput } from "../../src/export";
import { buildPromptPackage } from "../../src/export";
import { extensionForFormat } from "../../src/export";
import { exceedsCumulativeProjectBytes } from "../../src/export/package";

const encoder = new TextEncoder();

function folderFile(path: string, contents: string | Uint8Array): File {
  const bytes = typeof contents === "string" ? encoder.encode(contents) : contents;
  return {
    name: path.slice(path.lastIndexOf("/") + 1),
    webkitRelativePath: `source/${path}`,
    size: bytes.byteLength,
    type: "",
    arrayBuffer: async () => bytes.slice().buffer,
  } as File;
}

function projectInput(project: WorkspaceProject, uploadOrdinal = 0): ExportProjectInput {
  const snapshot = createProjectPromptSnapshot(project, 0);
  const profile = CURATED_MODEL_PROFILES.find((candidate) => candidate.id === "openai-general")!;
  const sourceContext = {
    kind: "project" as const,
    format: project.classification === "latex" ? "latex-project" as const : "text" as const,
    assets: [],
    reviewedTreeHash: snapshot.reviewedTreeHash,
    includedFiles: snapshot.includedFiles,
    excludedPaths: snapshot.excludedPaths,
    codeRewriteOptions: DEFAULT_CODE_REWRITE_OPTIONS,
    latexMainFile: project.rootDocument,
  };
  const reviewedExtractedText = renderPromptSource(sourceContext);
  return {
    kind: "project",
    projectId: project.id,
    projectName: project.name,
    project,
    reviewedExtractedText,
    resolvedSettings: DEFAULT_SETTINGS,
    codeRewriteOptions: DEFAULT_CODE_REWRITE_OPTIONS,
    chosenProfile: profile,
    promptBundle: renderPromptBundle(reviewedExtractedText, DEFAULT_SETTINGS, profile, sourceContext),
    warnings: [...project.warnings],
    sensitiveBlockedCounts: { ...project.sensitiveBlockedCounts },
    contextAssessment: assessSourceContext({ kind: "project", includedFiles: snapshot.includedFiles }, profile.contextWindowTokens),
    reviewed: true,
    contextWarningAcknowledged: false,
    uploadOrdinal,
  };
}

describe("schema v6 project packages", () => {
  it("preserves a stable original extension for every standalone source format", () => {
    // This catches newly admitted safe text formats failing only when the package derives original.<ext>.
    const formats = ["text", "markdown", "html", "xml", "json", "jsonl", "ndjson", "csv", "tsv", "yaml", "toml", "ini", "config", "css", "sql", "code", "docx", "pdf", "latex", "latex-project"];
    expect(formats.map(extensionForFormat)).not.toContain(undefined);
  });

  it("exports a reviewed folder project as a deterministic sanitized tree with exact provenance and prompt parity", async () => {
    // This catches secrets, excluded bytes, stale reviewed text, or invented containers crossing the package boundary.
    let project = await readFolderProject({
      kind: "folder",
      name: "source",
      files: [
        folderFile("src/main.ts", "// original wording\nexport const answer = 42;\n"),
        folderFile("public/figure.png", new Uint8Array([137, 80, 78, 71, 1, 2, 3])),
        folderFile("dist/generated.js", "GENERATED SHOULD STAY OUT\n"),
        folderFile(".env", "TOKEN=SECRET-MUST-STAY-OUT\n"),
      ],
    });
    const { editProjectEntryText } = await import("../../src/domain");
    project = await editProjectEntryText(project, "src/main.ts", "// reviewed wording\nexport const answer = 42;\n");
    project = confirmProjectReview(project);
    const input = projectInput(project);

    const first = await buildPromptPackage([input]);
    const second = await buildPromptPackage([input]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("safe project should export");
    expect(first.manifest).toMatchObject({
      schemaVersion: 6,
      package: { version: "0.6.0", format: "dual-mode-prompt-package" },
      documents: [{ source: {
        kind: "project",
        intakeKind: "folder",
        rootName: "source",
        originalTreeHash: project.originalTreeHash,
        reviewedTreeHash: project.reviewedTreeHash,
        reviewRevision: project.projectReviewRevision,
        sensitiveBlockedCounts: { credentialFiles: 1, privateKeys: 0, clearCredentials: 0 },
        index: {
          markdown: { path: expect.stringMatching(/\/project\/index\.md$/), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
          json: { path: expect.stringMatching(/\/project\/index\.json$/), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
        },
      } }],
    });
    const record = first.manifest.documents[0];
    expect(record.source.kind).toBe("project");
    if (record.source.kind !== "project") throw new Error("project source required");
    expect(record.source).not.toHaveProperty("originalContainer");
    expect(record).not.toHaveProperty("original");
    expect(first.workbooks[0].runbookDocument?.blocks).toContainEqual(expect.objectContaining({
      type: "table",
      headers: ["Document key", "Source", "One-shot", "Manual", "Combined", "Full HTML"],
    }));
    expect(first.workbooks[0].runbookMarkdown).toContain("Project assets are references, not rewriteable text");
    expect(first.workbooks[0].combined.html).toContain("../../../documents/");
    expect(first.workbooks[0].combined.html).toContain("project/files/public/figure.png");
    expect(first.workbooks[0].combined.html).not.toContain("data:image/png");
    expect(record.source.entries.map((entry) => entry.path)).toEqual([
      "dist/generated.js", "public/figure.png", "src/main.ts",
    ]);

    const archive = await JSZip.loadAsync(first.blob);
    const paths = Object.keys(archive.files).sort();
    const root = `documents/${record.key}`;
    expect(paths).toContain(`${root}/project/index.md`);
    expect(paths).toContain(`${root}/project/index.json`);
    expect(paths).toContain(`${root}/project/files/src/main.ts`);
    expect(paths).toContain(`${root}/project/files/public/figure.png`);
    expect(paths).not.toContain(`${root}/original.zip`);
    expect(paths).not.toContain(`${root}/project/files/dist/generated.js`);
    await expect(archive.file(`${root}/project/files/src/main.ts`)?.async("string"))
      .resolves.toBe("// reviewed wording\nexport const answer = 42;\n");
    await expect(archive.file(record.prompts.oneShot.path)?.async("string")).resolves.toBe(input.promptBundle.oneShot);
    for (const stage of ["decompose", "rewrite", "verify", "final"] as const) {
      await expect(archive.file(record.prompts[stage].path)?.async("string"))
        .resolves.toBe(input.promptBundle.manual[stage]);
    }
    const allText = (await Promise.all(Object.values(archive.files)
      .filter((entry) => !entry.dir)
      .map((entry) => entry.async("string").catch(() => "")))).join("\n");
    expect(allText).not.toContain("SECRET-MUST-STAY-OUT");
    expect(allText).not.toContain("GENERATED SHOULD STAY OUT");
    expect(new Uint8Array(await first.blob.arrayBuffer())).toEqual(new Uint8Array(await second.blob.arrayBuffer()));
  });

  it("records immutable ZIP container provenance without copying the original ZIP", async () => {
    // This catches provenance being omitted or the unsanitized container being duplicated into the export.
    const archive = new JSZip();
    archive.file("README.md", "Safe project text.\n");
    archive.file("assets/figure.png", new Uint8Array([137, 80, 78, 71, 1, 2, 3]));
    const bytes = await archive.generateAsync({ type: "uint8array" });
    const project = confirmProjectReview(await readZipProject({ kind: "zip", name: "workspace.zip", bytes }));
    const result = await buildPromptPackage([projectInput(project)]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("safe ZIP project should export");
    const record = result.manifest.documents[0];
    expect(record.source).toMatchObject({
      kind: "project",
      intakeKind: "zip",
      originalContainer: {
        displayName: "workspace.zip",
        byteCount: bytes.byteLength,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    const packaged = await JSZip.loadAsync(result.blob);
    expect(Object.keys(packaged.files).some((path) => /original\.zip$/u.test(path))).toBe(false);
    expect(result.workbooks[0].combined.html).toContain("project/files/assets/figure.png");
    expect(result.workbooks[0].combined.html).toContain("../../../documents/");
    expect(result.workbooks[0].combined.html).not.toContain("data:image/png");

    const contradictory = {
      ...project,
      originalContainer: { ...project.originalContainer!, displayName: "different.zip" },
    };
    await expect(buildPromptPackage([projectInput(contradictory)])).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });

  it("exports mixed file and multiple projects in stable order with generated compression metadata", async () => {
    // This catches item order or source kind changing deterministic archive ordering/compression promises.
    const { CURATED_MODEL_PROFILES, DEFAULT_SETTINGS, assessContext } = await import("../../src/domain");
    const profile = CURATED_MODEL_PROFILES.find((candidate) => candidate.id === "openai-general")!;
    const text = "Standalone source.\n";
    const file = {
      kind: "document" as const,
      documentId: "file-z",
      documentName: "Zulu.md",
      documentFormat: "markdown" as const,
      original: new File([text], "Zulu.md", { type: "text/markdown" }),
      reviewedExtractedText: text,
      resolvedSettings: DEFAULT_SETTINGS,
      chosenProfile: profile,
      promptBundle: renderPromptBundle(text, DEFAULT_SETTINGS, profile, { format: "markdown", assets: [] }),
      warnings: [],
      contextAssessment: assessContext(text, profile.contextWindowTokens),
      reviewed: true,
      contextWarningAcknowledged: false,
      uploadOrdinal: 2,
    };
    const alpha = confirmProjectReview(await readFolderProject({ kind: "folder", name: "Alpha", files: [folderFile("a.txt", "alpha\n")] }));
    const beta = confirmProjectReview(await readFolderProject({ kind: "folder", name: "Beta", files: [folderFile("b.txt", "beta\n")] }));

    const result = await buildPromptPackage([file, projectInput(beta, 1), projectInput(alpha, 0)]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("mixed safe inputs should export");
    expect(result.manifest.documents.map((record) => [record.originalDisplayName, record.source.kind]))
      .toEqual([["Alpha", "project"], ["Beta", "project"], ["Zulu.md", "file"]]);
    expect(result.manifest.archive).toEqual({
      entryOrder: "lexicographic-code-unit-ascending",
      timestamp: "1980-01-01T00:00:00.000Z",
      originalCompression: "STORE",
      generatedCompression: "DEFLATE-9",
    });
  });

  it("rejects post-snapshot path, byte, hash, tree, and prompt mutations before archive creation", async () => {
    // This catches caller mutation winning after validation and before async hashing/archive generation.
    const cases: Array<(input: ExportProjectInput) => void> = [
      (input) => { (input.project as unknown as { entries: unknown[] }).entries = [{ ...input.project.entries[0], path: "../escape.txt" }]; },
      (input) => { input.project.entries[0].originalBytes[0] ^= 0xff; },
      (input) => { (input.project as { originalTreeHash: string }).originalTreeHash = "f".repeat(64); },
      (input) => { input.promptBundle.oneShot += "\nMUTATED"; },
    ];
    for (const mutate of cases) {
      const clone = confirmProjectReview(await readFolderProject({ kind: "folder", name: "source", files: [folderFile("safe.txt", "safe\n")] }));
      const input = projectInput(clone);
      mutate(input);
      const result = await buildPromptPackage([input]);
      expect(result).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    }
  });

  it("snapshots all project bytes and metadata before the first asynchronous hash resolves", async () => {
    // This catches live caller arrays or bytes being observed after BUILD has started.
    const project = confirmProjectReview(await readFolderProject({ kind: "folder", name: "source", files: [folderFile("safe.txt", "safe\n")] }));
    const input = projectInput(project);
    let release!: () => void;
    let first = true;
    const hasher = {
      digest: async (bytes: ArrayBuffer) => {
        if (first) {
          first = false;
          await new Promise<void>((resolve) => { release = resolve; });
        }
        return crypto.subtle.digest("SHA-256", bytes);
      },
    };
    const pending = buildPromptPackage([input], { hasher });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    input.project.entries[0].originalBytes.fill(0);
    (input.project as { name: string }).name = "mutated";
    release();

    const result = await pending;
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("immutable snapshot should export");
    expect(result.manifest.documents[0].originalDisplayName).toBe("source");
    const archive = await JSZip.loadAsync(result.blob);
    await expect(archive.file(`documents/${result.manifest.documents[0].key}/project/files/safe.txt`)?.async("string"))
      .resolves.toBe("safe\n");
  });

  it("rejects forged sensitive names and credential content even when all supplied hashes and counts are internally consistent", async () => {
    // This catches the public exporter trusting intake classifications from a forged caller.
    const { hashOriginalProjectTree, hashReviewedTree } = await import("../../src/domain");
    for (const [path, text] of [
      [".env", "ordinary looking text\n"],
      ["notes.txt", "API_TOKEN=actual-secret-value\n"],
      ["id_rsa", "not-even-a-key\n"],
      ["readme.md", "-----BEGIN PRIVATE KEY-----\nactual-secret-value\n"],
    ] as const) {
      const safe = confirmProjectReview(await readFolderProject({ kind: "folder", name: "source", files: [folderFile("safe.txt", "safe text\n")] }));
      const entry = safe.entries[0];
      const bytes = encoder.encode(text);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
      const forgedEntry = {
        ...entry,
        path,
        immutablePath: path,
        originalBytes: bytes,
        byteCount: bytes.byteLength,
        originalHash: sha256,
        sha256,
        reviewedText: text,
        reviewedTextHash: sha256,
      };
      const originalTreeHash = await hashOriginalProjectTree([forgedEntry]);
      const reviewedTreeHash = await hashReviewedTree([forgedEntry], undefined, safe.classification, safe.rootDocument);
      const forged = {
        ...safe,
        entries: [forgedEntry],
        totalByteCount: bytes.byteLength,
        originalTreeHash,
        treeHash: originalTreeHash,
        reviewedTreeHash,
      } as WorkspaceProject;
      const input = projectInput(forged);
      const result = await buildPromptPackage([input]);
      expect(result).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    }
  });

  it("rejects credentials introduced only in reviewed project text", async () => {
    // This catches a safe original becoming sensitive during review and then entering prompts, HTML, and project/files.
    const { hashReviewedTree } = await import("../../src/domain");
    const safe = confirmProjectReview(await readFolderProject({ kind: "folder", name: "source", files: [folderFile("notes.txt", "safe original\n")] }));
    const reviewedText = "API_TOKEN=actual-secret-value\n";
    const bytes = encoder.encode(reviewedText);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const reviewedTextHash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
    const entry = { ...safe.entries[0], reviewedText, reviewedTextHash, reviewRevision: 1 };
    const reviewedTreeHash = await hashReviewedTree([entry], undefined, safe.classification, safe.rootDocument);
    const forged = { ...safe, entries: [entry], reviewedTreeHash, projectReviewRevision: 1 } as WorkspaceProject;

    const result = await buildPromptPackage([projectInput(forged)]);

    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });

  it("preserves the complete large-project context assessment in schema v6", async () => {
    const files = Array.from({ length: 25 }, (_, index) => folderFile(`notes/${String(index).padStart(2, "0")}.md`, `Safe note ${index}.\n`));
    const project = confirmProjectReview(await readFolderProject({ kind: "folder", name: "many", files }));
    const input = projectInput(project);
    const result = await buildPromptPackage([input]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("many-file project should export");
    expect(result.manifest.documents[0].contextAssessment).toEqual(input.contextAssessment);
    expect(result.manifest.documents[0].contextAssessment).toMatchObject({
      includedFileCount: 25,
      amberRisk: true,
      amberRiskReasons: ["included-file-count"],
      inspectDiffsAndRunTestsWarning: "Inspect the generated diffs and run your normal tests/build after applying changes.",
    });
  });

  it("rejects contradictory project provenance and review invariants", async () => {
    const base = confirmProjectReview(await readFolderProject({ kind: "folder", name: "source", files: [folderFile("safe.txt", "safe\n")] }));
    const cases: WorkspaceProject[] = [
      { ...base, name: "renamed" },
      { ...base, classificationChoices: ["latex"] },
      { ...base, rootDocument: "safe.txt" },
      { ...base, entries: [{ ...base.entries[0], reviewRevision: base.projectReviewRevision + 1 }] },
    ];
    for (const project of cases) {
      const result = await buildPromptPackage([projectInput(project)]);
      expect(result).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    }
    const contextMismatch = projectInput({ ...base, contextWarningAcknowledged: true });
    contextMismatch.contextWarningAcknowledged = false;
    await expect(buildPromptPackage([contextMismatch])).resolves.toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });

  it("rejects more than 500 canonically ordered project entries before hashing", async () => {
    const { hashOriginalProjectTree, hashReviewedTree } = await import("../../src/domain");
    const base = confirmProjectReview(await readFolderProject({ kind: "folder", name: "source", files: [folderFile("000.txt", "safe\n")] }));
    const entries = Array.from({ length: 501 }, (_, index) => {
      const path = `${String(index).padStart(3, "0")}.txt`;
      return { ...base.entries[0], path, immutablePath: path, promptIncluded: index === 0, packageIncluded: index === 0 };
    });
    const project = {
      ...base,
      entries,
      totalByteCount: entries.reduce((sum, entry) => sum + entry.byteCount, 0),
      originalTreeHash: await hashOriginalProjectTree(entries),
      reviewedTreeHash: await hashReviewedTree(entries, undefined, base.classification, base.rootDocument),
    } as WorkspaceProject;
    project.treeHash = project.originalTreeHash;
    const result = await buildPromptPackage([projectInput(project)]);
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });

  it("enforces canonical order, prompt-count, prompt-byte, per-entry, and cumulative byte limits", async () => {
    const base = confirmProjectReview(await readFolderProject({ kind: "folder", name: "source", files: [folderFile("safe.txt", "safe\n")] }));
    const unorderedInput = projectInput({ ...base, entries: [...base.entries] });
    const countInput = projectInput({ ...base, entries: [...base.entries] });
    const textInput = projectInput({ ...base, entries: [...base.entries] });
    const sizeInput = projectInput({ ...base, entries: [...base.entries] });

    const second = { ...base.entries[0], path: "z.txt", immutablePath: "z.txt" };
    (unorderedInput.project as { entries: typeof base.entries }).entries = [second, base.entries[0]];
    await expect(buildPromptPackage([unorderedInput])).resolves.toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });

    const many = Array.from({ length: 251 }, (_, index) => {
      const path = `${String(index).padStart(3, "0")}.txt`;
      return { ...base.entries[0], path, immutablePath: path };
    });
    (countInput.project as { entries: typeof base.entries }).entries = many;
    await expect(buildPromptPackage([countInput])).resolves.toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });

    (textInput.project as { entries: typeof base.entries }).entries = [{
      ...base.entries[0],
      reviewedText: "x".repeat(5 * 1024 * 1024 + 1),
    }];
    await expect(buildPromptPackage([textInput])).resolves.toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });

    const largeBytes = new Uint8Array(20 * 1024 * 1024 + 1);
    (sizeInput.project as { entries: typeof base.entries; totalByteCount: number }).entries = [{
      ...base.entries[0],
      byteCount: largeBytes.byteLength,
      originalBytes: largeBytes,
    }];
    (sizeInput.project as { totalByteCount: number }).totalByteCount = largeBytes.byteLength;
    await expect(buildPromptPackage([sizeInput])).resolves.toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });

    expect(exceedsCumulativeProjectBytes([50 * 1024 * 1024, 50 * 1024 * 1024])).toBe(false);
    expect(exceedsCumulativeProjectBytes([50 * 1024 * 1024, 50 * 1024 * 1024 + 1])).toBe(true);
  });

  it("requires a normalized included LaTeX root and forbids roots for general projects", async () => {
    const latex = confirmProjectReview(await readFolderProject({ kind: "folder", name: "paper", files: [folderFile("main.tex", "\\documentclass{article}\n")] }));
    expect(latex.classification).toBe("latex");
    for (const project of [
      { ...latex, rootDocument: null },
      { ...latex, rootDocument: "notes.md" },
      { ...latex, entries: latex.entries.map((entry) => ({ ...entry, promptIncluded: false })) },
    ] as WorkspaceProject[]) {
      await expect(buildPromptPackage([projectInput(project)])).resolves.toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    }
  });
});
