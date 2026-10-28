import { ImageReadError } from "../../../src/engine/images/errors";
import { IMAGE_LIMITS } from "../../../src/engine/images/limits";
import { validateImage, type ImageDecoder } from "../../../src/engine/images/validate";
import {
  avifBytes,
  fakeDecoder,
  gifBytes,
  heicBytes,
  jpegBytes,
  pngBytes,
  webpBytes,
} from "../../fixtures/images/samples";

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function failure(promise: Promise<unknown>): Promise<ImageReadError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ImageReadError);
  return error as ImageReadError;
}

describe("validateImage", () => {
  it.each([
    ["photo.png", pngBytes({ width: 32, height: 24 }), "image/png"],
    ["photo.jpg", jpegBytes(), "image/jpeg"],
    ["photo.webp", webpBytes(), "image/webp"],
    ["photo.avif", avifBytes(), "image/avif"],
  ] as const)("accepts %s with its exact bytes, size, and hash", async (name, bytes, mimeType) => {
    const valid = await validateImage(bytes, name, fakeDecoder);
    expect(valid).toMatchObject({ mimeType, byteCount: bytes.byteLength, notes: [] });
    expect(valid.original.type).toBe(mimeType);
    expect(new Uint8Array(await valid.original.arrayBuffer())).toEqual(bytes);
    expect(valid.sha256).toBe(await sha256(bytes));
  });

  it("reads the size from the decoder", async () => {
    const valid = await validateImage(pngBytes({ width: 32, height: 24 }), "a.png", fakeDecoder);
    expect(valid).toMatchObject({ width: 32, height: 24 });
  });

  it("goes by content when the name's extension is wrong, and says so", async () => {
    const valid = await validateImage(jpegBytes(), "download.png", fakeDecoder);
    expect(valid.mimeType).toBe("image/jpeg");
    expect(valid.notes).toEqual(["This file is a JPEG image even though its name ends in .png."]);
  });

  it("rejects empty and oversized files before decoding", async () => {
    const decode = vi.fn(fakeDecoder);
    const empty = await failure(validateImage(new Uint8Array(0), "a.png", decode));
    expect(empty.message).toBe("This file is empty.");
    const huge = pngBytes({ byteLength: IMAGE_LIMITS.maxImageBytes + 1 });
    const tooLarge = await failure(validateImage(huge, "a.png", decode));
    expect(tooLarge.message).toBe("This file is 21 MB; the limit is 20 MB.");
    expect(tooLarge.problem).toBe("too-large");
    expect(decode).not.toHaveBeenCalled();
  });

  it("names unsupported formats found by content", async () => {
    const gif = await failure(validateImage(gifBytes(), "art.png", fakeDecoder));
    expect(gif).toMatchObject({ problem: "unsupported", format: "GIF" });
    expect(gif.message).toBe(
      "GIF images aren't supported. Save it as PNG or JPEG and add it again.",
    );
    const heic = await failure(validateImage(heicBytes(), "photo.avif", fakeDecoder));
    expect(heic.format).toBe("HEIC");
  });

  it("calls a file that doesn't match its supported name damaged", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7");
    const error = await failure(validateImage(pdf, "renamed.png", fakeDecoder));
    expect(error.message).toBe("This file isn't a valid PNG image. It may be damaged.");
    expect(error.problem).toBe("unreadable");
  });

  it("rejects an image that fails to decode", async () => {
    const error = await failure(validateImage(pngBytes({ broken: true }), "a.png", fakeDecoder));
    expect(error.message).toBe("This image couldn't be opened. It may be damaged or incomplete.");
  });

  it("enforces the pixel limits with readable numbers", async () => {
    const wide = await failure(
      validateImage(pngBytes({ width: 20_000, height: 10 }), "wide.png", fakeDecoder),
    );
    expect(wide.message).toBe(
      "This image is too large (20,000 × 10 pixels). The limit is 16,384 pixels on a side " +
        "and 40 megapixels.",
    );
    const area = await failure(
      validateImage(pngBytes({ width: 10_000, height: 5_000 }), "big.png", fakeDecoder),
    );
    expect(area.problem).toBe("too-large");
    const zero = await failure(validateImage(pngBytes({ width: 0 }), "zero.png", fakeDecoder));
    expect(zero.message).toBe("This image has no usable size. It may be damaged.");
  });

  it("stops when cancelled during decoding", async () => {
    const controller = new AbortController();
    const decode: ImageDecoder = async () => {
      controller.abort();
      throw new Error("interrupted");
    };
    await expect(validateImage(pngBytes(), "a.png", decode, controller.signal)).rejects.toThrow(
      expect.objectContaining({ name: "AbortError" }),
    );
  });
});

describe("sizes from image headers", () => {
  function jpegWithSize(width: number, height: number): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(32);
    bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
    bytes.set(
      [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff],
      8,
    );
    return bytes;
  }

  function webpWithSize(width: number, height: number): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(40);
    const view = new DataView(bytes.buffer);
    bytes.set(new TextEncoder().encode("RIFF"), 0);
    view.setUint32(4, 32, true);
    bytes.set(new TextEncoder().encode("WEBPVP8X"), 8);
    view.setUint32(24, (width - 1) & 0xffffff, true);
    view.setUint32(27, (height - 1) & 0xffffff, true);
    return bytes;
  }

  function avifWithSize(width: number, height: number): Uint8Array<ArrayBuffer> {
    const header = avifBytes();
    const box = new Uint8Array(20);
    const view = new DataView(box.buffer);
    view.setUint32(0, 20);
    box.set(new TextEncoder().encode("ispe"), 4);
    view.setUint32(12, width);
    view.setUint32(16, height);
    const bytes = new Uint8Array(header.byteLength + box.byteLength);
    bytes.set(header);
    bytes.set(box, header.byteLength);
    return bytes;
  }

  it.each([
    ["PNG", "a.png", pngBytes({ width: 100_000, height: 100_000 })],
    ["JPEG", "a.jpg", jpegWithSize(60_000, 60_000)],
    ["WebP", "a.webp", webpWithSize(20_000, 20_000)],
    ["AVIF", "a.avif", avifWithSize(30_000, 30_000)],
  ] as const)(
    "refuses a %s whose header promises a huge image, without decoding it",
    async (_, name, bytes) => {
      // Catches a small file that decodes into gigabytes of pixels before its size is checked.
      const decode = vi.fn(fakeDecoder);
      const error = await failure(validateImage(bytes, name, decode));
      expect(error.problem).toBe("too-large");
      expect(decode).not.toHaveBeenCalled();
    },
  );

  it("still decodes images whose header size is within the limits", async () => {
    const decode = vi.fn(fakeDecoder);
    await validateImage(jpegWithSize(800, 600), "a.jpg", decode);
    expect(decode).toHaveBeenCalledTimes(1);
  });
});
