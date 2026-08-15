import { Blob as NativeBlob } from "node:buffer";

import {
  MAX_IMAGE_INPUT_BYTES,
  type ImageInputFile,
  type ImageIntakeFailure,
} from "../../src/image/intakeContracts";
import {
  prepareImageInput,
  validatePreparedImage,
  createBrowserImageDecodeAdapter,
  type ImageDecodeAdapter,
} from "../../src/image/imageValidation";

function fileLike(name: string, type: string, bytes: Uint8Array, declaredSize = bytes.byteLength) {
  let reads = 0;
  const file: ImageInputFile = {
    name,
    type,
    size: declaredSize,
    arrayBuffer: async () => {
      reads += 1;
      return bytes.slice().buffer;
    },
  };
  return { file, reads: () => reads };
}

function pngBytes(): Uint8Array {
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
}

function jpegBytes(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1]);
}

function webpBytes(): Uint8Array {
  const bytes = new Uint8Array(12);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(bytes.buffer).setUint32(4, 4, true);
  bytes.set(new TextEncoder().encode("WEBP"), 8);
  return bytes;
}

function avifBytes(major = "avif", compatible = "avis"): Uint8Array {
  const bytes = new Uint8Array(20);
  new DataView(bytes.buffer).setUint32(0, bytes.byteLength, false);
  bytes.set(new TextEncoder().encode("ftyp"), 4);
  bytes.set(new TextEncoder().encode(major), 8);
  bytes.set(new TextEncoder().encode(compatible), 16);
  return bytes;
}

function issueCode(error: unknown): string | undefined {
  return (error as ImageIntakeFailure | undefined)?.issue?.code;
}

