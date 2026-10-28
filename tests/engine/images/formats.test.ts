import {
  hasPdfSignature,
  hasZipSignature,
  isSupportedImageInputName,
  isSystemFile,
  sniffImageType,
  sniffOtherImageFormat,
  unsupportedReason,
} from "../../../src/engine/images/formats";
import {
  avifBytes,
  emfBytes,
  ftypBytes,
  gifBytes,
  heicBytes,
  jpegBytes,
  pngBytes,
  webpBytes,
} from "../../fixtures/images/samples";

const text = new TextEncoder();

describe("input names", () => {
  it.each([
    ["photo.png", true],
    ["PHOTO.JPG", true],
    ["scan.jpeg", true],
    ["art.webp", true],
    ["art.avif", true],
    ["report.pdf", true],
    ["report.docx", true],
    ["bundle.zip", true],
    ["notes.txt", false],
    ["old.doc", false],
    ["photo.heic", false],
    ["png", false],
    [".png", false],
  ])("%s is supported: %s", (name, expected) => {
    expect(isSupportedImageInputName(name)).toBe(expected);
  });

  it("explains unsupported files with what to do instead", () => {
    expect(unsupportedReason("IMG_0001.HEIC")).toBe(
      "HEIC images aren't supported. Save it as PNG or JPEG and add it again.",
    );
    expect(unsupportedReason("old.doc")).toMatch(/Save it as \.docx/);
    expect(unsupportedReason("notes.txt")).toMatch(/isn't supported. Add PNG, JPEG/);
  });

  it("recognizes hidden system files", () => {
    expect(isSystemFile(".DS_Store")).toBe(true);
    expect(isSystemFile("Album/.hidden/photo.png")).toBe(true);
    expect(isSystemFile("__MACOSX/Album/._photo.png")).toBe(true);
    expect(isSystemFile("Album/Thumbs.db")).toBe(true);
    // macOS folder icons, which would otherwise be rejected as an unsupported type.
    expect(isSystemFile("Album/Icon\r")).toBe(true);
    expect(isSystemFile("Album/photo.png")).toBe(false);
  });
});

describe("content sniffing", () => {
  it("recognizes supported images by their bytes", () => {
    expect(sniffImageType(pngBytes())).toBe("image/png");
    expect(sniffImageType(jpegBytes())).toBe("image/jpeg");
    expect(sniffImageType(webpBytes())).toBe("image/webp");
    expect(sniffImageType(avifBytes())).toBe("image/avif");
    expect(sniffImageType(ftypBytes("mif1", ["avis"]))).toBe("image/avif");
  });

  it("accepts WebP with trailing bytes but not a truncated one", () => {
    expect(sniffImageType(webpBytes(0, 6))).toBe("image/webp");
    expect(sniffImageType(webpBytes().subarray(0, 14))).toBeNull();
  });

  it("rejects malformed or HEIC-only ftyp boxes as AVIF", () => {
    const misaligned = avifBytes();
    new DataView(misaligned.buffer).setUint32(0, 19);
    expect(sniffImageType(misaligned)).toBeNull();
    expect(sniffImageType(avifBytes().subarray(0, 15))).toBeNull();
    expect(sniffImageType(heicBytes())).toBeNull();
  });

  it("names familiar formats this app can't use", () => {
    expect(sniffOtherImageFormat(gifBytes())).toBe("GIF");
    expect(sniffOtherImageFormat(heicBytes())).toBe("HEIC");
    expect(sniffOtherImageFormat(emfBytes())).toBe("EMF");
    expect(sniffOtherImageFormat(Uint8Array.of(0xd7, 0xcd, 0xc6, 0x9a))).toBe("WMF");
    expect(sniffOtherImageFormat(Uint8Array.of(0x49, 0x49, 0x2a, 0x00))).toBe("TIFF");
    expect(sniffOtherImageFormat(text.encode(" <?xml version='1.0'?><svg>"))).toBe("SVG");
    expect(sniffOtherImageFormat(text.encode("plain text"))).toBeNull();
  });

  it("finds container signatures", () => {
    expect(hasPdfSignature(text.encode("%PDF-1.7"))).toBe(true);
    expect(hasPdfSignature(text.encode(`${" ".repeat(100)}%PDF-1.4`))).toBe(true);
    expect(hasPdfSignature(text.encode(`${" ".repeat(2000)}%PDF-1.4`))).toBe(false);
    expect(hasZipSignature(Uint8Array.of(0x50, 0x4b, 0x03, 0x04))).toBe(true);
    expect(hasZipSignature(pngBytes())).toBe(false);
  });
});
