import workerSource from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import type { PdfAdapter, PdfDocumentAdapter } from "./extraction";

function passwordError(): Error {
  return Object.assign(new Error("Password-protected PDF"), { name: "PasswordException" });
}

export async function loadBrowserPdfAdapter(): Promise<PdfAdapter> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerSource;

  return {
    load: (sourceBytes) => {
      const loadingTask = pdfjs.getDocument({
        data: sourceBytes.slice(),
        stopAtErrors: true,
        isEvalSupported: false,
        disableFontFace: true,
      });
      let rejectPasswordRequest: (reason?: unknown) => void = () => undefined;
      const passwordRequested = new Promise<never>((_resolve, reject) => {
        rejectPasswordRequest = reject;
      });
      loadingTask.onPassword = () => rejectPasswordRequest(passwordError());

      return {
        promise: Promise.race([loadingTask.promise, passwordRequested]).then((document): PdfDocumentAdapter => ({
          numPages: document.numPages,
          getPage: async (pageNumber) => {
            const page = await document.getPage(pageNumber);
            return {
              getTextContent: async () => {
                const content = await page.getTextContent();
                return {
                  items: content.items.flatMap((item) => (
                    "str" in item && typeof item.str === "string"
                      ? [{ str: item.str, hasEOL: item.hasEOL }]
                      : []
                  )),
                };
              },
            };
          },
          destroy: () => document.destroy(),
        })),
        destroy: () => loadingTask.destroy(),
      };
    },
  };
}
