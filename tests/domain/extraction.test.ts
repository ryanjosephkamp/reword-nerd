import { describe, expect, it } from "vitest";

const encoder = new TextEncoder();

function upload(name: string, bytes: Uint8Array, type = "application/octet-stream"): File {
  return {
    name,
    size: bytes.byteLength,
    type,
    arrayBuffer: async () => bytes.slice().buffer,
  } as File;
}

describe("file admission", () => {
  it("accepts supported extensions case-insensitively while ignoring MIME type", async () => {
    // This catches trusting File.type instead of the intended extension and byte contract.
    const extraction = await import("../../src/domain/extraction");

    const results = await extraction.preflightFiles([
      upload("notes.TXT", encoder.encode("plain text"), "application/pdf"),
      upload("draft.MarkDown", encoder.encode("# Draft"), ""),
    ]);

    expect(results.map((result) => result.accepted && result.format)).toEqual(["text", "markdown"]);
  });

  it("keeps input order and lets a smaller later file fit after an oversized rejection", async () => {
    // This catches rejected uploads incorrectly consuming aggregate capacity or being reordered.
    const extraction = await import("../../src/domain/extraction");
    const oversized = new Uint8Array(extraction.MAX_FILE_BYTES + 1);
    oversized[0] = 65;

    const results = await extraction.preflightFiles([
      upload("too-large.txt", oversized),
      upload("fits.txt", encoder.encode("ok")),
    ]);

    expect(results.map((result) => result.file.name)).toEqual(["too-large.txt", "fits.txt"]);
    expect(results[0]).toMatchObject({ accepted: false, issue: { code: "FILE_TOO_LARGE" } });
    expect(results[1]).toMatchObject({ accepted: true, format: "text" });
  });

  it("uses existing accepted totals and produces stable safe rejected issues", async () => {
    // This catches capacity checks that ignore the current workspace or leak file details in errors.
    const extraction = await import("../../src/domain/extraction");

    const results = await extraction.preflightFiles(
      [upload("unsupported.rtf", encoder.encode("hello")), upload("one.txt", encoder.encode("hello"))],
      { acceptedCount: extraction.MAX_FILE_COUNT, acceptedBytes: extraction.MAX_TOTAL_BYTES - 5 },
    );

    expect(results[0]).toMatchObject({ accepted: false, issue: { code: "UNSUPPORTED_EXTENSION" } });
    expect(results[1]).toMatchObject({ accepted: false, issue: { code: "MAX_FILE_COUNT" } });
    for (const result of results) {
      if (!result.accepted) {
        expect(result.issue.message).not.toMatch(/unsupported\.rtf|one\.txt|hello|stack|error:/i);
      }
    }
  });

  it("returns a typed safe issue when browser file reading fails", async () => {
    // This catches rejected File reads exposing implementation or filesystem details to the UI.
    const extraction = await import("../../src/domain/extraction");
    const unreadable = {
      name: "unreadable.txt",
      size: 4,
      type: "text/plain",
      arrayBuffer: async () => { throw new Error("/private/uploaded-secret.txt unavailable"); },
    } as unknown as File;

    const [result] = await extraction.preflightFiles([unreadable]);

    expect(result).toMatchObject({ accepted: false, issue: { code: "FILE_READ_FAILED" } });
    if (!result.accepted) expect(result.issue.message).not.toMatch(/private|secret|unavailable/i);
  });

  it("rejects blank, NUL-containing, and malformed UTF-8 text without accepting their bytes", async () => {
    // This catches permissive decoding that turns unusable or binary text into reviewable text.
    const extraction = await import("../../src/domain/extraction");

    const results = await extraction.preflightFiles([
      upload("blank.txt", encoder.encode(" \n\t ")),
      upload("nul.md", new Uint8Array([65, 0, 66])),
      upload("malformed.txt", new Uint8Array([0xc3, 0x28])),
      upload("bom.txt", new Uint8Array([0xef, 0xbb, 0xbf, 65])),
    ]);

    expect(results.map((result) => result.accepted ? "accepted" : result.issue.code)).toEqual([
      "EMPTY_CONTENT",
      "EMPTY_CONTENT",
      "INVALID_UTF8",
      "accepted",
    ]);
  });

  it("requires a PDF signature in its first KiB and validates DOCX OOXML package entries", async () => {
    // This catches extension-only admission of mislabeled PDFs and arbitrary ZIP archives.
    const extraction = await import("../../src/domain/extraction");
    const JSZip = (await import("jszip")).default;
    const validDocx = new JSZip();
    validDocx.file("[Content_Types].xml", "<Types />");
    validDocx.file("word/document.xml", "<w:document />");
    const genericZip = new JSZip();
    genericZip.file("notes.txt", "not a Word package");

    const results = await extraction.preflightFiles([
      upload("late.pdf", new Uint8Array(1_025).fill(32)),
      upload("valid.docx", await validDocx.generateAsync({ type: "uint8array" })),
      upload("generic.docx", await genericZip.generateAsync({ type: "uint8array" })),
      upload("not-a-zip.docx", encoder.encode("plain text")),
    ]);

    expect(results.map((result) => result.accepted ? "accepted" : result.issue.code)).toEqual([
      "SIGNATURE_MISMATCH",
      "accepted",
      "INVALID_DOCX",
      "SIGNATURE_MISMATCH",
    ]);
  });

  it("accepts a PDF signature starting at byte 1023 but rejects one starting at byte 1024", async () => {
    // This catches an off-by-one scan that admits headers after the first KiB or rejects its final valid start.
    const extraction = await import("../../src/domain/extraction");
    const atLastValidStart = new Uint8Array(1_028).fill(32);
    atLastValidStart.set(encoder.encode("%PDF-"), 1_023);
    const atFirstInvalidStart = new Uint8Array(1_029).fill(32);
    atFirstInvalidStart.set(encoder.encode("%PDF-"), 1_024);

    const results = await extraction.preflightFiles([
      upload("last-valid.pdf", atLastValidStart),
      upload("first-invalid.pdf", atFirstInvalidStart),
    ]);

    expect(results.map((result) => result.accepted ? "accepted" : result.issue.code)).toEqual([
      "accepted",
      "SIGNATURE_MISMATCH",
    ]);
  });

  it("accepts exact byte limits but rejects the next byte without consuming rejected capacity", async () => {
    // This catches off-by-one size gates and aggregate accounting that blocks later valid uploads.
    const extraction = await import("../../src/domain/extraction");
    const exact = new Uint8Array(extraction.MAX_FILE_BYTES).fill(65);

    const results = await extraction.preflightFiles(
      [upload("exact.txt", exact), upload("one.txt", encoder.encode("x"))],
      { acceptedBytes: extraction.MAX_TOTAL_BYTES - extraction.MAX_FILE_BYTES },
    );

    expect(results.map((result) => result.accepted ? "accepted" : result.issue.code)).toEqual([
      "accepted",
      "TOTAL_TOO_LARGE",
    ]);
  });
});

