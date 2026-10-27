import { describe, expect, it } from "vitest";

import { cloneExtractionOptions, DEFAULT_EXTRACTION_OPTIONS, extractFile } from "../../src/domain";

const encoder = new TextEncoder();
const imageBytes = new Uint8Array([137, 80, 78, 71, 10, 20, 30]);
const encodedImage = btoa(String.fromCharCode(...imageBytes));

function accepted(source: string) {
  const bytes = encoder.encode(source);
  return {
    accepted: true as const,
    file: new File([bytes], "notes.md", { type: "text/markdown" }),
    format: "markdown" as const,
    originalBytes: bytes.buffer,
  };
}

describe("Markdown embedded media", () => {
  it("extracts an opted-in raster data image without retaining its base64 payload in review text", async () => {
    // This catches embedded binary payloads bloating prompts or losing the image's position and accessible label.
    const source = `Before\n\n![Calibration plot](data:image/png;base64,${encodedImage})\n\nAfter\n`;
    const result = await extractFile(accepted(source), {
      options: { ...cloneExtractionOptions(DEFAULT_EXTRACTION_OPTIONS), extractEmbeddedImages: true },
    } as never);

    expect(result.extractedText).toMatch(/!\[Calibration plot\]\(asset:asset-[a-f0-9]{12}\)/);
    expect(result.extractedText).not.toContain(encodedImage);
    expect(result.visualAssets).toHaveLength(1);
    expect(result.visualAssets?.[0]).toMatchObject({
      kind: "markdown-data-image",
      mimeType: "image/png",
      altText: "Calibration plot",
      included: true,
    });
    expect(Array.from(result.visualAssets?.[0].bytes ?? [])).toEqual(Array.from(imageBytes));
  });

  it("honors an explicit embedded-image opt-out and replaces data bytes with an inspectable omission marker", async () => {
    // This catches a saved off choice being ignored or a large data URL entering generated prompts after opt-out.
    const source = `![Plot](data:image/png;base64,${encodedImage})`;
    const result = await extractFile(accepted(source), {
      options: { ...cloneExtractionOptions(DEFAULT_EXTRACTION_OPTIONS), extractEmbeddedImages: false },
    } as never);

    expect(result.visualAssets).toEqual([]);
    expect(result.extractedText).toBe("[Embedded image omitted: Plot]");
    expect(result.extractedText).not.toContain(encodedImage);
    expect(result.warnings.join(" ")).toMatch(/image extraction is off/i);
  });

  it("creates a separate review candidate when OCR is explicitly enabled for extracted assets", async () => {
    // This catches figure OCR being silently merged or the per-asset opt-in being ignored.
    const source = `![Plot](data:image/png;base64,${encodedImage})`;
    const result = await extractFile(accepted(source), {
      options: {
        ...cloneExtractionOptions(DEFAULT_EXTRACTION_OPTIONS),
        extractEmbeddedImages: true,
        ocrExtractedAssets: true,
      },
      ocrAdapter: {
        recognize: async () => ({
          text: "Figure label",
          confidence: 88,
          engineVersion: "7.0.0",
          languageHash: "english-hash",
        }),
      },
    } as never);

    expect(result.ocrCandidates).toEqual([expect.objectContaining({
      source: { kind: "asset", assetId: result.visualAssets?.[0].id },
      reviewedText: "Figure label",
      status: "pending",
    })]);
    expect(result.extractedText).not.toContain("Figure label");
  });
});
