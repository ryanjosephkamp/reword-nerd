import { describe, expect, it } from "vitest";

import { cloneExtractionOptions, DEFAULT_EXTRACTION_OPTIONS, extractPdfWithAdapter } from "../../src/domain";

const rasterBytes = new Uint8Array([137, 80, 78, 71, 1]);
const pageBytes = new Uint8Array([137, 80, 78, 71, 2]);

function adapter() {
  const rasterCalls: number[] = [];
  const renderCalls: Array<[number, number]> = [];
  return {
    rasterCalls,
    renderCalls,
    adapter: {
      load: () => ({
        promise: Promise.resolve({
          numPages: 2,
          getPage: async (pageNumber: number) => ({
            getTextContent: async () => ({ items: pageNumber === 1 ? [{ str: "Text" }] : [] }),
            extractRasterImages: async () => {
              rasterCalls.push(pageNumber);
              return [{
                bytes: rasterBytes,
                mimeType: "image/png",
                width: 320,
                height: 200,
                bounds: { x: 0.1, y: 0.2, width: 0.6, height: 0.4 },
              }];
            },
            renderToPng: async (scale: number) => {
              renderCalls.push([pageNumber, scale]);
              return { bytes: pageBytes, width: 1224, height: 1584 };
            },
          }),
        }),
      }),
    },
  };
}

describe("PDF visual processing", () => {
  it("runs opted-in raster and page-capture work only on selected pages", async () => {
    // This catches expensive visual processing ignoring the page selector or losing page/bounds provenance.
    const fixture = adapter();
    const result = await extractPdfWithAdapter(
      new Uint8Array([1]),
      fixture.adapter,
      {
        ...cloneExtractionOptions(DEFAULT_EXTRACTION_OPTIONS),
        extractEmbeddedImages: true,
        capturePageVisuals: true,
        pageSelection: "2",
        pageCaptureQuality: "high",
      },
    );

    expect(fixture.rasterCalls).toEqual([2]);
    expect(fixture.renderCalls).toEqual([[2, 3]]);
    expect(result.pageCount).toBe(2);
    expect(result.textlessPages).toEqual([2]);
    expect(result.assets).toHaveLength(2);
    expect(result.assets[0]).toMatchObject({
      kind: "pdf-raster",
      pageNumber: 2,
      width: 320,
      height: 200,
      bounds: { x: 0.1, y: 0.2, width: 0.6, height: 0.4 },
    });
    expect(result.assets[1]).toMatchObject({
      kind: "pdf-page-capture",
      pageNumber: 2,
      width: 1224,
      height: 1584,
    });
  });

  it("extracts embedded images by default while keeping page rendering off and retaining textless-page warnings", async () => {
    // This catches the v0.4 embedded-image default regressing or page capture becoming an implicit upload cost.
    const fixture = adapter();
    const result = await extractPdfWithAdapter(new Uint8Array([1]), fixture.adapter);

    expect(fixture.rasterCalls).toEqual([1, 2]);
    expect(fixture.renderCalls).toEqual([]);
    expect(result.assets).toHaveLength(2);
    expect(result.assets.every((asset) => asset.kind === "pdf-raster")).toBe(true);
    expect(result.warnings).toEqual(["Pages 2 do not contain selectable text."]);
  });
});
