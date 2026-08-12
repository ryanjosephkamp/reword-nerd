import { describe, expect, it } from "vitest";

import { cloneExtractionOptions, composeExtractionWithOcr, DEFAULT_EXTRACTION_OPTIONS, extractPdfWithAdapter } from "../../src/domain";

const pagePng = new Uint8Array([137, 80, 78, 71, 9]);

function pdf(pageCount = 2) {
  const rendered: number[] = [];
  return {
    rendered,
    adapter: {
      load: () => ({
        promise: Promise.resolve({
          numPages: pageCount,
          getPage: async (pageNumber: number) => ({
            getTextContent: async () => ({ items: pageNumber === 1 ? [{ str: "Native text" }] : [] }),
            renderToPng: async () => {
              rendered.push(pageNumber);
              return { bytes: pagePng, width: 1200, height: 1600 };
            },
          }),
        }),
      }),
    },
  };
}

describe("review-first OCR", () => {
  it("composes only accepted OCR candidates in page order with explicit review markers", () => {
    // This catches omitted or pending recognition text entering the source, and makes accepted OCR provenance inspectable.
    const candidate = (pageNumber: number, status: "pending" | "accepted" | "omitted", text: string) => ({
      id: `ocr-page-${pageNumber}`,
      source: { kind: "page" as const, pageNumber },
      text,
      reviewedText: text,
      confidence: 80,
      status,
      engine: "tesseract.js" as const,
      engineVersion: "7.0.0",
      languageCode: "eng",
      languageHash: "english-hash",
    });

    expect(composeExtractionWithOcr("Native", [
      candidate(3, "accepted", "Third"),
      candidate(1, "pending", "Pending"),
      candidate(2, "accepted", "Second"),
      candidate(4, "omitted", "Omitted"),
    ])).toBe("Native\n\n--- Reviewed OCR: Page 2 ---\n\nSecond\n\n--- Reviewed OCR: Page 3 ---\n\nThird");
  });

  it("creates a pending OCR candidate only for a selected textless page", async () => {
    // This catches OCR text being silently merged or selectable-text pages being processed in textless-only mode.
    const fixture = pdf();
    const recognized: number[] = [];
    const result = await extractPdfWithAdapter(
      new Uint8Array([1]),
      fixture.adapter,
      {
        ...cloneExtractionOptions(DEFAULT_EXTRACTION_OPTIONS),
        ocrMode: "textless-pages",
      },
      undefined,
      {
        recognize: async (_image, context) => {
          recognized.push(context.pageNumber);
          return {
            text: "Reviewed candidate text",
            confidence: 91.5,
            engineVersion: "7.0.0",
            languageHash: "english-hash",
          };
        },
      },
    );

    expect(recognized).toEqual([2]);
    expect(fixture.rendered).toEqual([2]);
    expect(result.ocrCandidates).toEqual([expect.objectContaining({
      id: "ocr-page-2",
      source: { kind: "page", pageNumber: 2 },
      text: "Reviewed candidate text",
      reviewedText: "Reviewed candidate text",
      confidence: 91.5,
      status: "pending",
      languageCode: "eng",
    })]);
    expect(result.text).not.toContain("Reviewed candidate text");
    expect(result.warnings.join(" ")).toMatch(/review.*ocr/i);
  });

  it("enforces the 150-page OCR cap without failing completed text extraction", async () => {
    // This catches an oversized PDF spawning unbounded OCR jobs or discarding completed safe work at the cap.
    const fixture = pdf(151);
    let calls = 0;
    const result = await extractPdfWithAdapter(
      new Uint8Array([1]),
      fixture.adapter,
      { ...cloneExtractionOptions(DEFAULT_EXTRACTION_OPTIONS), ocrMode: "all-pages" },
      undefined,
      {
        recognize: async () => {
          calls += 1;
          return { text: "candidate", confidence: 80, engineVersion: "7.0.0", languageHash: "english-hash" };
        },
      },
    );

    expect(calls).toBe(150);
    expect(result.ocrCandidates).toHaveLength(150);
    expect(result.warnings.join(" ")).toMatch(/150-page ocr limit/i);
  });
});