describe("Image direct validation", () => {
  it("rejects invalid or oversized declared input sizes before reading", async () => {
    // Catches an oversized or nonsensical file being allocated before its size is admitted.
    for (const size of [0, -1, Number.NaN, MAX_IMAGE_INPUT_BYTES + 1]) {
      const fixture = fileLike("unsafe.png", "image/png", pngBytes(), size);
      await expect(prepareImageInput(fixture.file)).rejects.toSatisfy(
        (error: unknown) => issueCode(error) === "INPUT_SIZE_INVALID",
      );
      expect(fixture.reads()).toBe(0);
    }
  });

  it.each([
    ["source.png", "image/png", pngBytes(), "image/png", "png"],
    ["source.jpg", "image/jpeg", jpegBytes(), "image/jpeg", "jpg"],
    ["source.jpeg", "image/jpg", jpegBytes(), "image/jpeg", "jpeg"],
    ["source.webp", "image/webp", webpBytes(), "image/webp", "webp"],
    ["source.avif", "image/avif", avifBytes(), "image/avif", "avif"],
  ] as const)("classifies and validates %s by extension, MIME, and signature", async (
    name,
    browserMime,
    bytes,
    mimeType,
    extension,
  ) => {
    // Catches a supported extension being routed by browser MIME alone or losing normalized MIME/extension identity.
    const prepared = await prepareImageInput(fileLike(name, browserMime, bytes).file);
    expect(prepared).toMatchObject({ mimeType, fileExtension: extension, byteCount: bytes.byteLength });
    expect(Array.from(new Uint8Array(await prepared.sourceBytes.arrayBuffer()))).toEqual(Array.from(bytes));
  });

  it("rejects extension, MIME, renamed-container, and recognized unsupported signature mismatches specifically", async () => {
    // Catches renamed containers reaching a parser or familiar unsupported formats becoming generic decode failures.
    const cases = [
      ["wrong.png", "image/jpeg", pngBytes(), "MIME_MISMATCH"],
      ["renamed.png", "image/png", new TextEncoder().encode("%PDF-1.7"), "SIGNATURE_MISMATCH"],
      ["art.gif", "image/gif", new TextEncoder().encode("GIF89a"), "UNSUPPORTED_FORMAT"],
      ["art.svg", "image/svg+xml", new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'>"), "UNSUPPORTED_FORMAT"],
      ["photo.heic", "image/heic", avifBytes("heic", "heix"), "UNSUPPORTED_FORMAT"],
      ["notes.md", "text/markdown", new TextEncoder().encode("![x](https://example.test/x.png)"), "REMOTE_DOCUMENT_UNSUPPORTED"],
    ] as const;
    for (const [name, type, bytes, expected] of cases) {
      await expect(prepareImageInput(fileLike(name, type, bytes).file)).rejects.toSatisfy(
        (error: unknown) => issueCode(error) === expected,
      );
    }
  });

  it("parses bounded AVIF ftyp boxes and rejects truncated, misaligned, or HEIC-only brands", async () => {
    // Catches HEIC or malformed ISO-BMFF data being admitted by an unbounded brand substring search.
    const truncated = avifBytes().subarray(0, 17);
    const misaligned = avifBytes();
    new DataView(misaligned.buffer).setUint32(0, 19, false);
    const heicOnly = avifBytes("heic", "mif1");
    for (const bytes of [truncated, misaligned, heicOnly]) {
      await expect(prepareImageInput(fileLike("bad.avif", "image/avif", bytes).file)).rejects.toSatisfy(
        (error: unknown) => issueCode(error) === "SIGNATURE_MISMATCH",
      );
    }
  });

  it("closes the decoder on success and dimension rejection while preserving exact owned bytes and hash", async () => {
    // Catches decode resources leaking, limit checks running after retention, or mutable/re-encoded bytes replacing the source.
    const jsdomBlob = globalThis.Blob;
    Object.defineProperty(globalThis, "Blob", { configurable: true, value: NativeBlob });
    try {
      const source = pngBytes();
      const prepared = await prepareImageInput(fileLike("tiny.png", "image/png", source).file);
      let width = 4_000;
      let height = 2_000;
      const closes: number[] = [];
      const decoder: ImageDecodeAdapter = {
        decode: async () => ({ width, height, close: () => { closes.push(closes.length + 1); } }),
      };
      const validated = await validatePreparedImage(prepared, {
        decoder,
        hash: async (blob) => {
          expect(blob).toBe(prepared.sourceBytes);
          return "sha256-exact-source";
        },
      });
      expect(validated).toMatchObject({
        sourceHash: "sha256-exact-source",
        byteCount: source.byteLength,
        width,
        height,
      });
      expect(validated.sourceBytes).toBe(prepared.sourceBytes);
      expect(closes).toEqual([1]);

      width = 16_385;
      height = 1;
      await expect(validatePreparedImage(prepared, { decoder, hash: async () => "unused" }))
        .rejects.toSatisfy((error: unknown) => issueCode(error) === "DIMENSIONS_LIMIT_EXCEEDED");
      expect(closes).toEqual([1, 2]);

      width = 8_000;
      height = 5_001;
      await expect(validatePreparedImage(prepared, { decoder, hash: async () => "unused" }))
        .rejects.toSatisfy((error: unknown) => issueCode(error) === "DIMENSIONS_LIMIT_EXCEEDED");
      expect(closes).toEqual([1, 2, 3]);
    } finally {
      Object.defineProperty(globalThis, "Blob", { configurable: true, value: jsdomBlob });
    }
  });

  it("closes a decoder handle when hashing fails and maps decode failures to a bounded issue", async () => {
    // Catches hash/decode failures leaking a bitmap or exposing dependency error text.
    const prepared = await prepareImageInput(fileLike("tiny.png", "image/png", pngBytes()).file);
    let closed = 0;
    const decoder: ImageDecodeAdapter = {
      decode: async () => ({ width: 1, height: 1, close: () => { closed += 1; } }),
    };
    await expect(validatePreparedImage(prepared, { decoder, hash: async () => { throw new Error("private path"); } }))
      .rejects.toSatisfy((error: unknown) => issueCode(error) === "HASH_FAILED");
    expect(closed).toBe(1);

    await expect(validatePreparedImage(prepared, {
      decoder: { decode: async () => { throw new Error("decoder internals"); } },
      hash: async () => "unused",
    })).rejects.toSatisfy((error: unknown) => issueCode(error) === "DECODE_FAILED");
  });

  it("aborts the browser fallback wait and unconditionally clears and revokes its temporary URL", async () => {
    // Catches a never-loading <img> ignoring reset/navigation abort or retaining its temporary object URL.
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    const OriginalImage = globalThis.Image;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const revoked: string[] = [];
    const sources: string[] = [];
    class PendingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 2;
      naturalHeight = 3;
      set src(value: string) { sources.push(value); }
    }
    Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: undefined });
    Object.defineProperty(globalThis, "Image", { configurable: true, value: PendingImage });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:temporary" });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: (url: string) => revoked.push(url) });
    try {
      const controller = new AbortController();
      const pending = createBrowserImageDecodeAdapter().decode(
        new NativeBlob([Uint8Array.from(pngBytes())], { type: "image/png" }) as Blob,
        controller.signal,
      );
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      expect(sources).toEqual(["blob:temporary", ""]);
      expect(revoked).toEqual(["blob:temporary"]);
    } finally {
      Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: originalCreateImageBitmap });
      Object.defineProperty(globalThis, "Image", { configurable: true, value: OriginalImage });
      Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreate });
      Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevoke });
    }
  }, 1_000);
});
