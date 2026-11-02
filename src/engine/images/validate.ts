// Checks that bytes are a usable image by decoding them, and reads the image's size.
import type { ImageMimeType } from "../types";
import { ImageReadError } from "./errors";
import {
  FORMAT_LABELS,
  extensionOf,
  imageTypeForName,
  sniffImageType,
  sniffOtherImageFormat,
  unsupportedFormatReason,
} from "./formats";
import { IMAGE_LIMITS } from "./limits";

/** Decodes an image far enough to learn its size, then releases it. */
export type ImageDecoder = (image: Blob, signal?: AbortSignal) => Promise<ImageSize>;

export interface ImageSize {
  width: number;
  height: number;
}

export interface ValidImage extends ImageSize {
  original: Blob;
  mimeType: ImageMimeType;
  byteCount: number;
  sha256: string;
  notes: string[];
}

const MB = 1024 * 1024;

export async function sha256Hex(data: BufferSource | Blob): Promise<string> {
  const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function tooLargeFileReason(byteCount: number, limit: number): string {
  const size = Math.ceil(byteCount / MB);
  return `This file is ${size} MB; the limit is ${Math.round(limit / MB)} MB.`;
}

/** Throws a plain-language error when an image is too big to work with. */
export function checkDimensions({ width, height }: ImageSize): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new ImageReadError("This image has no usable size. It may be damaged.");
  }
  const { maxImageSide, maxImagePixels } = IMAGE_LIMITS;
  if (width > maxImageSide || height > maxImageSide || width * height > maxImagePixels) {
    throw new ImageReadError(
      `This image is too large (${width.toLocaleString("en-US")} × ` +
        `${height.toLocaleString("en-US")} pixels). The limit is ` +
        `${maxImageSide.toLocaleString("en-US")} pixels on a side and ` +
        `${maxImagePixels / 1_000_000} megapixels.`,
      "too-large",
    );
  }
}

function readSize(width: number, height: number): ImageSize | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

function pngSize(view: DataView): ImageSize | null {
  // The IHDR chunk always comes first: width and height at bytes 16 and 20.
  if (view.byteLength < 24) return null;
  return readSize(view.getUint32(16), view.getUint32(20));
}

function jpegSize(bytes: Uint8Array, view: DataView): ImageSize | null {
  let offset = 2;
  while (offset + 9 <= bytes.byteLength) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Start-of-frame markers carry the size; C4, C8, and CC share the range but don't.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return readSize(view.getUint16(offset + 7), view.getUint16(offset + 5));
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return null;
}

function webpSize(bytes: Uint8Array, view: DataView): ImageSize | null {
  if (bytes.byteLength < 30) return null;
  const chunk = new TextDecoder().decode(bytes.subarray(12, 16));
  if (chunk === "VP8X") {
    const width = 1 + (view.getUint32(24, true) & 0xffffff);
    const height = 1 + (view.getUint32(27, true) & 0xffffff);
    return readSize(width, height);
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const bits = view.getUint32(21, true);
    return readSize(1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff));
  }
  if (chunk === "VP8 ") {
    return readSize(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
  }
  return null;
}

function avifSize(bytes: Uint8Array, view: DataView): ImageSize | null {
  // The image's size is in its "ispe" property box, near the start of the file.
  const end = Math.min(bytes.byteLength, 64 * 1024) - 16;
  for (let offset = 4; offset <= end; offset += 1) {
    if (
      bytes[offset] === 0x69 &&
      new TextDecoder().decode(bytes.subarray(offset, offset + 4)) === "ispe"
    ) {
      return readSize(view.getUint32(offset + 8), view.getUint32(offset + 12));
    }
  }
  return null;
}

/** The size an image's header states, read without decoding it; null when it can't be read. */
export function headerSize(bytes: Uint8Array, mimeType: ImageMimeType): ImageSize | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (mimeType === "image/png") return pngSize(view);
    if (mimeType === "image/jpeg") return jpegSize(bytes, view);
    if (mimeType === "image/webp") return webpSize(bytes, view);
    return avifSize(bytes, view);
  } catch {
    return null;
  }
}

/**
 * Accepts PNG, JPEG, WebP, and AVIF by content rather than by name, decodes the image to
 * prove it opens, and checks the size limits.
 */
export async function validateImage(
  bytes: Uint8Array<ArrayBuffer>,
  name: string,
  decode: ImageDecoder,
  signal?: AbortSignal,
): Promise<ValidImage> {
  if (bytes.byteLength === 0) throw new ImageReadError("This file is empty.");
  if (bytes.byteLength > IMAGE_LIMITS.maxImageBytes) {
    throw new ImageReadError(
      tooLargeFileReason(bytes.byteLength, IMAGE_LIMITS.maxImageBytes),
      "too-large",
    );
  }
  const mimeType = sniffImageType(bytes);
  const named = imageTypeForName(name);
  if (!mimeType) {
    const other = sniffOtherImageFormat(bytes);
    if (other) throw new ImageReadError(unsupportedFormatReason(other), "unsupported", other);
    if (named) {
      throw new ImageReadError(
        `This file isn't a valid ${FORMAT_LABELS[named]} image. It may be damaged.`,
      );
    }
    throw new ImageReadError(
      "This file isn't a PNG, JPEG, WebP, or AVIF image.",
      "unsupported",
      extensionOf(name).toUpperCase() || undefined,
    );
  }
  const notes: string[] = [];
  if (named && named !== mimeType) {
    notes.push(
      `This file is a ${FORMAT_LABELS[mimeType]} image even though its name ends in ` +
        `.${extensionOf(name)}.`,
    );
  }
  // A header promising a huge image is refused before decoding allocates its pixels.
  const declared = headerSize(bytes, mimeType);
  if (declared) checkDimensions(declared);
  const original = new Blob([bytes], { type: mimeType });
  let size: ImageSize;
  try {
    size = await decode(original, signal);
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof ImageReadError) throw error;
    throw new ImageReadError("This image couldn't be opened. It may be damaged or incomplete.");
  }
  checkDimensions(size);
  signal?.throwIfAborted();
  return {
    original,
    mimeType,
    width: size.width,
    height: size.height,
    byteCount: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    notes,
  };
}

/** The browser decoder: a full decode, so a file that only looks like an image is caught. */
export async function decodeImageSize(image: Blob, signal?: AbortSignal): Promise<ImageSize> {
  signal?.throwIfAborted();
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(image);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }
  const url = URL.createObjectURL(image);
  try {
    const element = new Image();
    element.src = url;
    await element.decode();
    return { width: element.naturalWidth, height: element.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}
