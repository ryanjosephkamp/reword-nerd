import workerSource from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import type { ImageContainerProvenanceNode, ImageProvenance } from "./contracts";
import {
  MAX_IMAGE_INPUT_BYTES,
  MAX_IMAGE_PDF_PAGES,
  MAX_IMAGE_PIXELS,
  ImageIntakeFailure,
  failImageIntake,
  imageIntakeIssue,
  type ExtractedImageCandidate,
  type ExtractedImageCandidateValidator,
  type ImageIntakeIssue,
} from "./intakeContracts";
import {
  prepareImageInput,
  validateImageDimensions,
  validatePreparedImage,
  type ImageDecodeAdapter,
} from "./imageValidation";

export interface ImagePdfRaster {
  readonly width: number;
  readonly height: number;
  readPng(signal?: AbortSignal): Promise<Uint8Array>;
  close(): void;
}

export interface ImagePdfCapture {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface ImagePdfPage {
  enumerateEmbeddedRasters(signal?: AbortSignal): Promise<readonly ImagePdfRaster[]>;
  renderCapturePng(scale: 2 | 3, signal?: AbortSignal): Promise<ImagePdfCapture>;
  cleanup(): void;
}

export interface ImagePdfDocument {
  readonly numPages: number;
  getPage(pageNumber: number, signal?: AbortSignal): Promise<ImagePdfPage>;
  destroy(): Promise<void> | void;
}

export interface ImagePdfLoadingTask {
  readonly promise: Promise<ImagePdfDocument>;
  destroy(): Promise<void> | void;
}

export interface ImagePdfAdapter {
  load(source: Uint8Array, options: { readonly maxImageSize: number }): ImagePdfLoadingTask;
}

export interface ExtractPdfOptions {
  readonly containerName: string;
  readonly containerHash: string;
  readonly containerPath?: string | null;
  readonly parentContainerChain?: readonly ImageContainerProvenanceNode[];
  readonly adapter?: ImagePdfAdapter;
  readonly decoder: ImageDecodeAdapter;
  readonly hash?: (source: Blob) => Promise<string>;
  readonly capturePages?: readonly number[];
  readonly captureQuality?: "standard" | "high";
  readonly resolveCapture?: (
    context: ImagePdfCaptureContext,
  ) => ImagePdfCaptureChoice | Promise<ImagePdfCaptureChoice>;
  readonly validateCandidate?: ExtractedImageCandidateValidator;
  readonly signal?: AbortSignal;
}

export type ImagePdfCaptureChoice =
  | { readonly mode: "embedded-only" }
  | {
    readonly mode: "embedded-and-pages";
    readonly pages: readonly number[];
    readonly quality: "standard" | "high";
  };

export interface ImagePdfCaptureContext {
  readonly containerName: string;
  readonly containerPath: string | null;
  readonly pageCount: number;
  readonly signal: AbortSignal;
}

export interface PdfImageResult {
  readonly images: readonly ExtractedImageCandidate[];
  readonly issues: readonly ImageIntakeIssue[];
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("PDF intake cancelled.", "AbortError");
}

function waitForPdfOperation<T>(
  operation: PromiseLike<T>,
  signal?: AbortSignal,
  cancel?: () => void,
): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return Promise.resolve(operation);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (complete: (value: T) => void, value: T) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      complete(value);
    };
    const fail = (reason: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      reject(reason);
    };
    const abort = () => {
      if (settled) return;
      try { cancel?.(); } catch { /* cancellation remains authoritative */ }
      fail(new DOMException("PDF intake cancelled.", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    Promise.resolve(operation).then(
      (value) => finish(resolve, value),
      fail,
    );
  });
}

function pdfIssueFor(error: unknown): "PDF_PASSWORD_PROTECTED" | "MALFORMED_PDF" {
  const name = typeof error === "object" && error !== null && "name" in error
    ? String((error as { name: unknown }).name)
    : "";
  return name === "PasswordException" ? "PDF_PASSWORD_PROTECTED" : "MALFORMED_PDF";
}

function normalizeCaptureChoice(
  choice: ImagePdfCaptureChoice,
  pageCount: number,
): { readonly pages: readonly number[]; readonly quality: "standard" | "high" } {
  if (choice.mode === "embedded-only") return { pages: Object.freeze([]), quality: "standard" };
  if (choice.mode !== "embedded-and-pages"
    || !Array.isArray(choice.pages)
    || (choice.quality !== "standard" && choice.quality !== "high")
    || choice.pages.some((page) => !Number.isSafeInteger(page) || page < 1 || page > pageCount)) {
    failImageIntake("PDF_CAPTURE_SELECTION_INVALID");
  }
  return Object.freeze({
    pages: Object.freeze(Array.from(new Set(choice.pages)).sort((left, right) => left - right)),
    quality: choice.quality,
  });
}

