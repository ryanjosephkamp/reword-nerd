// Takes pictures out of a PDF with unmodified pdf.js: the pictures embedded in each page
// (read from the page's drawing instructions), a capture of each whole page, or both.
import { PdfPasswordError, openPdf, renderPdfPage } from "../pdf";
import { ImageReadError, rethrowIfAborted } from "./errors";
import { LeftOut, WHY } from "./leftOut";
import { IMAGE_LIMITS } from "./limits";
import { checkDimensions } from "./validate";

/**
 * pdf.js operator codes for painting images (its `OPS` table). They have been stable for
 * years, and hard-coding them avoids loading pdf.js just to read three numbers.
 */
export const PAINT_OPS = {
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintImageXObjectRepeat: 88,
} as const;

/** pdf.js pixel layouts for decoded images (its `ImageKind` table). */
export const PIXEL_KIND = { grayscale1Bit: 1, rgb: 2, rgba: 3 } as const;

/** A decoded image as pdf.js hands it over: a bitmap in browsers, raw pixels elsewhere. */
export interface PdfImageData {
  width: number;
  height: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray | null;
  bitmap?: ImageBitmap | null;
}

export interface PdfObjectStore {
  get(id: string, callback: (data: unknown) => void): unknown;
}

/** The parts of a pdf.js page this module uses, so tests can supply a stand-in. */
export interface PdfPage {
  getOperatorList(): Promise<{ fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> }>;
  objs: PdfObjectStore;
  commonObjs: PdfObjectStore;
  getViewport(params: { scale: number }): { width: number; height: number };
  cleanup(): unknown;
}

export interface PdfFile {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  /** Draws one page to a PNG at the given scale (1 = 72 dpi). */
  renderPage(pageNumber: number, scale: number): Promise<Blob>;
  destroy(): Promise<void>;
}

export type PdfOpener = (bytes: Uint8Array<ArrayBuffer>) => Promise<PdfFile>;
export type PdfImageEncoder = (image: PdfImageData) => Promise<Blob>;
export type PdfMode = "embedded-images" | "page-captures" | "both";

export interface PdfPicture {
  name: string;
  pageNumber: number;
  image: Blob;
  width: number;
  height: number;
  /** True for a capture of a whole page. */
  capture: boolean;
}

export interface ReadPdfOptions {
  mode: PdfMode;
  open: PdfOpener;
  encode: PdfImageEncoder;
  /** Receives each picture; resolves false when no more can be taken. */
  onPicture: (picture: PdfPicture) => Promise<boolean>;
  onPage?: (pageNumber: number, pageCount: number) => void;
  signal?: AbortSignal;
}

export interface PdfSummary {
  pageCount: number;
  /** Pictures handed to onPicture, including repeats of the same picture. */
  found: number;
  leftOut: LeftOut;
  /** The page being read when onPicture asked to stop, if it did. */
  stoppedAtPage: number | null;
}

const OBJECT_TIMEOUT_MS = 15_000;

export async function readPdfPictures(
  bytes: Uint8Array<ArrayBuffer>,
  options: ReadPdfOptions,
): Promise<PdfSummary> {
  const { signal } = options;
  let pdf: PdfFile;
  try {
    pdf = await options.open(bytes);
  } catch (error) {
    rethrowIfAborted(error, signal);
    if (error instanceof PdfPasswordError) throw new ImageReadError(error.message);
    throw new ImageReadError("This PDF couldn't be opened. It may be damaged.");
  }
  try {
    const pageCount = pdf.numPages;
    if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
      throw new ImageReadError("This PDF has no pages.");
    }
    const summary: PdfSummary = {
      pageCount,
      found: 0,
      leftOut: new LeftOut(),
      stoppedAtPage: null,
    };
    const lastPage = Math.min(pageCount, IMAGE_LIMITS.maxPdfPages);
    const known = new Map<string, KnownPicture | null>();
    for (let pageNumber = 1; pageNumber <= lastPage; pageNumber += 1) {
      signal?.throwIfAborted();
      options.onPage?.(pageNumber, lastPage);
      const pictures: PdfPicture[] = [];
      if (options.mode !== "embedded-images") {
        const capture = await capturePage(pdf, pageNumber, summary.leftOut, signal);
        if (capture) pictures.push(capture);
      }
      if (options.mode !== "page-captures") {
        pictures.push(
          ...(await embeddedPictures(
            pdf,
            pageNumber,
            known,
            options.encode,
            summary.leftOut,
            signal,
          )),
        );
      }
      for (const picture of pictures) {
        summary.found += 1;
        if (!(await options.onPicture(picture))) {
          summary.stoppedAtPage = pageNumber;
          return summary;
        }
      }
    }
    return summary;
  } finally {
    await pdf.destroy().catch(() => undefined);
  }
}