describe("browser-compatible hashing", () => {
  it("hashes the SHA-256 abc browser vector", async () => {
    // This catches a browser digest algorithm or encoding mismatch in the production hash adapter.
    const extraction = await import("../../src/domain/extraction");

    await expect(extraction.hashBytes(encoder.encode("abc").buffer)).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes bytes with an injected digest implementation and uses lowercase hexadecimal", async () => {
    // This catches byte-to-hex conversion errors that would break cross-browser duplicate matching.
    const extraction = await import("../../src/domain/extraction");
    const digest = new Uint8Array(32);
    digest[0] = 0xba;
    digest[31] = 0xff;

    await expect(extraction.hashBytes(encoder.encode("abc").buffer, {
      digest: async () => digest.buffer,
    })).resolves.toBe(`ba${"00".repeat(30)}ff`);
  });

  it("turns unavailable browser hashing into a typed safe error", async () => {
    // This catches a missing Web Crypto implementation leaking a TypeError into the UI.
    const extraction = await import("../../src/domain/extraction");

    await expect(extraction.hashBytes(encoder.encode("abc").buffer, null)).rejects.toMatchObject({
      issue: { code: "HASH_UNAVAILABLE" },
    });
  });

  it("turns digest failures into the same typed safe error", async () => {
    // This catches platform digest failures leaking provider-specific exception detail.
    const extraction = await import("../../src/domain/extraction");

    await expect(extraction.hashBytes(encoder.encode("abc").buffer, {
      digest: async () => { throw new Error("browser provider failure"); },
    })).rejects.toMatchObject({ issue: { code: "HASH_UNAVAILABLE" } });
  });

  it("rejects injected digests that are not exactly 32 bytes", async () => {
    // This catches malformed digest adapters producing non-SHA-256 hashes that cannot remain 64 hex characters.
    const extraction = await import("../../src/domain/extraction");

    for (const length of [31, 33]) {
      await expect(extraction.hashBytes(encoder.encode("abc").buffer, {
        digest: async () => new Uint8Array(length).buffer,
      })).rejects.toMatchObject({ issue: { code: "HASH_UNAVAILABLE" } });
    }
  });
});

const simpleHasher = {
  digest: async (bytes: ArrayBuffer) => {
    const output = new Uint8Array(32);
    output[0] = new Uint8Array(bytes)[0] ?? 0;
    return output.buffer;
  },
};

