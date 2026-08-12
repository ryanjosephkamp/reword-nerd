import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { CURATED_MODEL_PROFILES, type PromptBundle } from "../../src/domain";
import type { ExportDocumentInput } from "../../src/export";

const encoder = new TextEncoder();
const markerValues = {
  stage1: "<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>",
  stage2: "<<<INSERT_STAGE_2_REWRITE_RESPONSE>>>",
  stage3: "<<<INSERT_STAGE_3_VERIFICATION_RESPONSE>>>",
};

function upload(name: string, text: string): File {
  const bytes = encoder.encode(text);
  return {
    name,
    size: bytes.byteLength,
    type: "text/plain",
    arrayBuffer: async () => bytes.slice().buffer,
  } as File;
}

function promptBundle(suffix = ""): PromptBundle {
  return {
    oneShot: `ONE SHOT${suffix}\nReturn final document and audit.`,
    manual: {
      decompose: `DECOMPOSE${suffix}`,
      rewrite: `REWRITE${suffix}\n${markerValues.stage1}`,
      verify: `VERIFY${suffix}\n${markerValues.stage1}\n${markerValues.stage2}`,
      final: `FINAL${suffix}\n${markerValues.stage1}\n${markerValues.stage2}\n${markerValues.stage3}`,
    },
  };
}