/** A scale near 150 dpi, reduced when needed so the capture stays within the pixel limits. */
export function captureScale(width: number, height: number): number {
  if (!(width > 0 && height > 0)) throw new Error("The page has no size.");
  const { maxImageSide, maxImagePixels, pdfCaptureDpi } = IMAGE_LIMITS;
  // The tiny reduction stops float error from rounding an exact size up a pixel
  // (a letter page at 150 dpi should be 1275 × 1650, not 1275 × 1651).
  let scale =
    Math.min(
      pdfCaptureDpi / 72,
      maxImageSide / width,
      maxImageSide / height,
      Math.sqrt(maxImagePixels / (width * height)),
    ) *
    (1 - 1e-9);
  // Canvas sizes round up, so step down until the rounded size also fits.
  const fits = () => {
    const pixelsWide = Math.ceil(width * scale);
    const pixelsHigh = Math.ceil(height * scale);
    return (
      pixelsWide <= maxImageSide &&
      pixelsHigh <= maxImageSide &&
      pixelsWide * pixelsHigh <= maxImagePixels
    );
  };
  while (!fits()) scale *= 0.999;
  return scale;
}

async function capturePage(
  pdf: PdfFile,
  pageNumber: number,
  leftOut: LeftOut,
  signal?: AbortSignal,
): Promise<PdfPicture | null> {
  try {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const scale = captureScale(viewport.width, viewport.height);
    const image = await pdf.renderPage(pageNumber, scale);
    signal?.throwIfAborted();
    if (image.size > IMAGE_LIMITS.maxImageBytes) {
      leftOut.add("page capture", WHY.tooLarge);
      return null;
    }
    return {
      name: `page-${pageNumber}.png`,
      pageNumber,
      image,
      width: Math.ceil(viewport.width * scale),
      height: Math.ceil(viewport.height * scale),
      capture: true,
    };
  } catch (error) {
    rethrowIfAborted(error, signal);
    leftOut.add("page capture", WHY.notDrawn);
    return null;
  }
}

interface KnownPicture {
  image: Blob;
  width: number;
  height: number;
}

/**
 * Converts each picture a page paints. A picture used again (on this page or a later one)
 * is reported again without converting it twice, so repeats can be counted.
 */
async function embeddedPictures(
  pdf: PdfFile,
  pageNumber: number,
  known: Map<string, KnownPicture | null>,
  encode: PdfImageEncoder,
  leftOut: LeftOut,
  signal?: AbortSignal,
): Promise<PdfPicture[]> {
  const pictures: PdfPicture[] = [];
  const add = (picture: KnownPicture) =>
    pictures.push({
      ...picture,
      name: `page-${pageNumber}-image-${pictures.length + 1}.png`,
      pageNumber,
      capture: false,
    });
  let page: PdfPage;
  try {
    page = await pdf.getPage(pageNumber);
  } catch (error) {
    rethrowIfAborted(error, signal);
    leftOut.add("picture", WHY.unreadable);
    return pictures;
  }
  try {
    const painted = await listPaintedImages(page);
    for (const item of painted) {
      signal?.throwIfAborted();
      if (item.id !== null && known.has(item.id)) {
        const repeat = known.get(item.id);
        if (repeat) add(repeat);
        continue;
      }
      const picture = await convertPicture(await item.load(signal), encode, leftOut, signal);
      if (item.id !== null) known.set(item.id, picture);
      if (picture) add(picture);
    }
  } catch (error) {
    rethrowIfAborted(error, signal);
    leftOut.add("picture", WHY.unreadable);
  } finally {
    // Frees the decoded pictures before the next page (or this page's capture) loads more.
    page.cleanup();
  }
  return pictures;
}

async function convertPicture(
  data: PdfImageData | null,
  encode: PdfImageEncoder,
  leftOut: LeftOut,
  signal?: AbortSignal,
): Promise<KnownPicture | null> {
  if (!data) {
    leftOut.add("picture", WHY.unreadable);
    return null;
  }
  const { width, height } = data;
  const minimum = IMAGE_LIMITS.minPdfPictureSide;
  if (width < minimum || height < minimum) {
    leftOut.add("picture", WHY.tooSmall);
    return null;
  }
  try {
    checkDimensions(data);
  } catch {
    leftOut.add("picture", WHY.tooLarge);
    return null;
  }
  let image: Blob;
  try {
    image = await encode(data);
  } catch (error) {
    rethrowIfAborted(error, signal);
    leftOut.add("picture", WHY.unreadable);
    return null;
  }
  if (image.size > IMAGE_LIMITS.maxImageBytes) {
    leftOut.add("picture", WHY.tooLarge);
    return null;
  }
  return { image, width, height };
}

