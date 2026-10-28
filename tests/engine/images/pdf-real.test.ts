// @vitest-environment node
// Runs the PDF picture walker against real, unmodified pdf.js. jsdom can't host pdf.js, but
// its legacy build runs in Node, where it hands over raw pixels instead of bitmaps.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  PAINT_OPS,
  PIXEL_KIND,
  readPdfPictures,
  toRgba,
  type PdfFile,
  type PdfImageData,
  type PdfPicture,
} from "../../../src/engine/images/pdfImages";
import { readImages } from "../../../src/engine/images/reader";
import { fakeDecoder, pdfBytes } from "../../fixtures/images/samples";

async function openWithPdfjs(bytes: Uint8Array): Promise<PdfFile> {
  const pdf = await pdfjs.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
    disableFontFace: true,
  }).promise;
  return {
    numPages: pdf.numPages,
    getPage: (pageNumber) => pdf.getPage(pageNumber),
    renderPage: async () => {
      throw new Error("Node has no canvas here.");
    },
    destroy: () => pdf.destroy(),
  };
}

const encodeRaw = async (image: PdfImageData) => new Blob([toRgba(image)], { type: "image/png" });

async function rgbaOf(picture: PdfPicture): Promise<number[]> {
  return Array.from(new Uint8Array(await picture.image.arrayBuffer()));
}

describe("PDF pictures with real pdf.js", () => {
  it("uses pdf.js's own operator and pixel codes", () => {
    expect(PAINT_OPS).toEqual({
      paintImageXObject: pdfjs.OPS.paintImageXObject,
      paintInlineImageXObject: pdfjs.OPS.paintInlineImageXObject,
      paintImageXObjectRepeat: pdfjs.OPS.paintImageXObjectRepeat,
    });
    expect(PIXEL_KIND).toEqual({
      grayscale1Bit: pdfjs.ImageKind.GRAYSCALE_1BPP,
      rgb: pdfjs.ImageKind.RGB_24BPP,
      rgba: pdfjs.ImageKind.RGBA_32BPP,
    });
  });

  it("finds each painted picture, skips the tiny one, and keeps exact pixels", async () => {
    const pictures: PdfPicture[] = [];
    const summary = await readPdfPictures(pdfBytes(), {
      mode: "embedded-images",
      open: openWithPdfjs,
      encode: encodeRaw,
      onPicture: async (picture) => {
        pictures.push(picture);
        return true;
      },
    });
    expect(pictures.map(({ name, width, height }) => `${name} ${width}x${height}`)).toEqual([
      "page-1-image-1.png 80x60",
      "page-1-image-2.png 48x48",
      "page-1-image-3.png 40x40",
      "page-2-image-1.png 80x60",
      "page-3-image-1.png 80x60",
    ]);
    expect(summary.leftOut.phrases()).toEqual([
      "left out 1 picture (too small to use, under 32 pixels on a side)",
    ]);
    // Pages 2 and 3 share one decoded picture, converted once.
    expect(pictures[3].image).toBe(pictures[4].image);

    const [rgb, oneBit, inline] = await Promise.all(pictures.slice(0, 3).map(rgbaOf));
    expect(rgb.slice(0, 8)).toEqual([0, 7, 14, 255, 21, 28, 35, 255]);
    expect(oneBit.slice(0, 8)).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
    expect(inline.slice(0, 4)).toEqual([200, 200, 200, 255]);
    expect(await rgbaOf(pictures[3])).toEqual(rgb);
  });

  it("adds the repeated picture once, with a note saying where else it appears", async () => {
    const { images, rejected } = await readImages(
      [{ name: "report.pdf", file: new Blob([pdfBytes()]) }],
      { pdf: "embedded-images" },
      {
        decode: fakeDecoder,
        openZip: async () => {
          throw new Error("unused");
        },
        openPdf: openWithPdfjs,
        encodePdfImage: encodeRaw,
        createId: () => "id",
      },
    );
    expect(rejected).toEqual([]);
    expect(images.map(({ name }) => name)).toEqual([
      "page-1-image-1.png",
      "page-1-image-2.png",
      "page-1-image-3.png",
    ]);
    expect(images[0].from).toEqual({ container: "report.pdf", pageNumber: 1 });
    expect(images[0].notes).toEqual([
      "This picture is small and may be decorative.",
      "report.pdf: left out 1 picture (too small to use, under 32 pixels on a side).",
      "Found 2 more copies of this picture (report.pdf, page 2; report.pdf, page 3); " +
        "it was added once.",
    ]);
    expect(images[2].notes).toEqual(["This picture is small and may be decorative."]);
  });
});
