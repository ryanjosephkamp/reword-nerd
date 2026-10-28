// PDF text comes from the pdf.js text layer. Pages without selectable text can go through OCR;
// what it recognizes is kept apart as passages the user accepts before they join the text.
import { recognizeText } from "../ocr";
import { openPdf, PdfPasswordError, renderPdfPage } from "../pdf";
import type { OcrPassage, Progress } from "../types";
import { pagesHave, pagesPhrase, plural, ReadProblem } from "./util";

export const MAX_OCR_PAGES = 150;
/** About 200 dpi, which Tesseract reads well without huge page images. */
const OCR_SCALE = 200 / 72;
/** Poster-sized pages are drawn smaller so one page can't take gigabytes of memory. */
export const MAX_OCR_PIXELS = 12_000_000;
const MAX_OCR_SIDE = 8_000;
/** Recognition that fails this many pages in a row is broken, not just stuck on one page. */
const MAX_OCR_FAILURES_IN_A_ROW = 3;

export type OcrMode = "off" | "pages-without-text" | "all-pages";

/** The parts of a PDF the reader needs, so tests can supply pages without pdf.js. */
export interface PdfPages {
  pageCount: number;
  pageText(pageNumber: number): Promise<string>;
  /** The page's size in points (1/72 inch). */
  pageSize(pageNumber: number): Promise<{ width: number; height: number }>;
  renderPage(pageNumber: number, scale: number): Promise<Blob>;
  close(): Promise<void>;
}

export type OpenPdfPages = (bytes: Uint8Array<ArrayBuffer>) => Promise<PdfPages>;

export type RecognizeText = (
  image: Blob,
  signal?: AbortSignal,
) => Promise<{ text: string; confidence: number }>;

export const openPdfPages: OpenPdfPages = async (bytes) => {
  const pdf = await openPdf(bytes);
  return {
    pageCount: pdf.numPages,
    async pageText(pageNumber) {
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        return content.items
          .map((item) => ("str" in item ? `${item.str}${item.hasEOL ? "\n" : ""}` : ""))
          .join("");
      } finally {
        page.cleanup();
      }
    },
    async pageSize(pageNumber) {
      const page = await pdf.getPage(pageNumber);
      const { width, height } = page.getViewport({ scale: 1 });
      return { width, height };
    },
    renderPage: (pageNumber, scale) => renderPdfPage(pdf, pageNumber, scale),
    close: () => pdf.destroy(),
  };
};

/** The OCR scale for a page: about 200 dpi, reduced for very large pages. */
export function ocrScale(width: number, height: number): number {
  if (!(width > 0 && height > 0)) return OCR_SCALE;
  return Math.min(
    OCR_SCALE,
    Math.sqrt(MAX_OCR_PIXELS / (width * height)),
    MAX_OCR_SIDE / Math.max(width, height),
  );
}

export function pageMarker(pageNumber: number): string {
  return `--- Page ${pageNumber} ---`;
}

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];

/** pdf.js accepts a "%PDF-" header anywhere in the first KiB, as many real files need. */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  const lastStart = Math.min(bytes.length - PDF_SIGNATURE.length, 1_023);
  for (let offset = 0; offset <= lastStart; offset += 1) {
    if (PDF_SIGNATURE.every((byte, i) => bytes[offset + i] === byte)) return true;
  }
  return false;
}

function openProblem(error: unknown): ReadProblem {
  if (error instanceof PdfPasswordError) return new ReadProblem(error.message);
  const name = error instanceof Error ? error.name : "";
  if (name === "PasswordException") return new ReadProblem(new PdfPasswordError().message);
  if (name === "InvalidPDFException") {
    return new ReadProblem("This PDF is damaged or isn't a real PDF.");
  }
  return new ReadProblem("This PDF couldn't be read. It may be damaged.");
}

export interface PdfReadOptions {
  name: string;
  ocr: OcrMode;
  signal?: AbortSignal;
  onProgress?: (progress: Progress) => void;
}

export interface PdfAdapters {
  open?: OpenPdfPages;
  recognize?: RecognizeText;
}

export interface PdfText {
  /** The text layer only, one `--- Page N ---` section per page. */
  text: string;
  ocr: OcrPassage[];
  notes: string[];
}

interface OcrRun {
  passages: OcrPassage[];
  /** Pages where OCR found text, in order. */
  recognized: number[];
  /** Pages that went through OCR and came back empty. */
  empty: number[];
  /** Pages recognition failed on. */
  failedPages: number[];
  skipped: number;
  /** True when recognition kept failing and the rest of the pages weren't tried. */
  stopped: boolean;
}