export interface PaintedImage {
  /** pdf.js object id, or null for an image stored inline in the page. */
  id: string | null;
  load(signal?: AbortSignal): Promise<PdfImageData | null>;
}

/** Lists the images a page paints, in drawing order. */
export async function listPaintedImages(
  page: PdfPage,
  timeoutMs = OBJECT_TIMEOUT_MS,
): Promise<PaintedImage[]> {
  const { fnArray, argsArray } = await page.getOperatorList();
  const painted: PaintedImage[] = [];
  for (let index = 0; index < fnArray.length; index += 1) {
    const operation = fnArray[index];
    const args = argsArray[index];
    const first: unknown = Array.isArray(args) ? args[0] : undefined;
    if (operation === PAINT_OPS.paintInlineImageXObject) {
      painted.push({ id: null, load: async () => asImageData(first) });
    } else if (
      (operation === PAINT_OPS.paintImageXObject ||
        operation === PAINT_OPS.paintImageXObjectRepeat) &&
      typeof first === "string"
    ) {
      // Images shared by several pages live in the document's store; pdf.js marks their ids.
      const store = first.startsWith("g_") ? page.commonObjs : page.objs;
      painted.push({
        id: first,
        load: async (signal) => asImageData(await waitForObject(store, first, timeoutMs, signal)),
      });
    }
  }
  return painted;
}

/**
 * pdf.js decodes images in its worker and delivers them after the drawing instructions,
 * so wait for each one. A failed decode arrives as null; the timeout covers one that never
 * arrives.
 */
function waitForObject(
  store: PdfObjectStore,
  id: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const settle = (value: unknown) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => settle(null), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      store.get(id, settle);
    } catch {
      settle(null);
    }
  });
}

function asImageData(value: unknown): PdfImageData | null {
  if (typeof value !== "object" || value === null) return null;
  const { width, height, data, bitmap } = value as Record<string, unknown>;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return null;
  if (!bitmap && !ArrayBuffer.isView(data)) return null;
  return value as PdfImageData;
}

/** Expands pdf.js raw pixels (1-bit gray, RGB, or RGBA) to RGBA for a canvas. */
export function toRgba(image: PdfImageData): Uint8ClampedArray<ArrayBuffer> {
  const { width, height, data } = image;
  if (!data) throw new Error("The picture has no pixel data.");
  const pixels = width * height;
  const rgba = new Uint8ClampedArray(pixels * 4);
  const kind =
    image.kind ??
    (data.length === pixels * 4
      ? PIXEL_KIND.rgba
      : data.length === pixels * 3
        ? PIXEL_KIND.rgb
        : undefined);
  if (kind === PIXEL_KIND.rgba && data.length >= pixels * 4) {
    rgba.set(data.subarray(0, pixels * 4));
    return rgba;
  }
  if (kind === PIXEL_KIND.rgb && data.length >= pixels * 3) {
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      rgba[pixel * 4] = data[pixel * 3];
      rgba[pixel * 4 + 1] = data[pixel * 3 + 1];
      rgba[pixel * 4 + 2] = data[pixel * 3 + 2];
      rgba[pixel * 4 + 3] = 255;
    }
    return rgba;
  }
  const rowBytes = (width + 7) >> 3;
  if (kind === PIXEL_KIND.grayscale1Bit && data.length >= rowBytes * height) {
    // Each row starts on a new byte; a set bit is white.
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const offset = (y * width + x) * 4;
        rgba.fill(bit ? 255 : 0, offset, offset + 3);
        rgba[offset + 3] = 255;
      }
    }
    return rgba;
  }
  throw new Error("The picture's pixel layout isn't recognized.");
}

/** Opens a PDF through the app's shared pdf.js loader. */
export async function openPdfFile(bytes: Uint8Array<ArrayBuffer>): Promise<PdfFile> {
  const pdf = await openPdf(bytes);
  return {
    numPages: pdf.numPages,
    getPage: (pageNumber) => pdf.getPage(pageNumber),
    renderPage: (pageNumber, scale) => renderPdfPage(pdf, pageNumber, scale),
    destroy: () => pdf.destroy(),
  };
}
