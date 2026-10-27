import { concat, type ReviewRuntime } from "./runtime";

export const PNG_LIMITS = Object.freeze({
  bytes: 8 * 1024 * 1024,
  axis: 4096,
  pixels: 4096 * 4096,
  inflatedBytes: 68 * 1024 * 1024,
  chunks: 4096,
  metadataBytes: 256 * 1024,
});

export class PngValidationError extends Error {
  override readonly name = "PngValidationError";
}

function fail(message: string): never { throw new PngValidationError(message); }
const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

export function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}

/** Validate a bounded static PNG without invoking a browser or image renderer.
 * Supports non-interlaced, 8-bit grayscale/RGB/grayscale-alpha/RGBA only.
 * A single pre-IDAT caBX chunk is retained as bounded opaque metadata.
 * Only its outer normal-length JUMBF envelope is checked, not claims/signatures.
 * Compressed PNG text/profile chunks, animation and other unknown chunks are rejected.
 */
export function createPngInspector(runtime:ReviewRuntime){
function inspectPng(bytes: Uint8Array, maxBytes = PNG_LIMITS.bytes): { width: number; height: number; mimeType: "image/png" } {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > PNG_LIMITS.bytes) fail("PNG byte bound must be between 1 and 8 MiB.");
  if (!(bytes instanceof Uint8Array) || bytes.length > maxBytes || bytes.length < 57) fail("PNG is empty, truncated, or exceeds the 8 MiB byte limit.");
  if (!signature.every((byte, index) => bytes[index] === byte)) fail("Only actual PNG image bytes are supported.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 8;
  let width = 0, height = 0, channels = 0, color = -1;
  let count = 0, metadataBytes = 0;
  let ended = false, sawData = false, dataEnded = false;
  const once = new Set<string>();
  const dataParts: Uint8Array[] = [];
  while (cursor < bytes.length) {
    if (++count > PNG_LIMITS.chunks || cursor + 12 > bytes.length) fail("PNG chunk count or bounds are invalid.");
    const length = view.getUint32(cursor, false);
    const end = cursor + 12 + length;
    if (end > bytes.length) fail("PNG chunk extends beyond the image bytes.");
    const type = String.fromCharCode(...bytes.subarray(cursor + 4, cursor + 8));
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/u.test(type)) fail("PNG chunk type is invalid.");
    if (crc32(bytes.subarray(cursor + 4, end - 4)) !== view.getUint32(end - 4, false)) fail("PNG chunk CRC integrity check failed.");
    const data = bytes.subarray(cursor + 8, end - 4);
    if (count === 1 && type !== "IHDR") fail("PNG must start with its dimension header.");
    if (type === "IHDR") {
      if (count !== 1 || length !== 13) fail("PNG has a duplicate or malformed dimension header.");
      width = view.getUint32(cursor + 8, false);
      height = view.getUint32(cursor + 12, false);
      color = data[9];
      if (!width || !height || width > PNG_LIMITS.axis || height > PNG_LIMITS.axis || width * height > PNG_LIMITS.pixels) fail("PNG dimensions exceed the 4096-axis / 16,777,216-pixel limit.");
      if (data[8] !== 8 || ![0, 2, 4, 6].includes(color) || data[12] !== 0) fail("Only non-interlaced 8-bit grayscale, RGB, grayscale-alpha and RGBA PNGs are supported; indexed, 16-bit and interlaced PNGs are unsupported.");
      if (data[10] !== 0 || data[11] !== 0) fail("PNG compression or filter method is unsupported.");
      channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[color];
    } else if (type === "IDAT") {
      if (dataEnded) fail("PNG image-data chunks must be consecutive.");
      sawData = true;
      dataParts.push(data);
    } else if (type === "IEND") {
      if (!sawData || length !== 0 || end !== bytes.length) fail("PNG end marker is malformed or followed by trailing bytes.");
      ended = true;
    } else {
      if (sawData) dataEnded = true;
      metadataBytes += length;
      if (metadataBytes > PNG_LIMITS.metadataBytes) fail("PNG ancillary metadata exceeds 256 KiB.");
      if (["acTL", "fcTL", "fdAT"].includes(type)) fail("Animated PNG images are unsupported.");
      if (!["PLTE", "tRNS", "gAMA", "cHRM", "sRGB", "pHYs", "sBIT", "bKGD", "tEXt", "caBX"].includes(type)) fail(`PNG chunk ${type} is unsupported; compressed metadata and unknown ancillary chunks are not accepted.`);
      if (type !== "tEXt" && (once.has(type) || sawData)) fail("PNG metadata ordering or uniqueness is invalid.");
      once.add(type);
      if (type === "caBX") {
        // PNG CRC, aggregate metadata bounds, uniqueness and pre-IDAT ordering
        // were checked above. Do not parse, expand, render or trust the contents.
        // Support the observed normal-length outer JUMBF box only; extended and
        // to-end box lengths are deliberately outside this bounded slice.
        if (length <= 8 || view.getUint32(cursor + 8, false) !== length ||
            String.fromCharCode(...data.subarray(4, 8)) !== "jumb") {
          fail("PNG caBX requires one nonempty normal-length outer JUMBF box matching the chunk payload.");
        }
      }
      const u16 = (offset: number) => (data[offset] << 8) | data[offset + 1];
      if (type === "PLTE" && (![2, 6].includes(color) || length < 3 || length > 768 || length % 3 !== 0 || once.has("tRNS") || once.has("bKGD"))) fail("PNG palette is invalid for this color mode or ordering.");
      if (type === "tRNS" && (!(color === 0 && length === 2 || color === 2 && length === 6) || Array.from({ length: length / 2 }, (_, i) => u16(i * 2)).some(value => value > 255))) fail("PNG transparency values are invalid.");
      if (type === "gAMA" && (length !== 4 || view.getUint32(cursor + 8, false) === 0 || once.has("PLTE"))) fail("PNG gamma chunk is invalid.");
      if (type === "cHRM" && (length !== 32 || once.has("PLTE"))) fail("PNG chromaticity chunk is invalid.");
      if (type === "sRGB" && (length !== 1 || data[0] > 3 || once.has("PLTE"))) fail("PNG color intent is invalid.");
      if (type === "pHYs" && (length !== 9 || data[8] > 1)) fail("PNG physical dimensions are invalid.");
      if (type === "sBIT" && (length !== channels || [...data].some(value => value < 1 || value > 8) || once.has("PLTE"))) fail("PNG significant-bit metadata is invalid.");
      if (type === "bKGD" && (length !== (color === 0 || color === 4 ? 2 : 6) || Array.from({ length: length / 2 }, (_, i) => u16(i * 2)).some(value => value > 255))) fail("PNG background metadata is invalid.");
      if (type === "tEXt") {
        const separator = data.indexOf(0);
        if (separator < 1 || separator > 79 || data.subarray(separator + 1).includes(0)) fail("PNG text metadata is malformed.");
      }
    }
    cursor = end;
  }
  if (!ended || !sawData) fail("PNG is missing complete image data or its end marker.");
  const stride = width * channels + 1;
  const expected = stride * height;
  if (expected > PNG_LIMITS.inflatedBytes) fail("PNG decoded raster exceeds its byte limit.");
  const compressed = concat(dataParts);
  let raster: Uint8Array;
  try {
    const result = runtime.inflate(compressed, expected, false);
    if (result.consumed !== compressed.length) fail("PNG contains trailing or concatenated compressed image data.");
    raster = result.buffer;
  } catch (error) {
    if (error instanceof PngValidationError) throw error;
    return fail("PNG image data is corrupt or exceeds its declared dimensions.");
  }
  if (raster.length !== expected) fail("PNG raster length does not match its dimensions and color mode.");
  for (let row = 0; row < height; row++) if (raster[row * stride] > 4) fail("PNG raster contains an invalid row filter.");
  return { width, height, mimeType: "image/png" };
}

return inspectPng;
}
