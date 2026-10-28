// One place that loads pdf.js, so the worker is configured once for text and images alike.
import type { PDFDocumentProxy } from "pdfjs-dist";

export class PdfPasswordError extends Error {
  constructor() {
    super("This PDF is password-protected. Remove the password and add it again.");
    this.name = "PdfPasswordError";
  }
}

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | undefined;

function loadPdfjs() {
  pdfjsPromise ??= Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return pdfjsPromise;
}

/** Opens a PDF without running its scripts or loading its fonts into the page. */
export async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  const support = `${import.meta.env.BASE_URL}pdfjs/`;
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
    disableFontFace: true,
    stopAtErrors: false,
    cMapUrl: `${support}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${support}standard_fonts/`,
    wasmUrl: `${support}wasm/`,
  });
  const passwordRequested = new Promise<never>((_resolve, reject) => {
    task.onPassword = () => reject(new PdfPasswordError());
  });
  try {
    return await Promise.race([task.promise, passwordRequested]);
  } catch (error) {
    await task.destroy();
    throw error;
  }
}

/** Renders one page to a PNG at the given scale (1 = 72 dpi). */
export async function renderPdfPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
): Promise<Blob> {
  const page = await pdf.getPage(pageNumber);
  try {
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser can't draw PDF pages.");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't save the page image."))),
        "image/png",
      ),
    );
  } finally {
    page.cleanup();
  }
}
