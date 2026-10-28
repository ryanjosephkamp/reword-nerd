const openPdf = vi.fn(async () => ({
  numPages: 1,
  getPage: vi.fn(),
  destroy: vi.fn(async () => undefined),
}));

vi.mock("../../../src/engine/pdf", () => ({
  openPdf,
  renderPdfPage: vi.fn(),
  PdfPasswordError: class extends Error {},
}));

describe("openPdfFile", () => {
  it("hands the bytes to pdf.js instead of making another copy", async () => {
    // Catches a per-PDF bytes.slice() doubling the memory a large PDF takes.
    const { openPdfFile } = await import("../../../src/engine/images/pdfImages");
    const bytes = new Uint8Array(8);
    await openPdfFile(bytes);
    expect(openPdf).toHaveBeenCalledWith(bytes, { transfer: true });
  });
});
