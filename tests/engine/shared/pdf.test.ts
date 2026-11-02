import type { PDFDocumentProxy } from "pdfjs-dist";

import { renderPdfPage } from "../../../src/engine/pdf";

describe("renderPdfPage", () => {
  it("releases the canvas and the page even when drawing fails", async () => {
    // Catches page-sized canvases staying allocated (Safari keeps them until collection).
    const cleanup = vi.fn();
    const pdf = {
      getPage: async () => ({
        getViewport: () => ({ width: 1_000, height: 2_000 }),
        render: () => ({ promise: Promise.resolve() }),
        cleanup,
      }),
    } as unknown as PDFDocumentProxy;
    const canvases: HTMLCanvasElement[] = [];
    const create = document.createElement.bind(document);
    const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = create(tag);
      if (element instanceof HTMLCanvasElement) {
        element.getContext = (() => null) as typeof element.getContext;
        canvases.push(element);
      }
      return element;
    });
    try {
      await expect(renderPdfPage(pdf, 1, 2)).rejects.toThrow("This browser can't draw PDF pages.");
    } finally {
      spy.mockRestore();
    }
    expect(canvases).toHaveLength(1);
    expect([canvases[0].width, canvases[0].height]).toEqual([0, 0]);
    expect(cleanup).toHaveBeenCalled();
  });
});
