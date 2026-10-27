import {
  MAX_IMAGE_AXIS,
  MAX_IMAGE_INPUT_BYTES,
  MAX_IMAGE_PIXELS,
  failImageIntake,
  type ImageInputFile,
  type PreparedImageSource,
  type ValidatedImageSource,
} from "./intakeContracts";
import type { ImageFileExtension, ImageMimeType } from "./contracts";

export interface ImageDecodeHandle {
  readonly width: number;
  readonly height: number;
  close(): void;
}

export interface ImageDecodeAdapter {
  decode(source: Blob, signal?: AbortSignal): Promise<ImageDecodeHandle>;
}

export interface ValidatePreparedImageDependencies {
  readonly decoder: ImageDecodeAdapter;
  readonly hash?: (source: Blob) => Promise<string>;
  readonly signal?: AbortSignal;
}

interface ImageClassification {
  readonly mimeType: ImageMimeType;
  readonly fileExtension: ImageFileExtension;
  readonly browserMimeTypes: readonly string[];
}

const CLASSIFICATIONS: Readonly<Record<string, ImageClassification>> = Object.freeze({
  png: { mimeType: "image/png", fileExtension: "png", browserMimeTypes: ["image/png"] },
  jpg: { mimeType: "image/jpeg", fileExtension: "jpg", browserMimeTypes: ["image/jpeg", "image/jpg"] },
  jpeg: { mimeType: "image/jpeg", fileExtension: "jpeg", browserMimeTypes: ["image/jpeg", "image/jpg"] },
  webp: { mimeType: "image/webp", fileExtension: "webp", browserMimeTypes: ["image/webp"] },
  avif: { mimeType: "image/avif", fileExtension: "avif", browserMimeTypes: ["image/avif"] },
});

const UNSUPPORTED_IMAGE_EXTENSIONS = new Set([
  "svg", "gif", "bmp", "tif", "tiff", "heic", "heif",
]);
const REMOTE_DOCUMENT_EXTENSIONS = new Set(["html", "htm", "md", "markdown"]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

function equalAt(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  return equalAt(bytes, offset, Array.from(text, (character) => character.charCodeAt(0)));
}

function recognizedUnsupportedSignature(bytes: Uint8Array): boolean {
  const prefix = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 256)).trimStart().toLowerCase();
  return asciiAt(bytes, 0, "GIF87a")
    || asciiAt(bytes, 0, "GIF89a")
    || asciiAt(bytes, 0, "BM")
    || equalAt(bytes, 0, [0x49, 0x49, 0x2a, 0x00])
    || equalAt(bytes, 0, [0x4d, 0x4d, 0x00, 0x2a])
    || prefix.startsWith("<svg")
    || prefix.startsWith("<?xml") && prefix.includes("<svg");
}

function validAvifFtyp(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 16) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const shortSize = view.getUint32(0, false);
  let boxSize = shortSize;
  let headerSize = 8;
  if (shortSize === 1) {
    if (bytes.byteLength < 24) return false;
    const extendedSize = view.getBigUint64(8, false);
    if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) return false;
    boxSize = Number(extendedSize);
    headerSize = 16;
  }
  if (!asciiAt(bytes, 4, "ftyp")
    || !Number.isSafeInteger(boxSize)
    || boxSize < headerSize + 8
    || boxSize > bytes.byteLength
    || (boxSize - headerSize - 8) % 4 !== 0) return false;
  const brands: string[] = [];
  brands.push(new TextDecoder().decode(bytes.subarray(headerSize, headerSize + 4)));
  for (let offset = headerSize + 8; offset < boxSize; offset += 4) {
    brands.push(new TextDecoder().decode(bytes.subarray(offset, offset + 4)));
  }
  return brands.includes("avif") || brands.includes("avis");
}

