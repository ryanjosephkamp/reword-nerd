import { describe, expect, it } from "vitest";

import { estimateTokens, isSupportedTextName } from "../../../src/engine/text";
import { decodeText, textKindForName, unsupportedReason } from "../../../src/engine/text/formats";
import { encoder } from "./helpers";

describe("file names", () => {
  it("classifies markup, structured data, tables, config, style, query, and code extensions", () => {
    // Catches a known extension losing the language and preview the viewer and prompts rely on.
    const names = [
      "page.html",
      "feed.xml",
      "data.json",
      "events.jsonl",
      "events.ndjson",
      "table.csv",
      "table.tsv",
      "config.yaml",
      "config.toml",
      "app.ini",
      "theme.css",
      "query.sql",
      "app.tsx",
      "script.py",
      "build.sh",
      "paper.tex",
      "notes.MD",
    ];
    expect(names.map((name) => textKindForName(name))).toEqual([
      { format: "html", languageId: "html", previewKind: "markup" },
      { format: "xml", languageId: "xml", previewKind: "markup" },
      { format: "json", languageId: "json", previewKind: "structured-data" },
      { format: "jsonl", languageId: "jsonl", previewKind: "structured-data" },
      { format: "ndjson", languageId: "jsonl", previewKind: "structured-data" },
      { format: "csv", languageId: "csv", previewKind: "table" },
      { format: "tsv", languageId: "tsv", previewKind: "table" },
      { format: "yaml", languageId: "yaml", previewKind: "structured-data" },
      { format: "toml", languageId: "toml", previewKind: "structured-data" },
      { format: "ini", languageId: "ini", previewKind: "structured-data" },
      { format: "css", languageId: "css", previewKind: "code" },
      { format: "sql", languageId: "sql", previewKind: "code" },
      { format: "code", languageId: "typescriptreact", previewKind: "code" },
      { format: "code", languageId: "python", previewKind: "code" },
      { format: "code", languageId: "shellscript", previewKind: "code" },
      { format: "latex", languageId: "latex", previewKind: "latex" },
      { format: "markdown", languageId: "markdown", previewKind: "markdown" },
    ]);
  });

  it("tells supported names from unsupported ones", () => {
    // Catches the UI routing a Word file or project ZIP away from the text engine.
    for (const name of [
      "notes.txt",
      "paper.docx",
      "report.PDF",
      "project.zip",
      "README",
      ".gitignore",
    ]) {
      expect(isSupportedTextName(name)).toBe(true);
    }
    for (const name of ["photo.png", "old.doc", "sheet.xlsx", "archive.tar.gz", "data.custom"]) {
      expect(isSupportedTextName(name)).toBe(false);
    }
  });

  it("explains unsupported types in plain language", () => {
    expect(unsupportedReason("old.doc")).toMatch(/save it as \.docx/i);
    expect(unsupportedReason("sheet.xlsx")).toMatch(/csv/i);
    expect(unsupportedReason("photo.JPG")).toMatch(/image/i);
    expect(unsupportedReason("backup.tar.gz")).toMatch(/only \.zip/i);
    expect(unsupportedReason("notes.txt")).toBeUndefined();
  });
});

describe("safe decoding", () => {
  it("drops a leading byte-order mark but keeps line endings", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode("first\r\nsecond\r\n")]);
    expect(decodeText(bytes)).toEqual({ ok: true, text: "first\r\nsecond\r\n" });
  });

  it("refuses broken UTF-8, control characters, binary signatures, NUL bytes, and blank text", () => {
    // Catches binary or control-bearing bytes being treated as editable text.
    const cases: [Uint8Array, string][] = [
      [new Uint8Array([0xc3, 0x28]), "not-utf8"],
      [encoder.encode("alpha\u0001beta"), "control-characters"],
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "binary"],
      [new Uint8Array([65, 0, 66]), "binary"],
      [new Uint8Array([0xff, 0xfe, 65, 0]), "utf16"],
      [encoder.encode(" \n\t "), "empty"],
    ];
    for (const [bytes, problem] of cases) {
      expect(decodeText(bytes)).toEqual({ ok: false, problem });
    }
  });

  it("accepts text that merely starts like a binary signature", () => {
    // Catches a two-byte "PK" check rejecting a CSV whose first column is a primary key.
    expect(decodeText(encoder.encode("PK,name\n1,Ada\n"))).toMatchObject({ ok: true });
    expect(decodeText(encoder.encode("MZ is the author's initials.\n"))).toMatchObject({
      ok: true,
    });
    expect(decodeText(encoder.encode("Page one\fPage two\n"))).toMatchObject({ ok: true });
  });
});

describe("token estimates", () => {
  it("counts Unicode characters, not UTF-16 code units, and rounds up", () => {
    // Catches surrogate pairs doubling the estimate or floor rounding underestimating it.
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("😀😀😀😀")).toBe(1);
    expect(estimateTokens("😀😀😀😀a")).toBe(2);
  });
});