describe("extraction and review state", () => {
  it("extracts text, records duplicate originals, and keeps duplicate files review-required", async () => {
    // This catches duplicate suppression or marking unreviewed extraction as ready.
    const extraction = await import("../../src/domain/extraction");
    const accepted = (await extraction.preflightFiles([upload("note.txt", encoder.encode("original"))]))[0];
    if (!accepted.accepted) throw new Error("fixture should be accepted");

    const result = await extraction.extractFile(accepted, {
      hasher: simpleHasher,
      existingDocuments: [{ id: "first", originalHash: `6f${"00".repeat(31)}` }],
    });

    expect(result).toMatchObject({
      format: "text",
      extractedText: "original",
      originalHash: `6f${"00".repeat(31)}`,
      extractedTextHash: `6f${"00".repeat(31)}`,
      duplicateOf: "first",
      requiresReview: true,
    });
    expect(result.warnings.join(" ")).toMatch(/duplicate/i);
  });

  it("edits and confirms extraction immutably without altering warnings or context acknowledgment", async () => {
    // This catches review edits mutating prior state or accidentally clearing independent warnings.
    const extraction = await import("../../src/domain/extraction");
    const original = {
      format: "text" as const,
      extractedText: "old text",
      warnings: ["Conversion note"],
      originalHash: `01${"00".repeat(31)}`,
      extractedTextHash: `6f${"00".repeat(31)}`,
      requiresReview: true as const,
    };

    const edited = await extraction.editExtractedText(original, "new text", simpleHasher);
    const confirmed = extraction.confirmExtractionReview(edited);

    expect(edited).not.toBe(original);
    expect(edited).toMatchObject({
      extractedText: "new text",
      extractedTextHash: `6e${"00".repeat(31)}`,
      originalHash: original.originalHash,
      warnings: ["Conversion note"],
      requiresReview: true,
    });
    expect(original).toMatchObject({ extractedText: "old text", requiresReview: true });
    expect(confirmed).toMatchObject({
      extractedText: "new text",
      extractedTextHash: edited.extractedTextHash,
      warnings: ["Conversion note"],
      requiresReview: false,
    });
  });
});

describe("PDF adapter core", () => {
  it("extracts pages in order, honors line endings, and warns only about partial textlessness", async () => {
    // This catches page reordering, flattened lines, or treating one empty page as a hard failure.
    const extraction = await import("../../src/domain/extraction");
    const destroyed: string[] = [];
    const result = await extraction.extractPdfWithAdapter(new Uint8Array([1]), {
      load: () => ({
        promise: Promise.resolve({
          numPages: 3,
          getPage: async (pageNumber: number) => ({
            getTextContent: async () => ({
              items: pageNumber === 1
                ? [{ str: "First", hasEOL: true }, { str: "line" }]
                : pageNumber === 2 ? [] : [{ str: "Third" }],
            }),
          }),
          destroy: () => { destroyed.push("document"); },
        }),
        destroy: () => { destroyed.push("loading"); },
      }),
    });

    expect(result.text).toBe("--- Page 1 ---\n\nFirst\nline\n\n--- Page 2 ---\n\n\n\n--- Page 3 ---\n\nThird");
    expect(result.warnings).toEqual(["Pages 2 do not contain selectable text."]);
    expect(destroyed).toEqual(["document", "loading"]);
  });

  it("classifies encrypted, invalid, generic, and fully textless PDFs safely while cleaning up", async () => {
    // This catches low-level parser errors escaping or resources surviving rejected PDF requests.
    const extraction = await import("../../src/domain/extraction");
    const bytes = new Uint8Array([1]);
    for (const [name, expected] of [
      ["PasswordException", "PDF_ENCRYPTED"],
      ["InvalidPDFException", "PDF_INVALID"],
      ["FormatError", "PDF_INVALID"],
      ["UnexpectedParserFault", "PDF_EXTRACTION_FAILED"],
    ]) {
      const loadingDestroyed: string[] = [];
      await expect(extraction.extractPdfWithAdapter(bytes, {
        load: () => ({
          promise: Promise.reject(Object.assign(new Error("secret parser detail"), { name })),
          destroy: () => { loadingDestroyed.push("loading"); },
        }),
      })).rejects.toMatchObject({ issue: { code: expected } });
      expect(loadingDestroyed).toEqual(["loading"]);
    }

    const documentDestroyed: string[] = [];
    await expect(extraction.extractPdfWithAdapter(bytes, {
      load: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => ({ getTextContent: async () => ({ items: [] }) }),
          destroy: () => { documentDestroyed.push("document"); },
        }),
        destroy: () => { documentDestroyed.push("loading"); },
      }),
    })).rejects.toMatchObject({ issue: { code: "PDF_TEXTLESS" } });
    expect(documentDestroyed).toEqual(["document", "loading"]);
  });

  it("does not let a cleanup failure replace a safe PDF extraction issue", async () => {
    // This catches finally cleanup leaking its own low-level error after a parser failure.
    const extraction = await import("../../src/domain/extraction");

    await expect(extraction.extractPdfWithAdapter(new Uint8Array([1]), {
      load: () => ({
        promise: Promise.reject(Object.assign(new Error("parser secret"), { name: "InvalidPDFException" })),
        destroy: () => { throw new Error("/private/cleanup secret"); },
      }),
    })).rejects.toMatchObject({ issue: { code: "PDF_INVALID" } });
  });
});

