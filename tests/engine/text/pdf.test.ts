import { describe, expect, it } from "vitest";

import { addAcceptedOcr, readTextFiles } from "../../../src/engine/text";
import { PdfPasswordError } from "../../../src/engine/pdf";
import { readFiles } from "../../../src/engine/text/read";
import {
  MAX_OCR_PAGES,
  MAX_OCR_PIXELS,
  readPdf,
  type OpenPdfPages,
  type RecognizeText,
} from "../../../src/engine/text/pdfText";
import type { OcrPassage } from "../../../src/engine/types";
import { encoder, OFF, textFile } from "./helpers";

const pdfBytes = () => encoder.encode("%PDF-1.7\n");

/** A fake PDF whose pages have the given text layers; pages are letter-sized by default. */
function fakePdf(
  pages: string[],
  events: string[] = [],
  size = { width: 612, height: 792 },
): OpenPdfPages {
  return async () => ({
    pageCount: pages.length,
    pageText: async (pageNumber) => pages[pageNumber - 1],
    pageSize: async () => size,
    renderPage: async (pageNumber, scale) => {
      events.push(`render ${pageNumber}${scale === 200 / 72 ? "" : ` at ${scale.toFixed(3)}`}`);
      return new Blob([`page ${pageNumber}`]);
    },
    close: async () => {
      events.push("close");
    },
  });
}

const recognizeAs =
  (text: string, seen: number[] = []): RecognizeText =>
  async (image) => {
    seen.push(Number((await image.text()).slice(5)));
    return { text, confidence: 91.5 };
  };

describe("PDF text", () => {
  it("reads pages in order, keeps line breaks, and notes pages without text", async () => {
    // Catches reordered pages, flattened lines, or one empty page failing the whole file.
    const events: string[] = [];
    const result = await readPdf(
      pdfBytes(),
      { name: "report.pdf", ocr: "off" },
      { open: fakePdf(["First\nline", "", "Third", ""], events) },
    );

    expect(result.text).toBe(
      "--- Page 1 ---\n\nFirst\nline\n\n--- Page 2 ---\n\n\n\n--- Page 3 ---\n\nThird\n\n--- Page 4 ---\n\n",
    );
    expect(result.notes).toEqual(["Pages 2 and 4 have no selectable text."]);
    expect(result.ocr).toEqual([]);
    expect(events).toEqual(["close"]);
  });

  it("gives plain reasons for password-protected, damaged, and textless PDFs", async () => {
    const failing =
      (error: Error): OpenPdfPages =>
      async () => {
        throw error;
      };
    await expect(
      readPdf(pdfBytes(), { name: "a.pdf", ocr: "off" }, { open: failing(new PdfPasswordError()) }),
    ).rejects.toThrow(/password-protected/);
    await expect(
      readPdf(
        pdfBytes(),
        { name: "a.pdf", ocr: "off" },
        {
          open: failing(Object.assign(new Error("secret detail"), { name: "InvalidPDFException" })),
        },
      ),
    ).rejects.toThrow("This PDF is damaged or isn't a real PDF.");
    await expect(
      readPdf(pdfBytes(), { name: "a.pdf", ocr: "off" }, { open: fakePdf(["", " "]) }),
    ).rejects.toThrow(/no selectable text.*turn on text recognition/);
  });

  it("closes the PDF even when a page fails", async () => {
    const events: string[] = [];
    const open: OpenPdfPages = async () => ({
      ...(await fakePdf(["a", "b"], events)(pdfBytes())),
      pageText: async () => {
        throw new Error("parser fault");
      },
    });

    await expect(readPdf(pdfBytes(), { name: "a.pdf", ocr: "off" }, { open })).rejects.toThrow(
      /couldn't be read/,
    );
    expect(events).toEqual(["close"]);
  });

  it("returns a PDF source through readTextFiles with text-layer text only", async () => {
    const result = await readFiles(
      [textFile("scan.pdf", pdfBytes())],
      { ocr: "pages-without-text" },
      {
        openPdf: fakePdf(["Native text", ""]),
        recognize: recognizeAs("Recognized words"),
      },
    );

    expect(result.sources[0]).toMatchObject({
      format: "pdf",
      path: "scan.pdf",
      extractedText: "--- Page 1 ---\n\nNative text\n\n--- Page 2 ---\n\n",
      ocr: [{ id: "ocr-page-2", label: "Page 2", text: "Recognized words", accepted: false }],
    });
  });

  it("rejects a PDF with no text as a file in a batch", async () => {
    const result = await readFiles([textFile("blank.pdf", pdfBytes())], OFF, {
      openPdf: fakePdf([""]),
    });
    expect(result.rejected[0].reason).toMatch(/no selectable text/);
  });
});

