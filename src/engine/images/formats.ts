// Recognizes inputs by name and images by their first bytes.
import { isSystemClutter } from "../paths";
import type { ImageMimeType } from "../types";

export type InputKind = "image" | "pdf" | "docx" | "zip";

const IMAGE_EXTENSIONS: Readonly<Record<string, ImageMimeType>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
};

export const FORMAT_LABELS: Readonly<Record<ImageMimeType, string>> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/webp": "WebP",
  "image/avif": "AVIF",
};

const UNSUPPORTED_IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  gif: "GIF",
  bmp: "BMP",
  tif: "TIFF",
  tiff: "TIFF",
  heic: "HEIC",
  heif: "HEIF",
  svg: "SVG",
  ico: "ICO",
  jxl: "JPEG XL",
  emf: "EMF",
  wmf: "WMF",
  psd: "Photoshop",
};

/** For a file input's `accept` attribute. */
export const IMAGE_INPUT_ACCEPT = ".png,.jpg,.jpeg,.webp,.avif,.pdf,.docx,.zip";

export function extensionOf(name: string): string {
  const base = baseName(name);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function inputKind(name: string): InputKind | null {
  const extension = extensionOf(name);
  if (extension in IMAGE_EXTENSIONS) return "image";
  if (extension === "pdf" || extension === "docx" || extension === "zip") return extension;
  return null;
}

export function isSupportedImageInputName(name: string): boolean {
  return inputKind(name) !== null;
}

/** The image type a file's name promises, if any. */
export function imageTypeForName(name: string): ImageMimeType | null {
  return IMAGE_EXTENSIONS[extensionOf(name)] ?? null;
}

/** A plain reason for a file this app doesn't read, with what to do instead. */
export function unsupportedReason(name: string): string {
  const extension = extensionOf(name);
  const format = UNSUPPORTED_IMAGE_EXTENSIONS[extension];
  if (format) return unsupportedFormatReason(format);
  if (extension === "doc") {
    return "Older Word files (.doc) aren't supported. Save it as .docx and add it again.";
  }
  return (
    "This type of file isn't supported. Add PNG, JPEG, WebP, or AVIF images, " +
    "or PDF, Word (.docx), or ZIP files."
  );
}

export function unsupportedFormatReason(format: string): string {
  return `${format} images aren't supported. Save it as PNG or JPEG and add it again.`;
}

/**
 * Hidden system files (macOS resource forks, Finder and Explorer metadata) are skipped
 * silently: people never see them, so listing them as rejected would only confuse.
 */
export function isSystemFile(path: string): boolean {
  return isSystemClutter(path) || path.split("/").some((segment) => segment.startsWith("."));
}

function bytesEqual(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  return bytesEqual(
    bytes,
    offset,
    Array.from(text, (character) => character.charCodeAt(0)),
  );
}

/** Brands listed in an ISO media file's leading `ftyp` box (AVIF and HEIC use these). */
function ftypBrands(bytes: Uint8Array): string[] | null {
  if (bytes.byteLength < 16 || !asciiAt(bytes, 4, "ftyp")) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxSize = view.getUint32(0, false);
  if (boxSize < 16 || boxSize > bytes.byteLength || (boxSize - 16) % 4 !== 0) return null;
  const decoder = new TextDecoder();
  const brands = [decoder.decode(bytes.subarray(8, 12))];
  for (let offset = 16; offset < boxSize; offset += 4) {
    brands.push(decoder.decode(bytes.subarray(offset, offset + 4)));
  }
  return brands;
}

/** The supported image type these bytes actually hold, whatever the file is called. */
export function sniffImageType(bytes: Uint8Array): ImageMimeType | null {
  if (bytesEqual(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (bytesEqual(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytes.byteLength >= 12 && asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) {
    const declared = new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true);
    // Some encoders leave trailing bytes after the RIFF chunk, so only a short file is wrong.
    if (declared >= 4 && declared + 8 <= bytes.byteLength) return "image/webp";
  }
  const brands = ftypBrands(bytes);
  if (brands?.includes("avif") || brands?.includes("avis")) return "image/avif";
  return null;
}

const HEIC_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"];

/** Names a recognized image format this app can't use, so the reason can say which. */
export function sniffOtherImageFormat(bytes: Uint8Array): string | null {
  if (asciiAt(bytes, 0, "GIF87a") || asciiAt(bytes, 0, "GIF89a")) return "GIF";
  if (asciiAt(bytes, 0, "BM") && bytes.byteLength >= 26) return "BMP";
  if (
    bytesEqual(bytes, 0, [0x49, 0x49, 0x2a, 0x00]) ||
    bytesEqual(bytes, 0, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return "TIFF";
  }
  if (bytesEqual(bytes, 0, [0x01, 0x00, 0x00, 0x00]) && asciiAt(bytes, 40, " EMF")) return "EMF";
  if (bytesEqual(bytes, 0, [0xd7, 0xcd, 0xc6, 0x9a])) return "WMF";
  if (ftypBrands(bytes)?.some((brand) => HEIC_BRANDS.includes(brand))) return "HEIC";
  const start = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart().toLowerCase();
  if (start.startsWith("<svg") || (start.startsWith("<?xml") && start.includes("<svg"))) {
    return "SVG";
  }
  return null;
}

export function hasZipSignature(bytes: Uint8Array): boolean {
  return (
    bytesEqual(bytes, 0, [0x50, 0x4b, 0x03, 0x04]) ||
    // An empty archive is just its end record.
    bytesEqual(bytes, 0, [0x50, 0x4b, 0x05, 0x06])
  );
}

/** PDF readers accept a `%PDF-` header anywhere in the first kilobyte. */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.byteLength, 1024) - 5;
  for (let offset = 0; offset <= end; offset += 1) {
    if (asciiAt(bytes, offset, "%PDF-")) return true;
  }
  return false;
}