function pdfContainerChain(options: ExtractPdfOptions, byteCount: number): readonly ImageContainerProvenanceNode[] {
  return Object.freeze([
    ...(options.parentContainerChain ?? []).map((node) => Object.freeze({ ...node })),
    Object.freeze({
      kind: "pdf" as const,
      name: options.containerName,
      sha256: options.containerHash,
      path: options.containerPath ?? null,
      byteCount,
    }),
  ]);
}

function pdfProvenance(
  sourceName: string,
  pageNumber: number,
  containerChain: readonly ImageContainerProvenanceNode[],
): ImageProvenance {
  const innermost = containerChain.at(-1)!;
  return Object.freeze({
    intakeKind: "pdf-extracted",
    sourceName,
    sourcePath: null,
    containerChain,
    containerName: innermost.name,
    containerHash: innermost.sha256,
    containerPath: innermost.path,
    pageNumber,
    relationshipId: null,
  });
}

async function candidateFromPng(
  bytes: Uint8Array,
  sourceName: string,
  pageNumber: number,
  dimensions: { width: number; height: number },
  containerChain: readonly ImageContainerProvenanceNode[],
  options: ExtractPdfOptions,
): Promise<ExtractedImageCandidate> {
  validateImageDimensions(dimensions.width, dimensions.height);
  const prepared = await prepareImageInput({
    name: sourceName,
    type: "image/png",
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.slice().buffer,
  });
  const imageProvenance = pdfProvenance(sourceName, pageNumber, containerChain);
  const validated = options.validateCandidate
    ? await options.validateCandidate(prepared, imageProvenance)
    : Object.freeze({
      ...await validatePreparedImage(prepared, {
        decoder: options.decoder,
        hash: options.hash,
        signal: options.signal,
      }),
      provenance: imageProvenance,
    });
  const warnings = dimensions.width < 64 || dimensions.height < 64
    ? [...validated.warnings, "This small PDF visual may be decorative; review its inclusion."]
    : validated.warnings;
  return Object.freeze({
    ...validated,
    warnings: Object.freeze(warnings),
    provenance: validated.provenance,
  });
}

