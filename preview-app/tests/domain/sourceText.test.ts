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

describe("safe standalone text sources", () => {
  it("classifies known markup, structured-data, tabular, config, style, query, and code extensions", async () => {
    // This catches a known text extension losing the language and preview behavior its viewer and prompts consume.
    const sourceText = await import("../../src/domain");
    const classify = (sourceText as unknown as {
      classifyStandaloneTextName?: (name: string) => unknown;
    }).classifyStandaloneTextName;

    expect(classify).toBeTypeOf("function");

    expect([
      "page.html", "feed.xml", "data.json", "events.jsonl", "events.ndjson",
      "table.csv", "table.tsv", "config.yaml", "config.toml", "app.ini",
      "theme.css", "query.sql", "app.tsx", "script.py", "build.sh",
    ].map((name) => classify?.(name))).toEqual([
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
    ]);
  });

  it("admits extensionless and unknown complete UTF-8 text without trusting MIME", async () => {
    // This catches extension or MIME allowlists rejecting reviewable text before complete bounded bytes are inspected.
    const extraction = await import("../../src/domain/extraction");
    const results = await extraction.preflightFiles([
      upload("README", encoder.encode("alpha\r\nbeta\r\n"), "image/png"),
      upload("notes.custom-format", encoder.encode("plain\ntext\n"), "application/x-executable"),
    ]);

    expect(results.map((result) => result.accepted && {
      format: result.format,
      languageId: result.languageId,
      previewKind: result.previewKind,
      bytes: [...new Uint8Array(result.originalBytes)],
    })).toEqual([
      { format: "text", languageId: "plaintext", previewKind: "plain-text", bytes: [...encoder.encode("alpha\r\nbeta\r\n")] },
      { format: "text", languageId: "plaintext", previewKind: "plain-text", bytes: [...encoder.encode("plain\ntext\n")] },
    ]);
  });

  it("handles a leading UTF-8 BOM while preserving original bytes and line endings", async () => {
    // This catches BOM removal or newline normalization mutating the original custody bytes.
    const extraction = await import("../../src/domain/extraction");
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode("first\r\nsecond\r\n")]);
    const accepted = (await extraction.preflightFiles([upload("source.json", bytes)]))[0];
    if (!accepted.accepted) throw new Error("fixture should be admitted");

    const result = await extraction.extractFile(accepted);

    expect([...new Uint8Array(accepted.originalBytes)]).toEqual([...bytes]);
    expect(result.extractedText).toBe("first\r\nsecond\r\n");
    expect(result).toMatchObject({ format: "json", languageId: "json", previewKind: "structured-data" });
  });

  it("rejects fatal UTF-8, disallowed controls, binary signatures, and blank generic text recoverably", async () => {
    // This catches unknown binary or control-bearing content being treated as editable source text.
    const extraction = await import("../../src/domain/extraction");
    const results = await extraction.preflightFiles([
      upload("bad.unknown", new Uint8Array([0xc3, 0x28])),
      upload("control.unknown", encoder.encode("alpha\u0001beta")),
      upload("image.unknown", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      upload("blank.unknown", encoder.encode(" \n\t ")),
    ]);

    expect(results.map((result) => result.accepted ? "accepted" : result.issue.code)).toEqual([
      "INVALID_UTF8",
      "UNSAFE_TEXT_CONTROLS",
      "UNSUPPORTED_BINARY",
      "EMPTY_CONTENT",
    ]);
    for (const result of results) {
      if (!result.accepted) expect(result.issue.message).toMatch(/cannot|not|unsupported/i);
    }
  });
});
