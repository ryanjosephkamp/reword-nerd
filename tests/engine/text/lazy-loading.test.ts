import { describe, expect, it } from "vitest";

const sources = import.meta.glob<string>("../../../src/engine/text/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

const HEAVY =
  /^import\s+(?!type\b)[^;]*from\s+["'](mammoth|turndown|turndown-plugin-gfm|@zip\.js\/zip\.js|@unified-latex\/[^"']+|ignore|pdfjs-dist|tesseract\.js)["']/m;

describe("lazy loading", () => {
  it("imports no converter library at the top of any text engine module", () => {
    // Catches a static import that would pull mammoth, pdf.js, or zip.js into the first page load.
    expect(Object.keys(sources).length).toBeGreaterThan(5);
    for (const [path, source] of Object.entries(sources)) {
      expect(HEAVY.exec(source)?.[0] ?? null, path).toBeNull();
    }
  });
});