export async function extractPdfImages(source: Blob, options: ExtractPdfOptions): Promise<PdfImageResult> {
  if (!Number.isSafeInteger(source.size) || source.size < 1 || source.size > MAX_IMAGE_INPUT_BYTES) {
    failImageIntake("INPUT_SIZE_INVALID");
  }
  let sourceBytes: Uint8Array;
  try {
    sourceBytes = new Uint8Array(await waitForPdfOperation(source.arrayBuffer(), options.signal));
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    failImageIntake("READ_FAILED");
  }
  if (sourceBytes.byteLength !== source.size
    || sourceBytes.byteLength < 5
    || new TextDecoder().decode(sourceBytes.subarray(0, 5)) !== "%PDF-") {
    failImageIntake("SIGNATURE_MISMATCH");
  }
  throwIfAborted(options.signal);
  const pdfAdapter = options.adapter ?? await loadBrowserImagePdfAdapter();
  const loadingTask = pdfAdapter.load(sourceBytes, { maxImageSize: MAX_IMAGE_PIXELS });
  let document: ImagePdfDocument | null = null;
  const pages: Array<{ pageNumber: number; page: ImagePdfPage; rasters: readonly ImagePdfRaster[] }> = [];
  try {
    try {
      document = await waitForPdfOperation(loadingTask.promise, options.signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      failImageIntake(pdfIssueFor(error));
    }
    throwIfAborted(options.signal);
    if (!Number.isSafeInteger(document.numPages)
      || document.numPages < 1) failImageIntake("MALFORMED_PDF");
    if (document.numPages > MAX_IMAGE_PDF_PAGES) failImageIntake("PDF_PAGE_LIMIT_EXCEEDED");

    let capture = normalizeCaptureChoice(
      options.capturePages && options.capturePages.length > 0
        ? {
          mode: "embedded-and-pages",
          pages: options.capturePages,
          quality: options.captureQuality ?? "standard",
        }
        : { mode: "embedded-only" },
      document.numPages,
    );
    if (options.resolveCapture) {
      try {
        const signal = options.signal ?? new AbortController().signal;
        const choice = await waitForPdfOperation(Promise.resolve(options.resolveCapture({
          containerName: options.containerName,
          containerPath: options.containerPath ?? null,
          pageCount: document.numPages,
          signal,
        })), options.signal);
        throwIfAborted(options.signal);
        capture = normalizeCaptureChoice(choice, document.numPages);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        if (error instanceof ImageIntakeFailure) throw error;
        failImageIntake("PDF_CAPTURE_SELECTION_INVALID");
      }
    }

    try {
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        throwIfAborted(options.signal);
        const page = await waitForPdfOperation(
          document.getPage(pageNumber, options.signal),
          options.signal,
        );
        const acquired = { pageNumber, page, rasters: [] as readonly ImagePdfRaster[] };
        pages.push(acquired);
        acquired.rasters = await waitForPdfOperation(
          page.enumerateEmbeddedRasters(options.signal),
          options.signal,
        );
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      failImageIntake("MALFORMED_PDF");
    }

    const chain = pdfContainerChain(options, source.size);
    const images: ExtractedImageCandidate[] = [];
    const issues: ImageIntakeIssue[] = [];
    let visualCandidateCount = 0;
    for (const { pageNumber, rasters } of pages) {
      for (let index = 0; index < rasters.length; index += 1) {
        const raster = rasters[index];
        visualCandidateCount += 1;
        try {
          validateImageDimensions(raster.width, raster.height);
          throwIfAborted(options.signal);
          const bytes = await waitForPdfOperation(raster.readPng(options.signal), options.signal);
          throwIfAborted(options.signal);
          images.push(await candidateFromPng(
            bytes,
            `pdf-page-${String(pageNumber).padStart(3, "0")}-raster-${String(index + 1).padStart(3, "0")}.png`,
            pageNumber,
            raster,
            chain,
            options,
          ));
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") throw error;
          issues.push(error instanceof ImageIntakeFailure ? error.issue : imageIntakeIssue("DECODE_FAILED"));
        }
      }
    }

    const captures = new Set(capture.pages);
    const captureScale: 2 | 3 = capture.quality === "high" ? 3 : 2;
    for (const { pageNumber, page } of pages) {
      if (!captures.has(pageNumber)) continue;
      visualCandidateCount += 1;
      try {
        const capture = await waitForPdfOperation(
          page.renderCapturePng(captureScale, options.signal),
          options.signal,
        );
        throwIfAborted(options.signal);
        images.push(await candidateFromPng(
          capture.bytes,
          `pdf-page-${String(pageNumber).padStart(3, "0")}-capture.png`,
          pageNumber,
          capture,
          chain,
          options,
        ));
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        issues.push(error instanceof ImageIntakeFailure ? error.issue : imageIntakeIssue("DECODE_FAILED"));
      }
    }
    if (visualCandidateCount === 0) failImageIntake("PDF_NO_SUPPORTED_IMAGES");
    return Object.freeze({ images: Object.freeze(images), issues: Object.freeze(issues) });
  } finally {
    const closedRasters = new Set<ImagePdfRaster>();
    for (const { rasters } of pages) {
      for (const raster of rasters) {
        if (closedRasters.has(raster)) continue;
        closedRasters.add(raster);
        try { raster.close(); } catch { /* one cleanup owner; never replace the intake status */ }
      }
    }
    for (const { page } of pages) {
      try { page.cleanup(); } catch { /* one cleanup owner, no error replacement */ }
    }
    if (document) await Promise.resolve(document.destroy()).catch(() => undefined);
    await Promise.resolve(loadingTask.destroy()).catch(() => undefined);
  }
}

interface PdfJsImageObject {
  readonly width: number;
  readonly height: number;
  readonly data?: Uint8Array | Uint8ClampedArray;
  readonly bitmap?: ImageBitmap;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  validateImageDimensions(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error("Canvas encode failed.")),
    "image/png",
  ));
  return new Uint8Array(await blob.arrayBuffer());
}

