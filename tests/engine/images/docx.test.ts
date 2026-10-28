import { createUnpackBudget } from "../../../src/engine/images/archive";
import { openZipArchive } from "../../../src/engine/zip";
import { readDocxPictures } from "../../../src/engine/images/docx";
import { IMAGE_LIMITS } from "../../../src/engine/images/limits";
import { docxBytes, pngBytes, zipBytes, type DocxOptions } from "../../fixtures/images/samples";

async function read(docx: DocxOptions) {
  return readDocxPictures(new Blob([await docxBytes(docx)]), {
    open: openZipArchive,
    budget: createUnpackBudget(),
  });
}

describe("readDocxPictures", () => {
  it("returns the media with exact bytes, in the order the document shows them", async () => {
    const first = pngBytes({ seed: 1 });
    const second = pngBytes({ seed: 2 });
    const { pictures, skipped } = await read({
      media: [
        ["image1.png", first],
        ["image2.png", second],
        ["image3.png", pngBytes({ seed: 3 })],
      ],
      // image3 is only in a header, so the body never mentions it.
      bodyOrder: ["image2.png", "image1.png"],
    });
    expect(pictures.map(({ path }) => path)).toEqual([
      "word/media/image2.png",
      "word/media/image1.png",
      "word/media/image3.png",
    ]);
    expect(pictures[0].bytes).toEqual(second);
    expect(skipped).toEqual([]);
  });

  it("isn't stopped by an embedded spreadsheet, which is itself a ZIP", async () => {
    const spreadsheet = await zipBytes([["xl/workbook.xml", new TextEncoder().encode("<w/>")]]);
    const { pictures } = await read({
      media: [["image1.png", pngBytes()]],
      extra: [["word/embeddings/Microsoft_Excel_Worksheet.xlsx", spreadsheet]],
    });
    expect(pictures).toHaveLength(1);
  });

  it("reports oversized media instead of failing the document", async () => {
    const { pictures, skipped } = await read({
      media: [
        ["image1.png", pngBytes({ byteLength: IMAGE_LIMITS.maxImageBytes + 1 })],
        ["image2.png", pngBytes()],
      ],
    });
    expect(pictures.map(({ path }) => path)).toEqual(["word/media/image2.png"]);
    expect(skipped).toEqual([
      expect.objectContaining({ path: "word/media/image1.png", problem: "too-large" }),
    ]);
  });

  it("returns no pictures for a document without any", async () => {
    expect((await read({ media: [] })).pictures).toEqual([]);
  });

  it("rejects a ZIP that isn't a Word file", async () => {
    await expect(
      read({ media: [["image1.png", pngBytes()]], withoutContentTypes: true }),
    ).rejects.toThrow("This file isn't a valid Word (.docx) file, or it's damaged.");
  });
});
