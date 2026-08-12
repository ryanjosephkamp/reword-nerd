import { describe, expect, it } from "vitest";

import * as browserPdf from "../../src/domain/pdfBrowser";

describe("browser PDF image normalization", () => {
  it("converts RGB and grayscale parser buffers to opaque RGBA bytes", () => {
    // This catches scientific rasters being encoded with shifted channels or missing alpha bytes.
    const convert = (browserPdf as unknown as {
      rgbaBytesForPdfImage?: (image: { width: number; height: number; data: Uint8Array }) => Uint8ClampedArray;
    }).rgbaBytesForPdfImage;

    expect(Array.from(convert?.({ width: 2, height: 1, data: new Uint8Array([255, 0, 0, 0, 255, 0]) }) ?? [])).toEqual([
      255, 0, 0, 255, 0, 255, 0, 255,
    ]);
    expect(Array.from(convert?.({ width: 1, height: 1, data: new Uint8Array([80]) }) ?? [])).toEqual([
      80, 80, 80, 255,
    ]);
  });

  it("normalizes a PDF transform into bounded page-relative placement metadata", () => {
    // This catches negative or oversized placement values making the asset map unusable for figure reconstruction.
    const bounds = (browserPdf as unknown as {
      normalizedBoundsForTransform?: (matrix: number[], pageWidth: number, pageHeight: number) => unknown;
    }).normalizedBoundsForTransform;

    expect(bounds?.([100, 0, 0, 50, 10, 20], 200, 100)).toEqual({
      x: 0.05,
      y: 0.2,
      width: 0.5,
      height: 0.5,
    });
  });
});
