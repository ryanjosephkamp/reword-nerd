import workerSource from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import type { PdfAdapter, PdfDocumentAdapter } from "./extraction";

interface PdfImageBuffer {
  width: number;
  height: number;
  data?: Uint8Array | Uint8ClampedArray;
  bitmap?: ImageBitmap;
}

export function rgbaBytesForPdfImage(image: { width: number; height: number; data: Uint8Array }): Uint8ClampedArray<ArrayBuffer> {
  const pixels = image.width * image.height;
  if (image.data.byteLength === pixels * 4) return new Uint8ClampedArray(image.data.slice().buffer);
  const output = new Uint8ClampedArray(pixels * 4);
  if (image.data.byteLength === pixels * 3) {
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      output[pixel * 4] = image.data[pixel * 3];
      output[pixel * 4 + 1] = image.data[pixel * 3 + 1];
      output[pixel * 4 + 2] = image.data[pixel * 3 + 2];
      output[pixel * 4 + 3] = 255;
    }
    return output;
  }
  if (image.data.byteLength === pixels) {
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      const value = image.data[pixel];
      output[pixel * 4] = value;
      output[pixel * 4 + 1] = value;
      output[pixel * 4 + 2] = value;
      output[pixel * 4 + 3] = 255;
    }
    return output;
  }
  throw new Error("Unsupported PDF image buffer.");
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function normalizedBoundsForTransform(
  matrix: number[],
  pageWidth: number,
  pageHeight: number,
): { x: number; y: number; width: number; height: number } {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = matrix;
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return {
    x: rounded(clamp(e / pageWidth)),
    y: rounded(clamp(f / pageHeight)),
    width: rounded(clamp(Math.hypot(a, b) / pageWidth)),
    height: rounded(clamp(Math.hypot(c, d) / pageHeight)),
  };
}

function multiplyMatrix(left: number[], right: number[]): number[] {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error("Canvas encoding failed.")),
    "image/png",
  ));
  return new Uint8Array(await blob.arrayBuffer());
}

async function imageBufferPng(image: PdfImageBuffer): Promise<Uint8Array> {
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Canvas is unavailable.");
  if (image.bitmap) {
    context.drawImage(image.bitmap, 0, 0, image.width, image.height);
  } else if (image.data) {
    const rgba = rgbaBytesForPdfImage({
      width: image.width,
      height: image.height,
      data: new Uint8Array(image.data),
    });
    context.putImageData(new ImageData(rgba, image.width, image.height), 0, 0);
  } else {
    throw new Error("Unsupported PDF image object.");
  }
  return canvasPng(canvas);
}

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
            const resolveObject = (name: string): Promise<PdfImageBuffer> => new Promise((resolve, reject) => {
              try {
                const existing = page.objs.get(name, (value: unknown) => resolve(value as PdfImageBuffer));
                if (existing) resolve(existing as PdfImageBuffer);
              } catch (error) {
                reject(error);
              }
            });
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
              extractRasterImages: async () => {
                const operatorList = await page.getOperatorList();
                const viewport = page.getViewport({ scale: 1 });
                const stack: number[][] = [];
                let transform = [1, 0, 0, 1, 0, 0];
                const images = [];
                for (let index = 0; index < operatorList.fnArray.length; index += 1) {
                  const operation = operatorList.fnArray[index];
                  const args = operatorList.argsArray[index] as unknown[];
                  if (operation === pdfjs.OPS.save) stack.push([...transform]);
                  else if (operation === pdfjs.OPS.restore) transform = stack.pop() ?? transform;
                  else if (operation === pdfjs.OPS.transform && args.length >= 6) {
                    transform = multiplyMatrix(transform, args.slice(0, 6).map(Number));
                  } else if (operation === pdfjs.OPS.paintImageXObject || operation === pdfjs.OPS.paintInlineImageXObject) {
                    try {
                      const image = operation === pdfjs.OPS.paintInlineImageXObject
                        ? args[0] as PdfImageBuffer
                        : await resolveObject(String(args[0]));
                      if (!image || image.width <= 0 || image.height <= 0) continue;
                      images.push({
                        bytes: await imageBufferPng(image),
                        mimeType: "image/png",
                        width: image.width,
                        height: image.height,
                        bounds: normalizedBoundsForTransform(transform, viewport.width, viewport.height),
                      });
                    } catch {
                      // Unsupported masks or parser-internal image formats are skipped best-effort.
                    }
                  }
                }
                return images;
              },
              renderToPng: async (scale) => {
                const viewport = page.getViewport({ scale });
                const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
                const canvasContext = canvas.getContext("2d", { alpha: false });
                if (!canvasContext) throw new Error("Canvas is unavailable.");
                await page.render({ canvas, canvasContext, viewport }).promise;
                return { bytes: await canvasPng(canvas), width: canvas.width, height: canvas.height };
              },
              cleanup: () => { page.cleanup(); },
            };
          },
          destroy: () => document.destroy(),
        })),
        destroy: () => loadingTask.destroy(),
      };
    },
  };
}
