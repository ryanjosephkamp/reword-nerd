import { describe, expect, it } from "vitest";
import { extensionForFormat, isSafeArchivePath, normalizeDocumentBase } from "../../src/export";

describe("export path contracts", () => {
  it("normalizes hostile and Unicode names into bounded deterministic bases", () => {
    // This catches archive keys retaining separators, combining marks, empty names, or more than 48 code points.
    expect(normalizeDocumentBase("Résumé / 2026.md")).toBe("resume-2026-md");
    expect(normalizeDocumentBase("😀😀")).toBe("document");
    expect(normalizeDocumentBase("A".repeat(60))).toBe("a".repeat(48));
    expect(normalizeDocumentBase("a\\b/../c\u0000d")).toBe("a-b-c-d");
  });

  it("uses only generated format extensions and rejects unsafe archive paths", () => {
    // This catches uploaded filename fragments reaching the archive path surface.
    expect(["text", "markdown", "docx", "pdf"].map((format) => extensionForFormat(format as "text"))).toEqual(["txt", "md", "docx", "pdf"]);
    expect(isSafeArchivePath("documents/key/prompts/01-decompose.md")).toBe(true);
    expect(extensionForFormat("unsupported" as never)).toBeUndefined();
    for (const path of ["../escape", "/absolute", "documents\\escape", "documents/./file", "documents/a\u0000b"]) {
      expect(isSafeArchivePath(path)).toBe(false);
    }
  });
});
