import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import * as domain from "../../src/domain";

const encoder = new TextEncoder();

function upload(name: string, bytes: Uint8Array, type = "application/octet-stream"): File {
  return {
    name,
    size: bytes.byteLength,
    type,
    arrayBuffer: async () => bytes.slice().buffer,
  } as File;
}

describe("document processing contracts", () => {
  it("extracts embedded images by default while keeping captures and OCR opt-in under approved caps", () => {
    // This catches the v0.4 embedded-image default regressing or expensive page capture/OCR becoming implicit.
    const values = domain as unknown as Record<string, unknown>;

    expect(values.DEFAULT_EXTRACTION_OPTIONS).toEqual({
      extractEmbeddedImages: true,
      capturePageVisuals: false,
      pageSelection: "all",
      pageCaptureQuality: "standard",
      ocrMode: "off",
      ocrExtractedAssets: false,
      ocrLanguage: { kind: "bundled", code: "eng", label: "English" },
      excludeDecorativeImages: true,
    });
    expect(values.MAX_OCR_PAGES).toBe(150);
    expect(values.MAX_VISUAL_ASSETS_PER_DOCUMENT).toBe(200);
    expect(values.MAX_VISUAL_ASSET_BYTES_PER_DOCUMENT).toBe(100 * 1024 * 1024);
    expect(values.MAX_GENERATED_MEDIA_BYTES_PER_PACKAGE).toBe(300 * 1024 * 1024);
    expect(values.MAX_FULL_HTML_BYTES).toBe(150 * 1024 * 1024);
  });

  it("recognizes standalone LaTeX and project ZIP uploads without changing existing formats", async () => {
    // This catches the new formats being omitted from admission or a generic ZIP being mistaken for DOCX.
    expect(domain.formatFromName("paper.tex")).toBe("latex");
    expect(domain.formatFromName("appendix.LTX")).toBe("latex");
    expect(domain.formatFromName("manuscript.zip")).toBe("latex-project");
    expect(domain.formatFromName("paper.pdf")).toBe("pdf");

    const archive = new JSZip();
    archive.file("main.tex", "\\documentclass{article}\n\\begin{document}Hello\\end{document}\n");
    const zipBytes = await archive.generateAsync({ type: "uint8array" });
    const results = await domain.preflightFiles([
      upload("paper.tex", encoder.encode("\\documentclass{article}\n"), "application/x-tex"),
      upload("project.zip", zipBytes, "application/zip"),
    ]);

    expect(results.map((result) => result.accepted ? result.format : result.issue.code)).toEqual([
      "latex",
      "latex-project",
    ]);
  });

  it("normalizes selected page ranges without permitting out-of-range or duplicate pages", () => {
    // This catches page-range parsing that repeats expensive work or reads outside the admitted document.
    const parse = (domain as unknown as { normalizePageSelection?: (value: string, pages: number) => number[] }).normalizePageSelection;

    expect(parse?.("1-3, 3, 7, 9-10", 9)).toEqual([1, 2, 3, 7, 9]);
    expect(() => parse?.("0, 2", 4)).toThrow(/page range/i);
    expect(() => parse?.("4-2", 4)).toThrow(/page range/i);
  });
});
