import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from "docx";
import { describe, expect, it } from "vitest";

import { readTextFiles } from "../../../src/engine/text";
import { MAX_FILE_BYTES, MAX_FILE_COUNT, readFiles } from "../../../src/engine/text/read";
import { sha256Hex } from "../../../src/engine/text/util";
import { bytesOf, encoder, OFF, ONE_PIXEL_PNG, textFile, zipFile } from "./helpers";

async function docxFile(name: string, children: Paragraph[]): Promise<File> {
  const document = new Document({ sections: [{ children }] });
  return new File([await Packer.toBlob(document)], name);
}

describe("standalone text files", () => {
  it("reads text by extension, case-insensitively, without trusting the MIME type", async () => {
    const result = await readTextFiles(
      [
        textFile("notes.TXT", "plain text", "application/pdf"),
        textFile("draft.MarkDown", "# Draft", ""),
        textFile("app.ts", "export const answer = 42;\n"),
      ],
      OFF,
    );

    expect(result.rejected).toEqual([]);
    expect(result.sources.map(({ format, languageId }) => ({ format, languageId }))).toEqual([
      { format: "text", languageId: "plaintext" },
      { format: "markdown", languageId: "markdown" },
      { format: "code", languageId: "typescript" },
    ]);
  });

  it("fills in every TextSource field, keeping the original bytes and their SHA-256", async () => {
    // Catches hashing the decoded text instead of the original, or losing the BOM in `original`.
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode("first\r\nsecond\r\n")]);
    const [source] = (await readTextFiles([textFile("source.json", bytes)], OFF)).sources;

    expect(source).toMatchObject({
      kind: "text",
      path: "source.json",
      projectId: null,
      format: "json",
      previewKind: "structured-data",
      byteCount: bytes.byteLength,
      sha256: await sha256Hex(bytes),
      extractedText: "first\r\nsecond\r\n",
      text: "first\r\nsecond\r\n",
      included: true,
      notes: [],
      assets: [],
      ocr: [],
    });
    expect(source.id).toMatch(/^text-/);
    expect(await bytesOf(source.original)).toEqual(Array.from(bytes));
  });

  it("matches the SHA-256 test vector", async () => {
    expect(await sha256Hex(encoder.encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("reads extensionless and unknown-extension files when their contents are text", async () => {
    // Catches an extension allowlist rejecting README, LICENSE, and similar files.
    const result = await readTextFiles(
      [
        textFile("README", "alpha\r\nbeta\r\n", "image/png"),
        textFile("notes.custom-format", "plain\ntext\n"),
      ],
      OFF,
    );

    expect(result.sources.map((source) => [source.path, source.format])).toEqual([
      ["README", "text"],
      ["notes.custom-format", "text"],
    ]);
  });

  it("rejects unreadable files with plain reasons", async () => {
    const result = await readTextFiles(
      [
        textFile("blank.txt", " \n\t "),
        textFile("empty.txt", ""),
        textFile("nul.md", new Uint8Array([65, 0, 66])),
        textFile("latin1.txt", new Uint8Array([0x63, 0x61, 0x66, 0xe9])),
        textFile("image.unknown", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2])),
        textFile("old.rtf", "{\\rtf1 hello}"),
      ],
      OFF,
    );

    expect(result.sources).toEqual([]);
    expect(result.rejected.map(({ name, reason }) => [name, reason])).toEqual([
      ["blank.txt", "This file has no text in it."],
      ["empty.txt", "This file is empty."],
      ["nul.md", expect.stringMatching(/isn't text/)],
      ["latin1.txt", expect.stringMatching(/UTF-8/)],
      ["image.unknown", expect.stringMatching(/isn't text/)],
      ["old.rtf", expect.stringMatching(/Rich Text/)],
    ]);
  });

  it("keeps input order and lets a smaller file fit after an oversized one is rejected", async () => {
    // Catches rejected files using up the batch's size or count allowance.
    const oversized = new Uint8Array(MAX_FILE_BYTES + 1).fill(65);
    const result = await readTextFiles(
      [textFile("too-large.txt", oversized), textFile("fits.txt", "ok")],
      OFF,
    );

    expect(result.rejected).toEqual([
      { name: "too-large.txt", reason: "This file is larger than 20 MB." },
    ]);
    expect(result.sources.map((source) => source.path)).toEqual(["fits.txt"]);
  });

  it(`accepts at most ${MAX_FILE_COUNT} files per call`, async () => {
    const files = Array.from({ length: MAX_FILE_COUNT + 1 }, (_, i) => textFile(`${i}.txt`, "x"));
    const result = await readTextFiles(files, OFF);

    expect(result.sources).toHaveLength(MAX_FILE_COUNT);
    expect(result.rejected).toEqual([
      { name: `${MAX_FILE_COUNT}.txt`, reason: expect.stringMatching(/Only 20 files/) },
    ]);
  });

  it("turns a failed browser read into a reason that leaks no details", async () => {
    const unreadable = {
      name: "unreadable.txt",
      size: 4,
      type: "text/plain",
      arrayBuffer: async () => {
        throw new Error("/private/uploaded-secret.txt unavailable");
      },
    } as unknown as File;
    const result = await readTextFiles([unreadable], OFF);

    expect(result.rejected[0].reason).toMatch(/couldn't be opened/);
    expect(result.rejected[0].reason).not.toMatch(/private|secret|unavailable/);
  });

  it("reports progress and stops when canceled", async () => {
    const progress: string[] = [];
    await readTextFiles([textFile("a.txt", "a")], {
      ocr: "off",
      onProgress: (update) => progress.push(update.label),
    });
    expect(progress).toEqual(["Reading a.txt", "Done"]);

    const controller = new AbortController();
    controller.abort();
    await expect(
      readTextFiles([textFile("a.txt", "a")], { ocr: "off", signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("Markdown pictures", () => {
  const imageBytes = new Uint8Array([137, 80, 78, 71, 10, 20, 30]);
  const encoded = btoa(String.fromCharCode(...imageBytes));

  it("moves data-URI pictures into assets and leaves a short reference in the text", async () => {
    // Catches base64 payloads bloating the text or losing the picture's place and label.
    const source = `Before\n\n![Calibration plot](data:image/png;base64,${encoded})\n\n![Again](data:image/png;base64,${encoded})\nAfter\n`;
    const [result] = (await readTextFiles([textFile("notes.md", source)], OFF)).sources;

    expect(result.extractedText).toMatch(
      /^Before\n\n!\[Calibration plot\]\(asset:(asset-[a-f0-9]{12})\)\n\n!\[Again\]\(asset:\1\)\nAfter\n$/,
    );
    expect(result.extractedText).not.toContain(encoded);
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({
      filename: "image-1.png",
      mimeType: "image/png",
      altText: "Calibration plot",
    });
    expect(await bytesOf(result.assets[0].bytes)).toEqual(Array.from(imageBytes));
    expect(result.notes.join(" ")).toMatch(/kept separately/);
    expect(await bytesOf(result.original)).toEqual(Array.from(encoder.encode(source)));
  });

  it("replaces unreadable embedded data with a placeholder and a note", async () => {
    const source = "![Doc](data:application/pdf;base64,AAAA) and ![Bad](data:image/png;base64,A)";
    const [result] = (await readTextFiles([textFile("notes.md", source)], OFF)).sources;

    expect(result.extractedText).toBe("[Picture left out: Doc] and [Picture left out: Bad]");
    expect(result.assets).toEqual([]);
    expect(result.notes).toEqual([
      "2 embedded pictures couldn't be read and were replaced with placeholders.",
    ]);
  });
});

describe("Word documents", () => {
  it("converts headings, emphasis, and pictures with mammoth and turndown", async () => {
    const file = await docxFile("report.docx", [
      new Paragraph({ text: "Results", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [
          new TextRun("See the "),
          new TextRun({ text: "figure", bold: true }),
          new TextRun("."),
        ],
      }),
      new Paragraph({
        children: [
          new ImageRun({
            type: "png",
            data: ONE_PIXEL_PNG,
            transformation: { width: 10, height: 10 },
            altText: { name: "chart", title: "Chart", description: "Calibration curve" },
          }),
        ],
      }),
    ]);
    const [source] = (await readTextFiles([file], OFF)).sources;

    expect(source).toMatchObject({
      format: "docx",
      languageId: "markdown",
      previewKind: "markdown",
    });
    expect(source.extractedText).toMatch(
      /^# Results\n\nSee the \*\*figure\*\*\.\n\n!\[Calibration curve\]\(asset:asset-[a-f0-9]{12}\)$/,
    );
    expect(source.assets).toHaveLength(1);
    expect(source.assets[0]).toMatchObject({ mimeType: "image/png", altText: "Calibration curve" });
    expect(await bytesOf(source.assets[0].bytes)).toEqual(Array.from(ONE_PIXEL_PNG));
    expect(await bytesOf(source.original)).toEqual(await bytesOf(file));
  });

  it("rejects files that aren't real Word documents", async () => {
    const genericZip = await zipFile("generic.docx", { "notes.txt": "not a Word package" });
    const result = await readTextFiles([genericZip, textFile("not-a-zip.docx", "plain text")], OFF);

    expect(result.rejected.map((rejection) => rejection.reason)).toEqual([
      expect.stringMatching(/couldn't be opened/),
      "This file is named .docx, but it isn't a Word document.",
    ]);
  });

  it("rejects a Word document with no text", async () => {
    const file = await docxFile("blank.docx", [new Paragraph({ text: "" })]);
    const result = await readTextFiles([file], OFF);
    expect(result.rejected).toEqual([
      { name: "blank.docx", reason: "This Word document has no text to rewrite." },
    ]);
  });
});

describe("PDF admission", () => {
  const openPdf = async () => ({
    pageCount: 1,
    pageText: async () => "Text",
    pageSize: async () => ({ width: 612, height: 792 }),
    renderPage: async () => new Blob(),
    close: async () => undefined,
  });

  it("accepts a %PDF- header that starts at byte 1023 but not at byte 1024", async () => {
    // Catches an off-by-one scan of the first KiB, where pdf.js looks for the header.
    const lastValid = new Uint8Array(1_028).fill(32);
    lastValid.set(encoder.encode("%PDF-"), 1_023);
    const firstInvalid = new Uint8Array(1_029).fill(32);
    firstInvalid.set(encoder.encode("%PDF-"), 1_024);
    const result = await readFiles(
      [textFile("last-valid.pdf", lastValid), textFile("first-invalid.pdf", firstInvalid)],
      OFF,
      { openPdf },
    );

    expect(result.sources.map((source) => [source.path, source.format])).toEqual([
      ["last-valid.pdf", "pdf"],
    ]);
    expect(result.rejected).toEqual([
      { name: "first-invalid.pdf", reason: "This file is named .pdf, but it isn't a PDF." },
    ]);
  });
});
