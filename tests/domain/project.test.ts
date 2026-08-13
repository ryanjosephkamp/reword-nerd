import JSZip from "jszip";
import { describe, expect, it } from "vitest";

const encoder = new TextEncoder();

function folderFile(path: string, contents: string | Uint8Array, declaredSize?: number): File {
  const bytes = typeof contents === "string" ? encoder.encode(contents) : contents;
  return {
    name: path.slice(path.lastIndexOf("/") + 1),
    webkitRelativePath: `project/${path}`,
    size: declaredSize ?? bytes.byteLength,
    type: "",
    arrayBuffer: async () => bytes.slice().buffer,
  } as File;
}

describe("safe project domain", () => {
  it("normalizes safe paths to NFC and rejects absolute, drive, backslash, dot, traversal, empty, and control segments", async () => {
    // This catches a path spelling escaping or aliasing the immutable project namespace.
    const project = await import("../../src/domain/project");

    expect(project.normalizeProjectPath("docs/cafe\u0301.txt")).toBe("docs/caf\u00e9.txt");
    for (const path of [
      "/root.txt", "C:/root.txt", "dir\\root.txt", "./root.txt", "dir/../root.txt",
      "dir//root.txt", "dir/\u0001root.txt", "", ".", "..",
    ]) {
      expect(() => project.normalizeProjectPath(path)).toThrowError(project.ProjectReadError);
    }
  });

  it("reads one folder as one sorted workspace project and applies ignore, default exclusion, asset, and secret rules", async () => {
    // This catches unsafe or irrelevant entries crossing prompt/export boundaries or folder files becoming separate rows.
    const project = await import("../../src/domain/project");
    const result = await project.readFolderProject({
      kind: "folder",
      name: "project",
      files: [
        folderFile("src/main.ts", "export const answer = 42;\r\n"),
        folderFile("ignored.txt", "ignored\n"),
        folderFile(".gitignore", "ignored.txt\n"),
        folderFile("node_modules/pkg/index.js", "vendored\n"),
        folderFile("public/logo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])),
        folderFile(".env", "API_TOKEN=clear-secret-value\n"),
      ],
    });

    expect(result).toMatchObject({
      kind: "project",
      sourceKind: "folder",
      name: "project",
      classification: "general-text",
      requiresReview: true,
    });
    expect(result.entries.map((entry) => entry.path)).toEqual([
      ".gitignore", "ignored.txt", "node_modules/pkg/index.js", "public/logo.png", "src/main.ts",
    ]);
    expect(result.entries.find((entry) => entry.path === "src/main.ts")).toMatchObject({
      contentKind: "text",
      languageId: "typescript",
      reviewedText: "export const answer = 42;\r\n",
      promptIncluded: true,
      packageIncluded: true,
      immutablePath: "src/main.ts",
    });
    expect(result.entries.find((entry) => entry.path === "ignored.txt")).toMatchObject({
      promptIncluded: false,
      packageIncluded: false,
      exclusionReason: "gitignore",
      restorable: true,
    });
    expect(result.entries.find((entry) => entry.path === "node_modules/pkg/index.js")).toMatchObject({
      promptIncluded: false,
      packageIncluded: false,
      exclusionReason: "default-excluded",
      restorable: true,
    });
    expect(result.entries.find((entry) => entry.path === "public/logo.png")).toMatchObject({
      contentKind: "asset",
      promptIncluded: false,
      packageIncluded: true,
      exclusionReason: "non-text-asset",
    });
    expect(result.entries.some((entry) => entry.path.includes("env"))).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/\.env|clear-secret-value/);
    expect(result.sensitiveBlockedCounts).toEqual({ credentialFiles: 1, privateKeys: 0, clearCredentials: 0 });
    expect(result.warnings.join(" ")).toMatch(/sensitive.*dropped/i);
    expect(result.originalTreeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.reviewedTreeHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("derives the same tree hash from sorted path, byte count, and SHA-256 regardless of folder enumeration order", async () => {
    // This catches browser enumeration order or object identity making project custody hashes unstable.
    const project = await import("../../src/domain/project");
    const first = await project.readFolderProject({
      kind: "folder",
      name: "project",
      files: [folderFile("b.txt", "beta\n"), folderFile("a.txt", "alpha\n")],
    });
    const second = await project.readFolderProject({
      kind: "folder",
      name: "project",
      files: [folderFile("a.txt", "alpha\n"), folderFile("b.txt", "beta\n")],
    });

    expect(first.originalTreeHash).toBe(second.originalTreeHash);
    expect(first.reviewedTreeHash).toBe(second.reviewedTreeHash);
    expect(first.entries.map(({ path, byteCount, sha256 }) => ({ path, byteCount, sha256 })))
      .toEqual(second.entries.map(({ path, byteCount, sha256 }) => ({ path, byteCount, sha256 })));
  });

  it("rejects normalized duplicates, case-fold collisions, nested archives, and folder limits", async () => {
    // This catches ambiguous paths and bounded-intake violations surviving until export.
    const project = await import("../../src/domain/project");

    await expect(project.readFolderProject({
      kind: "folder",
      name: "project",
      files: [folderFile("caf\u00e9.txt", "one"), folderFile("cafe\u0301.txt", "two")],
    })).rejects.toMatchObject({ code: "UNSAFE_PROJECT_PATH" });
    await expect(project.readFolderProject({
      kind: "folder",
      name: "project",
      files: [folderFile("Readme.md", "one"), folderFile("README.md", "two")],
    })).rejects.toMatchObject({ code: "PROJECT_PATH_COLLISION" });
    await expect(project.readFolderProject({
      kind: "folder",
      name: "project",
      files: [folderFile("nested.zip", "not read")],
    })).rejects.toMatchObject({ code: "NESTED_ARCHIVE" });
    await expect(project.readFolderProject({
      kind: "folder",
      name: "project",
      files: [folderFile("large.txt", "x", project.MAX_FOLDER_FILE_BYTES + 1)],
    })).rejects.toMatchObject({ code: "PROJECT_LIMIT_EXCEEDED" });

    for (const path of [
      "CON.txt", "aux.md", "dir/name:stream.txt", "dir/trailing. ",
      `${"a".repeat(256)}.txt`, `${"a/".repeat(512)}z.txt`,
    ]) {
      await expect(project.readFolderProject({
        kind: "folder",
        name: "project",
        files: [folderFile(path, "text")],
      })).rejects.toMatchObject({ code: "UNSAFE_PROJECT_PATH" });
    }
    await expect(project.readFolderProject({
      kind: "folder",
      name: "project",
      files: [folderFile("Straße.txt", "one"), folderFile("STRASSE.txt", "two")],
    })).rejects.toMatchObject({ code: "PROJECT_PATH_COLLISION" });
  });

  it("reads safe ZIPs, classifies clear and ambiguous LaTeX roots, and rejects traversal and compression bombs", async () => {
    // This catches the legacy LaTeX archive protections being lost when ZIP handling becomes format-neutral.
    const project = await import("../../src/domain/project");
    const clear = new JSZip();
    clear.file("main.tex", "\\documentclass{article}\n\\begin{document}Hi\\end{document}\n");
    clear.file("notes.txt", "notes\n");
    const clearResult = await project.readZipProject({
      kind: "zip",
      name: "paper.zip",
      bytes: await clear.generateAsync({ type: "uint8array" }),
    });
    expect(clearResult).toMatchObject({
      sourceKind: "zip",
      classification: "latex",
      classificationChoiceRequired: false,
      rootDocument: "main.tex",
    });

    const ambiguous = new JSZip();
    ambiguous.file("one.tex", "\\documentclass{article}\n");
    ambiguous.file("two.tex", "\\documentclass{book}\n");
    const ambiguousResult = await project.readZipProject({
      kind: "zip",
      name: "ambiguous.zip",
      bytes: await ambiguous.generateAsync({ type: "uint8array" }),
    });
    expect(ambiguousResult).toMatchObject({
      classification: "general-text",
      classificationChoiceRequired: true,
      classificationChoices: ["latex", "general-text"],
    });

    const traversal = new JSZip();
    traversal.file("../outside.txt", "outside\n");
    await expect(project.readZipProject({
      kind: "zip",
      name: "unsafe.zip",
      bytes: await traversal.generateAsync({ type: "uint8array" }),
    })).rejects.toMatchObject({ code: "UNSAFE_PROJECT_PATH" });

    const compressed = new JSZip();
    compressed.file("repeat.txt", "x".repeat(64 * 1024));
    await expect(project.readZipProject({
      kind: "zip",
      name: "compressed.zip",
      bytes: await compressed.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
    })).rejects.toMatchObject({ code: "PROJECT_LIMIT_EXCEEDED" });
  });

  it("captures immutable ZIP container provenance while folders have no fictitious container", async () => {
    // This catches export metadata being derived from a mutable caller buffer or inventing a folder archive.
    const project = await import("../../src/domain/project");
    const archive = new JSZip();
    archive.file("src/main.ts", "export const answer = 42;\n");
    const bytes = await archive.generateAsync({ type: "uint8array" });
    const original = bytes.slice();
    const pending = project.readZipProject({ kind: "zip", name: "source.zip", bytes });
    bytes.fill(0);
    const zip = await pending;
    const expectedHash = await crypto.subtle.digest("SHA-256", original);
    const expectedHex = Array.from(new Uint8Array(expectedHash), (value) => value.toString(16).padStart(2, "0")).join("");

    expect(zip.originalContainer).toEqual({
      displayName: "source.zip",
      byteCount: original.byteLength,
      sha256: expectedHex,
    });
    const folder = await project.readFolderProject({
      kind: "folder",
      name: "source",
      files: [folderFile("src/main.ts", "export const answer = 42;\n")],
    });
    expect(folder).not.toHaveProperty("originalContainer");
  });

  it("caps prompt-included files and decoded text without silently truncating reviewable content", async () => {
    // This catches prompt limits truncating source bytes or allowing an oversized prompt to be built silently.
    const project = await import("../../src/domain/project");
    const files = Array.from({ length: project.MAX_PROMPT_TEXT_FILES + 1 }, (_, index) =>
      folderFile(`src/${String(index).padStart(3, "0")}.txt`, `file ${index}\n`));
    files.push(folderFile("src/oversized.txt", "x".repeat(project.MAX_PROMPT_DECODED_TEXT_BYTES + 1)));

    const result = await project.readFolderProject({ kind: "folder", name: "project", files });
    const included = result.entries.filter((entry) => entry.promptIncluded);
    const overCount = result.entries.find((entry) => entry.path === "src/250.txt");
    const oversized = result.entries.find((entry) => entry.path === "src/oversized.txt");

    expect(included).toHaveLength(project.MAX_PROMPT_TEXT_FILES);
    expect(overCount).toMatchObject({ promptIncluded: false, exclusionReason: "prompt-limit", restorable: true });
    expect(oversized).toMatchObject({
      contentKind: "text",
      reviewedText: "x".repeat(project.MAX_PROMPT_DECODED_TEXT_BYTES + 1),
      promptIncluded: false,
      packageIncluded: true,
      exclusionReason: "prompt-limit",
    });
  });

  it("restores safe exclusions, never restores sensitive entries, and confirms only valid included text", async () => {
    // This catches inclusion controls bypassing secret or review-validity gates.
    const project = await import("../../src/domain/project");
    const read = await project.readFolderProject({
      kind: "folder",
      name: "project",
      files: [folderFile("ignored.txt", "text\n"), folderFile(".gitignore", "ignored.txt\n"), folderFile(".env", "TOKEN=value\n")],
    });
    const restored = await project.setProjectEntryInclusion(read, "ignored.txt", { promptIncluded: true, packageIncluded: true });

    expect(restored.entries.find((entry) => entry.path === "ignored.txt")).toMatchObject({
      promptIncluded: true,
      packageIncluded: true,
      exclusionReason: null,
    });
    const invalid = await project.editProjectEntryText(restored, "ignored.txt", " \n ");
    expect(() => project.confirmProjectReview(invalid)).toThrowError(project.ProjectReadError);
    const reviewed = await project.editProjectEntryText(invalid, "ignored.txt", "reviewed\n");
    expect(project.confirmProjectReview(reviewed)).toMatchObject({ requiresReview: false });
  });

  it("drops sensitive bytes before entry hashing and derives reviewed snapshots from revisions and inclusion", async () => {
    // This catches secrets entering hashes or reviewed edits reusing immutable original-tree custody.
    const project = await import("../../src/domain/project");
    const hasherInputs: string[] = [];
    const hasher = {
      digest: async (bytes: ArrayBuffer) => {
        hasherInputs.push(new TextDecoder().decode(bytes));
        return crypto.subtle.digest("SHA-256", bytes);
      },
    };
    const read = await project.readFolderProject({
      kind: "folder",
      name: "project",
      files: [folderFile("src/a.txt", "original\n"), folderFile("private.pem", "PRIVATE-SECRET-BYTES")],
    }, { hasher });
    const entry = read.entries[0];

    expect(hasherInputs.join("\n")).not.toContain("PRIVATE-SECRET-BYTES");
    expect(entry).toMatchObject({
      originalHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      reviewedTextHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      reviewRevision: 0,
    });
    expect(entry.originalBytes).toBeInstanceOf(Uint8Array);
    const edited = await project.editProjectEntryText(read, "src/a.txt", "reviewed\n");
    expect(edited.projectReviewRevision).toBe(read.projectReviewRevision + 1);
    expect(edited.originalTreeHash).toBe(read.originalTreeHash);
    expect(edited.reviewedTreeHash).not.toBe(read.reviewedTreeHash);
    expect(edited.entries[0]).toMatchObject({
      originalHash: entry.originalHash,
      reviewRevision: 1,
    });
    expect(edited.entries[0].reviewedTextHash).not.toBe(entry.reviewedTextHash);
    const excluded = await project.setProjectEntryInclusion(edited, "src/a.txt", { promptIncluded: false });
    expect(excluded.reviewedTreeHash).not.toBe(edited.reviewedTreeHash);
  });

  it("drops common serialized and shell credentials plus encrypted and DSA private keys before hashing", async () => {
    // This catches common credential syntax or less common private-key headers entering any retained project material.
    const project = await import("../../src/domain/project");
    const hasherInputs: string[] = [];
    const hasher = {
      digest: async (bytes: ArrayBuffer) => {
        hasherInputs.push(new TextDecoder().decode(bytes));
        return crypto.subtle.digest("SHA-256", bytes);
      },
    };
    const sensitive = [
      ["config.json", "{ \"api_key\": \"actual-secret-value\" }\n"],
      ["launch.sh", "export TOKEN=actual-secret-value\n"],
      ["aws.txt", "AWS_SECRET_ACCESS_KEY=actual-secret-value\n"],
      ["innocent-notes.txt", "-----BEGIN ENCRYPTED PRIVATE KEY-----\nactual-secret-value\n"],
      ["ordinary-readme.md", "-----BEGIN DSA PRIVATE KEY-----\nactual-secret-value\n"],
    ] as const;
    const read = await project.readFolderProject({
      kind: "folder",
      name: "project",
      files: [folderFile("safe.txt", "safe retained text\n"), ...sensitive.map(([path, text]) => folderFile(path, text))],
    }, { hasher });
    const retained = JSON.stringify(read);

    expect(read.entries.map((entry) => entry.path)).toEqual(["safe.txt"]);
    expect(read.sensitiveBlockedCounts).toEqual({
      credentialFiles: 0,
      privateKeys: 2,
      clearCredentials: 3,
    });
    for (const [path, text] of sensitive) {
      expect(hasherInputs.join("\n")).not.toContain(text.trim());
      expect(retained).not.toContain(path);
      expect(retained).not.toContain(text.trim());
    }
  });

  it("accepts only a retained included TeX text entry as a normalized LaTeX root", async () => {
    // This catches traversal, stale, excluded, or non-TeX roots entering the reviewed project snapshot.
    const project = await import("../../src/domain/project");
    const read = await project.readFolderProject({
      kind: "folder",
      name: "project",
      files: [
        folderFile("caf\u00e9.tex", "\\documentclass{article}\n"),
        folderFile("draft.tex", "draft\n"),
        folderFile("notes.txt", "notes\n"),
        folderFile(".gitignore", "draft.tex\n"),
      ],
    });
    const normalized = await project.chooseProjectClassification(read, "latex", "cafe\u0301.tex");
    expect(normalized.rootDocument).toBe("caf\u00e9.tex");

    for (const invalidRoot of ["../caf\u00e9.tex", "missing.tex", "draft.tex", "notes.txt"]) {
      await expect(project.chooseProjectClassification(read, "latex", invalidRoot))
        .rejects.toMatchObject({ code: "INVALID_PROJECT_REVIEW" });
    }
  });

  it("revalidates joined archive paths and accepts snapshots only for the exact operation and review revision", async () => {
    // This catches a safe leaf becoming unsafe under an export prefix or a stale reviewed snapshot winning a race.
    const project = await import("../../src/domain/project");
    expect(project.joinProjectArchivePath("project", "src/main.ts")).toBe("project/src/main.ts");
    expect(() => project.joinProjectArchivePath("CON", "src/main.ts")).toThrowError(project.ProjectReadError);
    expect(() => project.joinProjectArchivePath("project", "dir/name:stream.txt")).toThrowError(project.ProjectReadError);

    const token = { itemId: "project-1", operationId: 7, sessionGeneration: 2, projectReviewRevision: 4 };
    expect(project.isCurrentProjectSnapshot(token, { ...token })).toBe(true);
    expect(project.isCurrentProjectSnapshot(token, { ...token, projectReviewRevision: 5 })).toBe(false);
  });

  it("rejects stale project operation tokens after a newer operation or session generation", async () => {
    // This catches late folder/ZIP reads repopulating a replaced project or reset session.
    const project = await import("../../src/domain/project");
    const first = { itemId: "project-1", operationId: 4, sessionGeneration: 2 };

    expect(project.isCurrentProjectOperation(first, { ...first })).toBe(true);
    expect(project.isCurrentProjectOperation(first, { ...first, operationId: 5 })).toBe(false);
    expect(project.isCurrentProjectOperation(first, { ...first, sessionGeneration: 3 })).toBe(false);
    expect(project.isCurrentProjectOperation(first, { ...first, itemId: "project-2" })).toBe(false);
  });

  it("creates a prompt snapshot only from a confirmed exact reviewed revision", async () => {
    // This catches package generation reading live mutable project entries after review or accepting an older snapshot.
    const project = await import("../../src/domain/project");
    const read = await project.readFolderProject({
      kind: "folder",
      name: "project",
      files: [folderFile("src/a.ts", "export const value = 1;\n"), folderFile("dist/app.js", "generated\n")],
    });
    expect(() => project.createProjectPromptSnapshot(read, 3)).toThrowError(project.ProjectReadError);
    const confirmed = project.confirmProjectReview(read);
    const snapshot = project.createProjectPromptSnapshot(confirmed, 3);

    expect(snapshot).toMatchObject({
      itemId: confirmed.id,
      operationId: confirmed.projectOperationGeneration,
      sessionGeneration: 3,
      projectReviewRevision: confirmed.projectReviewRevision,
      originalTreeHash: confirmed.originalTreeHash,
      reviewedTreeHash: confirmed.reviewedTreeHash,
      excludedPaths: ["dist/app.js"],
    });
    expect(snapshot.includedFiles).toEqual([{
      path: "src/a.ts",
      text: "export const value = 1;\n",
      originalHash: confirmed.entries[1].originalHash,
      reviewedTextHash: confirmed.entries[1].reviewedTextHash,
      languageId: "typescript",
      previewKind: "code",
    }]);
    expect(snapshot).not.toHaveProperty("originalBytes");
    expect(project.isCurrentProjectPromptSnapshot(confirmed, 3, snapshot)).toBe(true);
    expect(project.isCurrentProjectPromptSnapshot({ ...confirmed, projectReviewRevision: 1 }, 3, snapshot)).toBe(false);
    expect(project.isCurrentProjectPromptSnapshot(confirmed, 4, snapshot)).toBe(false);
    expect(project.isCurrentProjectPromptSnapshot({ ...confirmed, reviewedTreeHash: "f".repeat(64) }, 3, snapshot)).toBe(false);
  });

  it("includes classification and root choices in the reviewed snapshot revision", async () => {
    // This catches an ambiguous LaTeX choice reusing a General-text snapshot hash or confirmed package revision.
    const project = await import("../../src/domain/project");
    const archive = new JSZip();
    archive.file("one.tex", "\\documentclass{article}\n");
    archive.file("two.tex", "\\documentclass{book}\n");
    const read = await project.readZipProject({
      kind: "zip",
      name: "ambiguous.zip",
      bytes: await archive.generateAsync({ type: "uint8array" }),
    });
    const chosen = await project.chooseProjectClassification(read, "latex", "one.tex");

    expect(chosen).toMatchObject({
      classification: "latex",
      rootDocument: "one.tex",
      classificationChoiceRequired: false,
      projectReviewRevision: read.projectReviewRevision + 1,
      requiresReview: true,
    });
    expect(chosen.reviewedTreeHash).not.toBe(read.reviewedTreeHash);
    const snapshot = project.createProjectPromptSnapshot(project.confirmProjectReview(chosen), 1);
    expect(snapshot).toMatchObject({ classification: "latex", rootDocument: "one.tex" });
  });
});