describe("DOCX conversion", () => {
  it("converts Mammoth HTML to deterministic GFM for headings, nested lists, links, tables, and task items", async () => {
    // This catches a plain HTML pass-through or a Markdown converter missing GFM table/task behavior.
    const extraction = await import("../../src/domain/extraction");
    const markdown = extraction.htmlToGfm(`
      <h1>Heading</h1><ul><li>Parent<ul><li>Child</li></ul></li></ul>
      <p><a href="https://example.com">Reference</a> and <del>removed</del></p>
      <table><thead><tr><th>One</th><th>Two</th></tr></thead><tbody><tr><td>A</td><td>B</td></tr></tbody></table>
      <ul data-task-list><li data-task-list-item><input type="checkbox" checked> Done</li></ul>
    `);

    expect(markdown).toContain("# Heading");
    expect(markdown).toMatch(/[-*]\s+Parent\n\s+[-*]\s+Child/);
    expect(markdown).toContain("[Reference](https://example.com)");
    expect(markdown).toContain("~~removed~~");
    expect(markdown).toMatch(/\| One \| Two \|/);
    expect(markdown).toMatch(/\[x\]\s+Done/i);
  });

  it("uses safe Mammoth browser options and maps warning and error messages safely", async () => {
    // This catches embedded styles or external access being re-enabled and parser detail leaking into review state.
    const extraction = await import("../../src/domain/extraction");
    const optionsSeen: unknown[] = [];
    const result = await extraction.extractDocxWithAdapter(encoder.encode("docx").buffer, {
      convertToHtml: async (_input, options) => {
        optionsSeen.push(options);
        return {
          value: "<h2>Converted</h2>",
          messages: [{ type: "warning", message: "Style mapping\nfor /private/report.docx" }],
        };
      },
    });

    expect(optionsSeen).toHaveLength(1);
    expect(optionsSeen[0]).toMatchObject({
      styleMap: [],
      includeEmbeddedStyleMap: false,
      externalFileAccess: false,
      ignoreEmptyParagraphs: false,
    });
    expect((optionsSeen[0] as { convertImage?: unknown }).convertImage).toBeTypeOf("function");
    expect(result.markdown).toBe("## Converted");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/^DOCX conversion warning:/);
    expect(result.warnings[0]).not.toMatch(/[\n\r]|\/private|report\.docx/);

    await expect(extraction.extractDocxWithAdapter(encoder.encode("docx").buffer, {
      convertToHtml: async () => ({
        value: "<p>never used</p>",
        messages: [{ type: "error", message: "raw parser detail" }],
      }),
    })).rejects.toMatchObject({ issue: { code: "DOCX_CONVERSION_FAILED" } });
  });

  it("rejects empty, whitespace-only, and image-only DOCX conversion output as empty content", async () => {
    // This catches apparently successful DOCX conversion creating reviewable documents with no prompt-safe text.
    const extraction = await import("../../src/domain/extraction");

    for (const value of ["", " \n\t ", '<img src="data:image/png;base64,secret-bytes" alt="diagram">']) {
      await expect(extraction.extractDocxWithAdapter(encoder.encode("docx").buffer, {
        convertToHtml: async () => ({ value, messages: [] }),
      })).rejects.toMatchObject({ issue: { code: "EMPTY_CONTENT" } });
    }
  });

  it("omits uncontrolled DOCX image markup from Markdown and warns when text remains", async () => {
    // This catches converter-bypassing data images entering prompts instead of a bounded review warning.
    const extraction = await import("../../src/domain/extraction");
    const result = await extraction.extractDocxWithAdapter(encoder.encode("docx").buffer, {
      convertToHtml: async () => ({
        value: '<p>Keep this text.</p><img src="data:image/png;base64,secret-bytes" alt="diagram">',
        messages: [],
      }),
    });

    expect(result.markdown).toBe("Keep this text.");
    expect(result.markdown).not.toMatch(/img|data:image|secret-bytes/i);
    expect(result.warnings).toEqual(["An embedded image was omitted from DOCX extraction."]);
  });
});