function validSignature(bytes: Uint8Array, extension: ImageFileExtension): boolean {
  switch (extension) {
    case "png":
      return equalAt(bytes, 0, [137, 80, 78, 71, 13, 10, 26, 10]);
    case "jpg":
    case "jpeg":
      return equalAt(bytes, 0, [0xff, 0xd8, 0xff]);
    case "webp": {
      if (bytes.byteLength < 12 || !asciiAt(bytes, 0, "RIFF") || !asciiAt(bytes, 8, "WEBP")) return false;
      const declared = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
      return declared === bytes.byteLength - 8;
    }
    case "avif":
      return validAvifFtyp(bytes);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Image validation cancelled.", "AbortError");
}

export async function prepareImageInput(input: ImageInputFile): Promise<PreparedImageSource> {
  if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > MAX_IMAGE_INPUT_BYTES) {
    failImageIntake("INPUT_SIZE_INVALID");
  }
  const extension = extensionOf(input.name);
  if (REMOTE_DOCUMENT_EXTENSIONS.has(extension)) failImageIntake("REMOTE_DOCUMENT_UNSUPPORTED");
  if (UNSUPPORTED_IMAGE_EXTENSIONS.has(extension)) failImageIntake("UNSUPPORTED_FORMAT");
  const classification = CLASSIFICATIONS[extension];
  if (!classification) failImageIntake("UNSUPPORTED_EXTENSION");
  if (input.type && !classification.browserMimeTypes.includes(input.type.toLowerCase())) {
    failImageIntake("MIME_MISMATCH");
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await input.arrayBuffer());
  } catch {
    failImageIntake("READ_FAILED");
  }
  if (bytes.byteLength !== input.size || bytes.byteLength < 1 || bytes.byteLength > MAX_IMAGE_INPUT_BYTES) {
    failImageIntake("READ_FAILED");
  }
  if (!validSignature(bytes, classification.fileExtension)) {
    if (recognizedUnsupportedSignature(bytes)) failImageIntake("UNSUPPORTED_FORMAT");
    failImageIntake("SIGNATURE_MISMATCH");
  }
  const owned = Uint8Array.from(bytes);
  return Object.freeze({
    sourceName: input.name,
    sourceBytes: new Blob([owned], { type: classification.mimeType }),
    byteCount: owned.byteLength,
    mimeType: classification.mimeType,
    fileExtension: classification.fileExtension,
  });
}

export function validateImageDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    failImageIntake("DIMENSIONS_INVALID");
  }
  if (width > MAX_IMAGE_AXIS || height > MAX_IMAGE_AXIS) failImageIntake("DIMENSIONS_LIMIT_EXCEEDED");
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > MAX_IMAGE_PIXELS) {
    failImageIntake("DIMENSIONS_LIMIT_EXCEEDED");
  }
}

async function defaultHash(source: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await source.arrayBuffer());
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function validatePreparedImage(
  prepared: PreparedImageSource,
  dependencies: ValidatePreparedImageDependencies,
): Promise<ValidatedImageSource> {
  throwIfAborted(dependencies.signal);
  let handle: ImageDecodeHandle;
  try {
    handle = await dependencies.decoder.decode(prepared.sourceBytes, dependencies.signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    failImageIntake("DECODE_FAILED");
  }
  try {
    throwIfAborted(dependencies.signal);
    validateImageDimensions(handle.width, handle.height);
    let sourceHash: string;
    try {
      sourceHash = await (dependencies.hash ?? defaultHash)(prepared.sourceBytes);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      failImageIntake("HASH_FAILED");
    }
    throwIfAborted(dependencies.signal);
    return Object.freeze({
      ...prepared,
      sourceHash,
      width: handle.width,
      height: handle.height,
      warnings: Object.freeze([
        "Exact source bytes are preserved and may retain EXIF or location metadata.",
      ]),
    });
  } finally {
    try {
      handle.close();
    } catch {
      // The decoder handle has one cleanup owner; cleanup errors never replace the safe intake result.
    }
  }
}

export function createBrowserImageDecodeAdapter(): ImageDecodeAdapter {
  return {
    async decode(source, signal) {
      throwIfAborted(signal);
      if (typeof createImageBitmap === "function") {
        const bitmap = await createImageBitmap(source);
        return { width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
      }
      const url = URL.createObjectURL(source);
      const image = new Image();
      let abort: (() => void) | null = null;
      try {
        const loaded = new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("Image decode failed."));
          abort = () => reject(new DOMException("Image validation cancelled.", "AbortError"));
          signal?.addEventListener("abort", abort, { once: true });
        });
        image.src = url;
        await loaded;
        throwIfAborted(signal);
        return {
          width: image.naturalWidth,
          height: image.naturalHeight,
          close: () => undefined,
        };
      } finally {
        if (abort) signal?.removeEventListener("abort", abort);
        image.onload = null;
        image.onerror = null;
        image.src = "";
        URL.revokeObjectURL(url);
      }
    },
  };
}
