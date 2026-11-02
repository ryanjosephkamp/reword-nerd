import { describe, expect, it, vi } from "vitest";

const convertToHtml = vi.fn(async () => ({ value: "<h2>Converted</h2>", messages: [] }));

vi.mock("mammoth", () => ({
  default: {
    convertToHtml,
    images: { imgElement: (convert: unknown) => ({ convert }) },
  },
}));

describe("mammoth options", () => {
  it("turns off embedded style maps and external file access", async () => {
    // Catches a converter option that would read linked files or trust the document's own styles.
    const { mammothToHtml } = await import("../../../src/engine/text/docx");
    const result = await mammothToHtml(new ArrayBuffer(4), async () => ({ src: "" }));

    expect(result.html).toBe("<h2>Converted</h2>");
    expect(convertToHtml).toHaveBeenCalledWith(
      expect.objectContaining({ arrayBuffer: expect.any(ArrayBuffer) }),
      expect.objectContaining({
        styleMap: [],
        includeEmbeddedStyleMap: false,
        externalFileAccess: false,
        ignoreEmptyParagraphs: false,
        convertImage: expect.anything(),
      }),
    );
  });
});
