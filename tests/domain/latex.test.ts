import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { cloneExtractionOptions, DEFAULT_EXTRACTION_OPTIONS, extractFile, preflightFiles } from "../../src/domain";

const encoder = new TextEncoder();
const onePixelPng = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Wl1sAAAAASUVORK5CYII=",
), (character) => character.charCodeAt(0));

function upload(name: string, bytes: Uint8Array, type = "application/octet-stream"): File {
  return {
    name,
    size: bytes.byteLength,
    type,
    arrayBuffer: async () => bytes.slice().buffer,
  } as File;
}

describe("LaTeX extraction", () => {
  it("preserves a standalone source document exactly for review", async () => {
    // This catches a TeX parser normalizing commands, math, citations, or source whitespace before review.
    const source = "\\documentclass{article}\n\\begin{document}\nText $x^2$ \\cite{key}.\n\\end{document}\n";
    const result = await extractFile({
      accepted: true,
      file: upload("paper.tex", encoder.encode(source), "application/x-tex"),
      format: "latex",
      originalBytes: encoder.encode(source).buffer,
    });

    expect(result).toMatchObject({
      format: "latex",
      extractedText: source,
      pageCount: null,
      visualAssets: [],
      requiresReview: true,
    });
  });

  it("extracts a safe project with path-delimited source, dependencies, and preserved figures", async () => {
    // This catches project flattening, main-file drift, or image references losing their original project paths.
    const archive = new JSZip();
    archive.file("main.tex", [
      "\\documentclass{article}",
      "\\begin{document}",
      "\\input{sections/intro}",
      "\\includegraphics{figures/chart.png}",
      "\\bibliography{refs}",
      "\\end{document}",
      "",
    ].join("\n"));
    archive.file("sections/intro.tex", "An introduction.\n");
    archive.file("refs.bib", "@article{key,title={Example}}\n");
    archive.file("figures/chart.png", onePixelPng);
    const bytes = await archive.generateAsync({ type: "uint8array" });
    const accepted = (await preflightFiles([upload("manuscript.zip", bytes, "application/zip")]))[0];
    if (!accepted.accepted) throw new Error(`fixture rejected: ${accepted.issue.code}`);

    const result = await extractFile(accepted, {
      options: { ...cloneExtractionOptions(DEFAULT_EXTRACTION_OPTIONS), extractEmbeddedImages: true },
    } as never);

    expect(result.extractedText).toContain("<<<FILE main.tex>>>\n\\documentclass{article}");
    expect(result.extractedText).toContain("<<<FILE sections/intro.tex>>>\nAn introduction.\n<<<END FILE>>>");
    expect(result.latexProject).toMatchObject({
      mainFile: "main.tex",
      mainFileCandidates: ["main.tex"],
      dependencies: {
        "main.tex": ["figures/chart.png", "refs.bib", "sections/intro.tex"],
      },
      missingDependencies: [],
      cycles: [],
    });
    expect(result.visualAssets).toHaveLength(1);
    expect(result.visualAssets?.[0]).toMatchObject({
      kind: "latex-asset",
      sourcePath: "figures/chart.png",
      mimeType: "image/png",
      byteCount: onePixelPng.byteLength,
      included: true,
    });
    expect(Array.from(result.visualAssets?.[0].bytes ?? [])).toEqual(Array.from(onePixelPng));
  });

  it("rejects archive traversal before retaining the project", async () => {
    // This catches a project ZIP escaping its document namespace during extraction or export.
    const archive = new JSZip();
    archive.file("../outside.tex", "\\documentclass{article}\n");
    const bytes = await archive.generateAsync({ type: "uint8array" });

    const result = (await preflightFiles([upload("unsafe.zip", bytes, "application/zip")]))[0];

    expect(result).toMatchObject({ accepted: false, issue: { code: "UNSAFE_ARCHIVE" } });
  });
});