describe("PDF text recognition", () => {
  it("recognizes only pages without text, keeping results unaccepted and out of the text", async () => {
    // Catches OCR text being merged silently or pages with a text layer being sent to OCR.
    const seen: number[] = [];
    const result = await readPdf(
      pdfBytes(),
      { name: "scan.pdf", ocr: "pages-without-text" },
      { open: fakePdf(["Native", "", "Native", ""]), recognize: recognizeAs("Recognized", seen) },
    );

    expect(seen).toEqual([2, 4]);
    expect(result.ocr).toEqual([
      {
        id: "ocr-page-2",
        label: "Page 2",
        pageNumber: 2,
        text: "Recognized",
        confidence: 91.5,
        accepted: false,
      },
      {
        id: "ocr-page-4",
        label: "Page 4",
        pageNumber: 4,
        text: "Recognized",
        confidence: 91.5,
        accepted: false,
      },
    ]);
    expect(result.text).not.toContain("Recognized");
    expect(result.notes).toEqual([
      "Pages 2 and 4 have no selectable text.",
      "Text was recognized on pages 2 and 4. Review it to add it to the document.",
    ]);
  });

  it("recognizes every page in all-pages mode", async () => {
    const seen: number[] = [];
    await readPdf(
      pdfBytes(),
      { name: "a.pdf", ocr: "all-pages" },
      { open: fakePdf(["One", "Two"]), recognize: recognizeAs("x", seen) },
    );
    expect(seen).toEqual([1, 2]);
  });

  it(`stops after ${MAX_OCR_PAGES} pages without losing the text it already has`, async () => {
    // Catches a long scan starting unbounded OCR work.
    let calls = 0;
    const result = await readPdf(
      pdfBytes(),
      { name: "long.pdf", ocr: "all-pages" },
      {
        open: fakePdf(Array.from({ length: MAX_OCR_PAGES + 3 }, () => "text")),
        recognize: async () => {
          calls += 1;
          return { text: "candidate", confidence: 80 };
        },
      },
    );

    expect(calls).toBe(MAX_OCR_PAGES);
    expect(result.ocr).toHaveLength(MAX_OCR_PAGES);
    expect(result.notes).toContain(
      "Text recognition stops after 150 pages, so 3 pages weren't checked.",
    );
  });

  it("keeps the text layer when recognition fails, and rejects when there's nothing else", async () => {
    const broken: RecognizeText = async () => {
      throw new Error("worker failed to load");
    };
    const partial = await readPdf(
      pdfBytes(),
      { name: "a.pdf", ocr: "pages-without-text" },
      { open: fakePdf(["Native", ""]), recognize: broken },
    );
    expect(partial.ocr).toEqual([]);
    expect(partial.notes).toContain("Text recognition failed on page 2.");

    await expect(
      readPdf(
        pdfBytes(),
        { name: "a.pdf", ocr: "pages-without-text" },
        { open: fakePdf([""]), recognize: broken },
      ),
    ).rejects.toThrow(/text recognition didn't work/);
    await expect(
      readPdf(
        pdfBytes(),
        { name: "a.pdf", ocr: "pages-without-text" },
        { open: fakePdf([""]), recognize: recognizeAs("  ") },
      ),
    ).rejects.toThrow("No text was found in this PDF, even with text recognition.");
  });

  it("keeps recognizing the other pages when one page fails", async () => {
    // Catches one bad page ending recognition for the rest of the document.
    const recognize: RecognizeText = async (image) => {
      if ((await image.text()) === "page 2") throw new Error("couldn't read page 2");
      return { text: "Words", confidence: 90 };
    };
    const result = await readPdf(
      pdfBytes(),
      { name: "a.pdf", ocr: "all-pages" },
      { open: fakePdf(["", "", ""]), recognize },
    );
    expect(result.ocr.map((passage) => passage.pageNumber)).toEqual([1, 3]);
    expect(result.notes).toContain("Text recognition failed on page 2.");
  });

  it("gives up after three failures in a row", async () => {
    let calls = 0;
    const recognize: RecognizeText = async () => {
      calls += 1;
      throw new Error("worker failed to load");
    };
    const result = await readPdf(
      pdfBytes(),
      { name: "a.pdf", ocr: "all-pages" },
      { open: fakePdf(["a", "b", "c", "d", "e"]), recognize },
    );
    expect(calls).toBe(3);
    expect(result.notes).toContain(
      "Text recognition kept failing, so the remaining pages weren't checked.",
    );
  });

  it("draws poster-sized pages smaller for recognition", async () => {
    // Catches a huge page being rendered at 200 dpi into a canvas of hundreds of megapixels.
    const events: string[] = [];
    await readPdf(
      pdfBytes(),
      { name: "poster.pdf", ocr: "all-pages" },
      {
        open: fakePdf(["x"], events, { width: 72 * 48, height: 72 * 36 }),
        recognize: recognizeAs("x"),
      },
    );
    const scale = Number(events[0].split(" at ")[1]);
    expect(72 * 48 * scale * 72 * 36 * scale).toBeLessThanOrEqual(MAX_OCR_PIXELS * 1.001);
  });

  it("stops when canceled and still closes the PDF", async () => {
    const controller = new AbortController();
    const events: string[] = [];
    const recognize: RecognizeText = async () => {
      controller.abort();
      throw controller.signal.reason;
    };

    await expect(
      readPdf(
        pdfBytes(),
        { name: "a.pdf", ocr: "all-pages", signal: controller.signal },
        { open: fakePdf(["a", "b"], events), recognize },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(events).toEqual(["render 1", "close"]);
  });

  it("reports progress for pages and recognition", async () => {
    const labels: string[] = [];
    await readPdf(
      pdfBytes(),
      {
        name: "a.pdf",
        ocr: "pages-without-text",
        onProgress: (update) => labels.push(update.label),
      },
      { open: fakePdf(["a", ""]), recognize: recognizeAs("b") },
    );
    expect(labels).toEqual([
      "Reading a.pdf (page 1 of 2)",
      "Reading a.pdf (page 2 of 2)",
      "Recognizing text in a.pdf (page 2)",
    ]);
  });
});

describe("adding accepted OCR", () => {
  const passage = (page: number, text: string, accepted: boolean): OcrPassage => ({
    id: `ocr-page-${page}`,
    label: `Page ${page}`,
    pageNumber: page,
    text,
    confidence: 80,
    accepted,
  });

  it("puts accepted passages on their own pages and skips the rest", () => {
    // Catches recognized text landing out of page order, or unaccepted text joining the document.
    const text = "--- Page 1 ---\n\nIntro\n\n--- Page 2 ---\n\n\n\n--- Page 3 ---\n\nEnd";
    const composed = addAcceptedOcr(text, [
      passage(3, "Third", true),
      passage(2, "Second", true),
      passage(1, "Pending", false),
    ]);

    expect(composed).toBe(
      "--- Page 1 ---\n\nIntro\n\n--- Page 2 ---\n\nSecond\n\n--- Page 3 ---\n\nEnd\n\nThird",
    );
  });

  it("appends passages it can't place under their label", () => {
    expect(addAcceptedOcr("Text", [passage(9, "Nine", true)])).toBe(
      "Text\n\n--- Page 9 ---\n\nNine",
    );
  });

  it("is what readTextFiles callers use after review", async () => {
    // readTextFiles itself never adds OCR text; extractedText stays the text layer.
    const result = await readTextFiles([textFile("notes.txt", "x")], OFF);
    expect(result.sources[0].ocr).toEqual([]);
  });
});