function rgbaForPdfImage(image: PdfJsImageObject): Uint8ClampedArray {
  validateImageDimensions(image.width, image.height);
  const pixels = image.width * image.height;
  const data = image.data;
  if (!data || ![pixels, pixels * 3, pixels * 4].includes(data.byteLength)) {
    throw new Error("Unsupported PDF raster buffer.");
  }
  if (data.byteLength === pixels * 4) return new Uint8ClampedArray(Uint8Array.from(data).buffer);
  const rgba = new Uint8ClampedArray(pixels * 4);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const input = data.byteLength === pixels ? pixel : pixel * 3;
    const output = pixel * 4;
    rgba[output] = data[input];
    rgba[output + 1] = data.byteLength === pixels ? data[input] : data[input + 1];
    rgba[output + 2] = data.byteLength === pixels ? data[input] : data[input + 2];
    rgba[output + 3] = 255;
  }
  return rgba;
}

async function imageObjectPng(image: PdfJsImageObject): Promise<Uint8Array> {
  validateImageDimensions(image.width, image.height);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Canvas unavailable.");
  if (image.bitmap) context.drawImage(image.bitmap, 0, 0, image.width, image.height);
  else {
    const source = rgbaForPdfImage(image);
    const owned = new Uint8ClampedArray(source.byteLength);
    owned.set(source);
    context.putImageData(new ImageData(owned, image.width, image.height), 0, 0);
  }
  return canvasPng(canvas);
}

function passwordError(): Error {
  return Object.assign(new Error("Password-protected PDF"), { name: "PasswordException" });
}

export async function loadBrowserImagePdfAdapter(): Promise<ImagePdfAdapter> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerSource;
  return {
    load(source, options) {
      const loadingTask = pdfjs.getDocument({
        data: source.slice(),
        maxImageSize: options.maxImageSize,
        stopAtErrors: true,
        isEvalSupported: false,
        disableFontFace: true,
        enableXfa: false,
      });
      let rejectPassword!: (reason: unknown) => void;
      const password = new Promise<never>((_resolve, reject) => { rejectPassword = reject; });
      loadingTask.onPassword = () => rejectPassword(passwordError());
      return {
        promise: Promise.race([loadingTask.promise, password]).then((pdf): ImagePdfDocument => ({
          numPages: pdf.numPages,
          async getPage(pageNumber, signal) {
            const page = await waitForPdfOperation(pdf.getPage(pageNumber), signal);
            return {
              async enumerateEmbeddedRasters(signal) {
                const operatorList = await waitForPdfOperation(page.getOperatorList(), signal);
                const rasters: ImagePdfRaster[] = [];
                for (let index = 0; index < operatorList.fnArray.length; index += 1) {
                  throwIfAborted(signal);
                  const operation = operatorList.fnArray[index];
                  if (operation !== pdfjs.OPS.paintImageXObject
                    && operation !== pdfjs.OPS.paintInlineImageXObject) continue;
                  const args = operatorList.argsArray[index] as unknown[];
                  let object: PdfJsImageObject | null;
                  try {
                    object = operation === pdfjs.OPS.paintInlineImageXObject
                      ? args[0] as PdfJsImageObject
                      : await waitForPdfOperation(new Promise<PdfJsImageObject>((resolve, reject) => {
                          try {
                            const current = page.objs.get(String(args[0]), (value: unknown) => resolve(value as PdfJsImageObject));
                            if (current) resolve(current as PdfJsImageObject);
                          } catch (error) { reject(error); }
                        }), signal);
                  } catch (error) {
                    if (error instanceof DOMException && error.name === "AbortError") throw error;
                    object = null;
                  }
                  const raster = object;
                  rasters.push({
                    width: raster?.width ?? 0,
                    height: raster?.height ?? 0,
                    readPng: async (signal) => {
                      if (!raster) throw new Error("Unsupported PDF raster object.");
                      return waitForPdfOperation(imageObjectPng(raster), signal);
                    },
                    close: () => raster?.bitmap?.close(),
                  });
                }
                return rasters;
              },
              async renderCapturePng(scale, signal) {
                throwIfAborted(signal);
                const viewport = page.getViewport({ scale });
                const width = Math.ceil(viewport.width);
                const height = Math.ceil(viewport.height);
                validateImageDimensions(width, height);
                const canvas = createCanvas(width, height);
                const canvasContext = canvas.getContext("2d", { alpha: false });
                if (!canvasContext) throw new Error("Canvas unavailable.");
                const renderTask = page.render({ canvas, canvasContext, viewport });
                await waitForPdfOperation(renderTask.promise, signal, () => renderTask.cancel());
                const bytes = await waitForPdfOperation(canvasPng(canvas), signal);
                return { bytes, width, height };
              },
              cleanup: () => page.cleanup(),
            };
          },
          destroy: () => pdf.destroy(),
        })),
        destroy: () => loadingTask.destroy(),
      };
    },
  };
}