async function recognizePages(
  pdf: PdfPages,
  pages: number[],
  options: PdfReadOptions,
  recognize: RecognizeText,
): Promise<OcrRun> {
  const run: OcrRun = {
    passages: [],
    recognized: [],
    empty: [],
    failedPages: [],
    skipped: 0,
    stopped: false,
  };
  let failuresInARow = 0;
  const selected = pages.slice(0, MAX_OCR_PAGES);
  run.skipped = pages.length - selected.length;
  for (const [index, pageNumber] of selected.entries()) {
    options.signal?.throwIfAborted();
    options.onProgress?.({
      label: `Recognizing text in ${options.name} (page ${pageNumber})`,
      completed: index,
      total: selected.length,
    });
    let result: { text: string; confidence: number };
    try {
      const { width, height } = await pdf.pageSize(pageNumber);
      const image = await pdf.renderPage(pageNumber, ocrScale(width, height));
      result = await recognize(image, options.signal);
      failuresInARow = 0;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      // One page that can't be drawn or read shouldn't stop the others.
      run.failedPages.push(pageNumber);
      failuresInARow += 1;
      if (failuresInARow >= MAX_OCR_FAILURES_IN_A_ROW && index < selected.length - 1) {
        run.stopped = true;
        break;
      }
      continue;
    }
    const text = result.text.trim();
    if (!text) {
      run.empty.push(pageNumber);
      continue;
    }
    run.recognized.push(pageNumber);
    run.passages.push({
      id: `ocr-page-${pageNumber}`,
      label: `Page ${pageNumber}`,
      pageNumber,
      text,
      confidence: Math.max(0, Math.min(100, result.confidence)),
      accepted: false,
    });
  }
  return run;
}

function pdfNotes(textless: number[], run: OcrRun | null): string[] {
  const notes: string[] = [];
  if (textless.length > 0) notes.push(`${pagesHave(textless)} no selectable text.`);
  if (run) {
    if (run.recognized.length > 0) {
      notes.push(
        `Text was recognized on ${pagesPhrase(run.recognized)}. Review it to add it to the document.`,
      );
    }
    const emptyTextless = run.empty.filter((page) => textless.includes(page));
    if (emptyTextless.length > 0) {
      notes.push(`No text was found on ${pagesPhrase(emptyTextless)}, even with text recognition.`);
    }
    if (run.skipped > 0) {
      notes.push(
        `Text recognition stops after ${MAX_OCR_PAGES} pages, so ${plural(run.skipped, "page wasn't", "pages weren't")} checked.`,
      );
    }
    if (run.failedPages.length > 0) {
      notes.push(`Text recognition failed on ${pagesPhrase(run.failedPages)}.`);
    }
    if (run.stopped) {
      notes.push("Text recognition kept failing, so the remaining pages weren't checked.");
    }
  }
  return notes;
}

export async function readPdf(
  bytes: Uint8Array<ArrayBuffer>,
  options: PdfReadOptions,
  adapters: PdfAdapters = {},
): Promise<PdfText> {
  if (!hasPdfSignature(bytes)) {
    throw new ReadProblem("This file is named .pdf, but it isn't a PDF.");
  }
  let pdf: PdfPages;
  try {
    pdf = await (adapters.open ?? openPdfPages)(bytes);
  } catch (error) {
    throw openProblem(error);
  }

  try {
    const total = pdf.pageCount;
    if (total === 0) throw new ReadProblem("This PDF has no pages.");
    const sections: string[] = [];
    const textless: number[] = [];
    for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
      options.signal?.throwIfAborted();
      options.onProgress?.({
        label: `Reading ${options.name} (page ${pageNumber} of ${total})`,
        completed: pageNumber - 1,
        total,
      });
      let pageText: string;
      try {
        pageText = await pdf.pageText(pageNumber);
      } catch (error) {
        if (options.signal?.aborted) throw error;
        throw openProblem(error);
      }
      if (!pageText.trim()) textless.push(pageNumber);
      sections.push(`${pageMarker(pageNumber)}\n\n${pageText}`);
    }

    const ocrPages =
      options.ocr === "all-pages"
        ? Array.from({ length: total }, (_, i) => i + 1)
        : options.ocr === "pages-without-text"
          ? textless
          : [];
    const run =
      ocrPages.length > 0
        ? await recognizePages(pdf, ocrPages, options, adapters.recognize ?? recognizeText)
        : null;

    if (textless.length === total && !run?.passages.length) {
      if (options.ocr === "off") {
        throw new ReadProblem(
          "This PDF has no selectable text. It may be a scan; turn on text recognition to read it.",
        );
      }
      throw new ReadProblem(
        run && run.failedPages.length > 0
          ? "This PDF has no selectable text, and text recognition didn't work in this browser."
          : "No text was found in this PDF, even with text recognition.",
      );
    }

    const notes = pdfNotes(textless, run);
    return { text: sections.join("\n\n"), ocr: run?.passages ?? [], notes };
  } finally {
    await pdf.close().catch(() => undefined);
  }
}

/**
 * Adds accepted OCR passages to PDF text, each at the end of its own page section. Passages
 * that can't be placed go at the end under their label.
 */
export function addAcceptedOcr(extractedText: string, passages: readonly OcrPassage[]): string {
  let text = extractedText;
  const unplaced: OcrPassage[] = [];
  for (const passage of passages) {
    if (!passage.accepted || !passage.text.trim()) continue;
    const page = passage.pageNumber;
    const marker = page ? `${pageMarker(page)}\n\n` : "";
    const start = marker ? text.indexOf(marker) : -1;
    if (start < 0) {
      unplaced.push(passage);
      continue;
    }
    const bodyStart = start + marker.length;
    const next = text.indexOf("\n\n--- Page ", bodyStart);
    const bodyEnd = next < 0 ? text.length : next;
    const body = text.slice(bodyStart, bodyEnd).trimEnd();
    const merged = body.trim() ? `${body}\n\n${passage.text.trim()}` : passage.text.trim();
    text = `${text.slice(0, bodyStart)}${merged}${text.slice(bodyEnd)}`;
  }
  const extra = unplaced.map((passage) => `--- ${passage.label} ---\n\n${passage.text.trim()}`);
  return [text, ...extra].join("\n\n");
}
