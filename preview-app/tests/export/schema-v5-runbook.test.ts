import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { CURATED_MODEL_PROFILES, type PromptBundle } from "../../src/domain";
import type { ExportDocumentInput } from "../../src/export";

const encoder = new TextEncoder();

function upload(name: string, text: string): File {
  const bytes = encoder.encode(text);
  return { name, size: bytes.byteLength, type: "text/plain", arrayBuffer: async () => bytes.slice().buffer } as File;
}

function input(): ExportDocumentInput {
  const promptBundle: PromptBundle = {
    oneShot: "ONE SHOT",
    manual: {
      decompose: "DECOMPOSE",
      rewrite: "REWRITE\n<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>",
      verify: "VERIFY\n<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>\n<<<INSERT_STAGE_2_REWRITE_RESPONSE>>>",
      final: "FINAL\n<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>\n<<<INSERT_STAGE_2_REWRITE_RESPONSE>>>\n<<<INSERT_STAGE_3_VERIFICATION_RESPONSE>>>",
    },
  };
  return {
    documentId: "notes",
    documentName: "Notes.txt",
    documentFormat: "text",
    original: upload("Notes.txt", "original"),
    reviewedExtractedText: "reviewed",
    resolvedSettings: { tone: "academic", formality: "formal", length: "concise", outputLanguage: "English", customRequirements: "" },
    chosenProfile: CURATED_MODEL_PROFILES.find((profile) => profile.id === "openai-general")!,
    promptBundle,
    warnings: [],
    contextAssessment: {
      estimateLabel: "Estimated tokens", sourceTokens: 2, oneShotWorkflowTokens: 100, manualWorkflowTokens: 200,
      oneShotRatio: 0.01, manualRatio: 0.02, oneShotOversized: false, manualOversized: false, oneShotWarning: false,
      workflowTokens: 200, contextWindowTokens: 1_050_000, ratio: 0.02, oversized: false, acknowledgmentRequired: false,
    },
    reviewed: true,
    contextWarningAcknowledged: false,
    uploadOrdinal: 0,
  };
}

