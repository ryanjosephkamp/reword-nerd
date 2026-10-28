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