function documentInput(name = "Notes.txt", ordinal = 0): ExportDocumentInput {
  return {
    documentId: `document-${ordinal}`,
    documentName: name,
    documentFormat: "text",
    original: upload(name, `original ${name}`),
    reviewedExtractedText: `Reviewed ${name}\n`,
    resolvedSettings: {
      tone: "academic",
      formality: "formal",
      length: "concise",
      outputLanguage: "English",
      customRequirements: "Keep citations.",
    },
    chosenProfile: CURATED_MODEL_PROFILES.find((profile) => profile.id === "openai-general")!,
    promptBundle: promptBundle(` ${name}`),
    warnings: [],
    contextAssessment: {
      estimateLabel: "Estimated tokens",
      sourceTokens: 10,
      oneShotWorkflowTokens: 1_520,
      manualWorkflowTokens: 3_040,
      oneShotRatio: 1_520 / 1_050_000,
      manualRatio: 3_040 / 1_050_000,
      oneShotOversized: false,
      manualOversized: false,
      oneShotWarning: false,
      workflowTokens: 3_040,
      contextWindowTokens: 1_050_000,
      ratio: 3_040 / 1_050_000,
      oversized: false,
      acknowledgmentRequired: false,
    },
    reviewed: true,
    contextWarningAcknowledged: false,
    uploadOrdinal: ordinal,
  };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("v4 workbook package", () => {
  it("emits the full dual-mode suite with exact prompt parity and hashes every generated artifact", async () => {
    // This catches a v4 package that drops a workflow companion, alters canonical prompt bytes, or records stale hashes.
    const { buildPromptPackage } = await import("../../src/export");
    const input = documentInput();
    const result = await buildPromptPackage([input]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("fixture should export");
    expect(result.manifest).toMatchObject({
      schemaVersion: 4,
      package: { name: "reword-nerd", version: "0.4.0", format: "dual-mode-prompt-package" },
      workflow: {
        modes: ["one-shot", "manual"],
        manualStages: ["decompose", "rewrite", "verify", "final"],
        responseMarkers: markerValues,
      },
    });
    expect(result.workbooks).toHaveLength(1);
    expect(result.artifacts).toBe(result.workbooks);
    const document = result.manifest.documents[0];
    const workbook = result.workbooks[0];
    const archive = await JSZip.loadAsync(result.blob, { checkCRC32: true });
    const expectedPromptBytes = {
      oneShot: input.promptBundle.oneShot,
      ...input.promptBundle.manual,
    };

    expect(document.prompts.oneShot.path).toMatch(/\/prompts\/00-one-shot\.md$/);
    for (const [stage, expected] of Object.entries(expectedPromptBytes) as Array<[keyof typeof expectedPromptBytes, string]>) {
      const bytes = await archive.file(document.prompts[stage].path)?.async("uint8array");
      expect(new TextDecoder().decode(bytes)).toBe(expected);
      expect(await sha256(bytes!)).toBe(document.prompts[stage].sha256);
    }

    const generated = [
      document.reviewedExtraction,
      document.visualAssets.index,
      document.visualAssets.placementMap,
      document.ocr,
      document.workbooks.oneShot.markdown,
      document.workbooks.oneShot.html,
      document.workbooks.manual.markdown,
      document.workbooks.manual.html,
      document.workbooks.combined.markdown,
      document.workbooks.combined.html,
      ...(document.workbooks.combined.fullHtml.status === "generated" ? [document.workbooks.combined.fullHtml] : []),
      result.manifest.rootArtifacts.readme,
      result.manifest.rootArtifacts.openMe,
    ];
    for (const record of generated) {
      const bytes = await archive.file(record.path)?.async("uint8array");
      expect(bytes, record.path).toBeDefined();
      expect(await sha256(bytes!)).toBe(record.sha256);
    }

    await expect(archive.file(document.workbooks.oneShot.markdown.path)?.async("string")).resolves.toBe(workbook.oneShot.markdown);
    await expect(archive.file(document.workbooks.manual.html.path)?.async("string")).resolves.toBe(workbook.manual.html);
    await expect(archive.file(document.workbooks.combined.markdown.path)?.async("string")).resolves.toBe(workbook.combined.markdown);
    expect(workbook.oneShot.html).toContain(input.promptBundle.oneShot);
    expect(workbook.oneShot.html).not.toContain(input.promptBundle.manual.decompose);
    expect(workbook.manual.html).toContain(input.promptBundle.manual.decompose);
    expect(workbook.manual.html).not.toContain(input.promptBundle.oneShot);
  });

  it("hydrates downstream prompts while preserving stale manual edits until explicit reapply or reset", async () => {
    // This catches upstream responses silently overwriting an edited downstream prompt or enabling Copy too early.
    const {
      buildPromptPackage,
      createWorkbookProgress,
      editWorkbookPrompt,
      reapplyWorkbookPrompt,
      resetWorkbookPrompt,
      updateWorkbookResponse,
    } = await import("../../src/export");
    const result = await buildPromptPackage([documentInput()]);
    if (!result.ok) throw new Error("fixture should export");
    const workbook = result.workbooks[0];
    const initial = createWorkbookProgress(workbook);

    expect(initial.manual.prompts.decompose.copyEnabled).toBe(true);
    expect(initial.manual.prompts.rewrite.copyEnabled).toBe(false);
    expect(initial.manual.prompts.rewrite.text).toBe(workbook.promptBundle.manual.rewrite);
    const withFirst = updateWorkbookResponse(workbook, initial, "decompose", "analysis one");
    expect(withFirst.manual.prompts.rewrite).toMatchObject({
      text: inputHydrated("REWRITE Notes.txt", [[markerValues.stage1, "analysis one"]]),
      copyEnabled: true,
      edited: false,
      stale: false,
    });

    const edited = editWorkbookPrompt(workbook, withFirst, "rewrite", "MY CAREFUL EDIT");
    const changed = updateWorkbookResponse(workbook, edited, "decompose", "analysis two");
    expect(changed.manual.prompts.rewrite).toMatchObject({
      text: "MY CAREFUL EDIT",
      copyEnabled: true,
      edited: true,
      stale: true,
    });
    const reapplied = reapplyWorkbookPrompt(workbook, changed, "rewrite");
    expect(reapplied.manual.prompts.rewrite).toMatchObject({
      text: inputHydrated("REWRITE Notes.txt", [[markerValues.stage1, "analysis two"]]),
      edited: false,
      stale: false,
    });
    const editedAgain = editWorkbookPrompt(workbook, reapplied, "rewrite", "ANOTHER EDIT");
    expect(resetWorkbookPrompt(workbook, editedAgain, "rewrite").manual.prompts.rewrite.text).toBe(
      inputHydrated("REWRITE Notes.txt", [[markerValues.stage1, "analysis two"]]),
    );
    expect(Object.isFrozen(changed)).toBe(true);
    expect(Object.isFrozen(changed.manual.prompts.rewrite)).toBe(true);
  });

  it("escapes hostile content, exposes exactly two accessible workflow tabs, and makes no network or storage request", async () => {
    // This catches prompt or filename injection and accidental persistence/network code in exported workbooks.
    const { buildPromptPackage } = await import("../../src/export");
    const input = documentInput('Bad </title><script id="pwn">alert(1)</script>.txt');
    input.promptBundle = promptBundle(" </textarea><img src=x onerror=alert(1)>");
    input.reviewedExtractedText = "Reviewed </script><script>steal()</script>";
    const result = await buildPromptPackage([input]);
    if (!result.ok) throw new Error("fixture should export");
    const html = result.workbooks[0].combined.html;
    const parsed = new DOMParser().parseFromString(html, "text/html");

    expect(Array.from(parsed.querySelectorAll('[role="tab"]'), (node) => node.textContent)).toEqual(["ONE-SHOT", "MANUAL"]);
    expect(parsed.querySelector("#pwn, img[src='x']")).toBeNull();
    expect(parsed.querySelectorAll("script[src], link[href], iframe[src], object[data]")).toHaveLength(0);
    expect(parsed.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toContain("connect-src 'none'");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/localStorage|sessionStorage|indexedDB/i);
    expect(parsed.querySelectorAll('textarea[data-response-stage]')).toHaveLength(5);
    expect(parsed.querySelector('button[data-copy-stage="rewrite"]')?.hasAttribute("disabled")).toBe(true);
    expect(parsed.querySelector('button[data-download-progress]')?.textContent).toBe("DOWNLOAD PROGRESS COPY");
  });

  it("round-trips current prompt edits and every response through a standalone progress copy", async () => {
    // This catches progress downloads that serialize only the original defaults or omit the optional Stage 4 response.
    const {
      buildPromptPackage,
      createWorkbookProgress,
      editWorkbookPrompt,
      parseWorkbookProgressHtml,
      renderWorkbookProgressHtml,
      updateWorkbookResponse,
    } = await import("../../src/export");
    const result = await buildPromptPackage([documentInput()]);
    if (!result.ok) throw new Error("fixture should export");
    const workbook = result.workbooks[0];
    let progress = createWorkbookProgress(workbook);
    progress = updateWorkbookResponse(workbook, progress, "oneShot", "one-shot final and audit");
    progress = updateWorkbookResponse(workbook, progress, "decompose", "response one");
    progress = editWorkbookPrompt(workbook, progress, "rewrite", "locally edited rewrite prompt");
    progress = updateWorkbookResponse(workbook, progress, "rewrite", "response two");
    progress = updateWorkbookResponse(workbook, progress, "verify", "response three");
    progress = updateWorkbookResponse(workbook, progress, "final", "optional final response");

    const html = renderWorkbookProgressHtml(workbook, progress);
    const restored = parseWorkbookProgressHtml(workbook, html);

    expect(restored).toEqual(progress);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).not.toMatch(/localStorage|sessionStorage|indexedDB/i);
    expect(html).toContain("locally edited rewrite prompt");
    expect(html).toContain("optional final response");
  });

  it("creates a root OPEN-ME entry point for every document without flattening document namespaces", async () => {
    // This catches multi-document packages that expose only one workbook or move convenience files to colliding root paths.
    const { buildPromptPackage } = await import("../../src/export");
    const result = await buildPromptPackage([documentInput("Zulu.txt", 2), documentInput("Alpha.txt", 1)]);
    if (!result.ok) throw new Error("fixture should export");
    const archive = await JSZip.loadAsync(result.blob, { checkCRC32: true });
    const openMe = await archive.file("OPEN-ME.html")?.async("string");
    const parsed = new DOMParser().parseFromString(openMe!, "text/html");
    const hrefs = Array.from(parsed.querySelectorAll("a[href]"), (node) => node.getAttribute("href"));

    expect(result.manifest.documents.map((document) => document.originalDisplayName)).toEqual(["Alpha.txt", "Zulu.txt"]);
    expect(hrefs).toEqual(result.manifest.documents.flatMap((document) => [
      document.workbooks.combined.html.path,
      document.workbooks.oneShot.html.path,
      document.workbooks.manual.html.path,
    ]));
    expect(Object.keys(archive.files).filter((path) => /(?:one-shot-prompt|manual-prompts|combined-prompts)\.html$/.test(path)))
      .toHaveLength(6);
    expect(Object.keys(archive.files).filter((path) => path.startsWith("documents/"))).toHaveLength(
      Object.keys(archive.files).length - 3,
    );
  });

  it("produces byte-identical archives and immutable workbook bytes across repeated builds", async () => {
    // This catches clock, ordering, compression, or mutable workbook state leaking into deterministic output.
    const { buildPromptPackage } = await import("../../src/export");
    const inputs = [documentInput("Zulu.txt", 2), documentInput("Alpha.txt", 1)];
    const [first, second] = await Promise.all([buildPromptPackage(inputs), buildPromptPackage([...inputs].reverse())]);
    if (!first.ok || !second.ok) throw new Error("fixtures should export");

    const firstBytes = new Uint8Array(await first.blob.arrayBuffer());
    const secondBytes = new Uint8Array(await second.blob.arrayBuffer());
    expect(firstBytes).toEqual(secondBytes);
    expect(first.workbooks).toEqual(second.workbooks);
    expect(Object.isFrozen(first.workbooks)).toBe(true);
    expect(Object.isFrozen(first.workbooks[0])).toBe(true);
    const archive = await JSZip.loadAsync(first.blob, { checkCRC32: true });
    expect(Object.keys(archive.files)).toEqual([...Object.keys(archive.files)].sort());
    expect(Object.values(archive.files).every((entry) => !entry.dir)).toBe(true);
  });
});

function inputHydrated(prefix: string, replacements: Array<[string, string]>): string {
  return replacements.reduce((text, [marker, response]) => text.replaceAll(marker, response), `${prefix}\n${markerValues.stage1}`);
}