describe("schema-v6 archive and semantic runbook", () => {
  it("emits the exact nested v5 document tree without a legacy prompts directory", async () => {
    const { buildPromptPackage } = await import("../../src/export");
    const result = await buildPromptPackage([input()]);
    if (!result.ok) throw new Error("fixture should export");
    if (!result.manifest.documents[0].original) throw new Error("file fixture requires original record");
    const archive = await JSZip.loadAsync(result.blob, { checkCRC32: true });
    const key = result.manifest.documents[0].key;
    const paths = Object.keys(archive.files).filter((path) => path.startsWith(`documents/${key}/`));

    expect(result.manifest.schemaVersion).toBe(6);
    expect(result.manifest.package.version).toBe("0.8.0");
    expect(paths).toEqual(expect.arrayContaining([
      `documents/${key}/one-shot/00-one-shot.md`,
      `documents/${key}/one-shot/one-shot-prompt.md`,
      `documents/${key}/one-shot/one-shot-prompt.html`,
      `documents/${key}/manual-prompts/01-decompose.md`,
      `documents/${key}/manual-prompts/02-rewrite.md`,
      `documents/${key}/manual-prompts/03-verify.md`,
      `documents/${key}/manual-prompts/04-final.md`,
      `documents/${key}/manual-prompts/manual-prompts.md`,
      `documents/${key}/manual-prompts/manual-prompts.html`,
      `documents/${key}/combined-prompts/combined-prompts.md`,
      `documents/${key}/combined-prompts/combined-prompts.html`,
    ]));
    expect(paths.some((path) => path.startsWith(`documents/${key}/prompts/`))).toBe(false);
    expect(Object.values(archive.files).every((entry) => !entry.dir)).toBe(true);
  });

  it("uses one immutable semantic runbook as the exact root README and escapes its standalone HTML", async () => {
    const { buildPromptPackage, renderRunbookHtml, serializeRunbookMarkdown } = await import("../../src/export");
    const result = await buildPromptPackage([input()]);
    if (!result.ok) throw new Error("fixture should export");
    const workbook = result.workbooks[0];
    const archive = await JSZip.loadAsync(result.blob, { checkCRC32: true });
    const readme = await archive.file("README.md")?.async("string");

    expect(workbook.runbookDocument).toBeDefined();
    expect(Object.isFrozen(workbook.runbookDocument)).toBe(true);
    expect(Object.isFrozen(workbook.runbookDocument!.blocks)).toBe(true);
    expect(serializeRunbookMarkdown(workbook.runbookDocument!)).toBe(readme);
    expect(workbook.runbookMarkdown).toBe(readme);
    expect(workbook.runbookDocument!.blocks.some((block) => block.type === "list")).toBe(true);
    expect(workbook.runbookDocument!.blocks.some((block) => block.type === "code-block")).toBe(true);
    expect(workbook.combined.markdown).not.toMatch(/\]\(documents\//u);
    const html = renderRunbookHtml({
      type: "runbook-document",
      blocks: [{ type: "paragraph", content: [{ type: "text", value: "</p><script id=bad>alert(1)</script>" }] }],
    });
    const parsed = new DOMParser().parseFromString(html, "text/html");
    expect(parsed.querySelector("#bad")).toBeNull();
    expect(parsed.body.textContent).toContain("</p><script id=bad>alert(1)</script>");
    const hostileMarkdown = serializeRunbookMarkdown({
      type: "runbook-document",
      blocks: [{ type: "paragraph", content: [{ type: "text", value: "[leave](https://evil.test) <https://evil.test>" }] }],
    });
    expect(hostileMarkdown).not.toContain("](https://");
    expect(hostileMarkdown).not.toContain("<https://");
  });

  it("gives combined HTML README, ONE-SHOT, and MANUAL tabs with README selected by default", async () => {
    const { buildPromptPackage } = await import("../../src/export");
    const result = await buildPromptPackage([input()]);
    if (!result.ok) throw new Error("fixture should export");
    const original = result.manifest.documents[0].original;
    if (!original) throw new Error("file fixture requires original record");
    const parsed = new DOMParser().parseFromString(result.workbooks[0].combined.html, "text/html");

    expect(Array.from(parsed.querySelectorAll('[role="tab"]'), (node) => node.textContent)).toEqual(["README", "ONE-SHOT", "MANUAL"]);
    expect(parsed.querySelector('[data-workflow-tab="readme"]')?.getAttribute("aria-selected")).toBe("true");
    expect(parsed.querySelector("#panel-readme")?.hasAttribute("hidden")).toBe(false);
    expect(parsed.querySelector("#panel-one-shot")?.hasAttribute("hidden")).toBe(true);
    expect(parsed.querySelector("#panel-manual")?.hasAttribute("hidden")).toBe(true);
    expect(parsed.querySelectorAll(".runbook")).toHaveLength(1);
    expect(parsed.querySelector("#panel-readme > .assets")).not.toBeNull();
    expect(parsed.querySelector("#panel-one-shot .assets, #panel-manual .assets")).toBeNull();
    expect(new DOMParser().parseFromString(result.workbooks[0].oneShot.html, "text/html").querySelector(".runbook")).not.toBeNull();
    expect(new DOMParser().parseFromString(result.workbooks[0].manual.html, "text/html").querySelector(".runbook")).not.toBeNull();
  });

  it("keeps the shared runbook portable across root and nested workbook locations", async () => {
    const { buildPromptPackage } = await import("../../src/export");
    const result = await buildPromptPackage([input()]);
    if (!result.ok) throw new Error("fixture should export");
    const original = result.manifest.documents[0].original;
    if (!original) throw new Error("file fixture requires original record");
    const parsed = new DOMParser().parseFromString(result.workbooks[0].combined.html, "text/html");
    expect(parsed.querySelector("#panel-readme a[href]")).toBeNull();
    expect(parsed.querySelector("#panel-readme")?.textContent).toContain(original.path);
  });

  it("derives safe workbook links from canonical archive paths", async () => {
    const { relativeArchivePath } = await import("../../src/export");
    expect(relativeArchivePath(
      "documents/key/manual-prompts/manual-prompts.html",
      "documents/key/assets/figure.png",
    )).toBe("../assets/figure.png");
    expect(relativeArchivePath(
      "documents/key/deeper/more/workbook.html",
      "documents/key/assets/figure.png",
    )).toBe("../../assets/figure.png");
    expect(() => relativeArchivePath("documents/key/../bad.html", "documents/key/assets/x.png")).toThrow(/canonical/u);
  });

  it("keeps full-HTML status monotonic until the final runbook render reaches a fixed point", async () => {
    vi.resetModules();
    vi.doMock("../../src/domain", async (importOriginal) => ({
      ...await importOriginal<typeof import("../../src/domain")>(),
      MAX_FULL_HTML_BYTES: 70_000,
    }));
    try {
      const { buildPromptPackage } = await import("../../src/export");
      const source = input();
      source.promptBundle = { ...source.promptBundle, oneShot: `ONE SHOT\n${"x".repeat(65_000)}` };
      const result = await buildPromptPackage([source]);
      if (!result.ok) throw new Error("fixture should export");
      const status = result.manifest.documents[0].workbooks.combined.fullHtml.status;
      expect(result.workbooks[0].combined.fullHtmlStatus).toBe(status);
      expect(Boolean(result.workbooks[0].combined.fullHtml)).toBe(status === "generated");
      expect(result.workbooks[0].runbookMarkdown).toContain(status === "generated" ? "combined-prompts-full.html" : "Not generated: encoded size limit");
    } finally {
      vi.doUnmock("../../src/domain");
      vi.resetModules();
    }
  });
});
