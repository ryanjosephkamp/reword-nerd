import { describe, expect, it } from "vitest";

import { extractDocxWithAdapter } from "../../src/domain";

const imageBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);

describe("DOCX media extraction", () => {
  it("captures embedded image bytes and preserves their position as a controlled asset reference", async () => {
    // This catches the DOCX converter silently dropping scientific figures or leaking converter HTML into review text.
    const result = await extractDocxWithAdapter(new Uint8Array([80, 75]).buffer, {
      convertToHtml: async (_input: unknown, options: unknown) => {
        const convertImage = (options as unknown as {
          convertImage(image: { contentType: string; altText?: string; read(format: "base64"): Promise<string> }): Promise<{ src: string; alt?: string }>;
        }).convertImage;
        const converted = await convertImage({
          contentType: "image/png",
          altText: "Calibration curve",
          read: async () => btoa(String.fromCharCode(...imageBytes)),
        });
        return {
          value: `<h1>Results</h1><p>See the figure.</p><img src="${converted.src}" alt="${converted.alt}">`,
          messages: [],
        };
      },
    } as never);

    expect(result.markdown).toContain("# Results");
    expect(result.markdown).toMatch(/!\[Calibration curve\]\(asset:asset-[a-f0-9]{12}\)/);
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({
      kind: "docx-media",
      mimeType: "image/png",
      altText: "Calibration curve",
      byteCount: imageBytes.byteLength,
      included: true,
    });
    expect(Array.from(result.assets[0].bytes)).toEqual(Array.from(imageBytes));
    expect(result.warnings).toEqual([]);
  });

  it("deduplicates repeated image payloads while retaining both document references", async () => {
    // This catches repeated relationships inflating the package or deleting a repeated in-text placement marker.
    const result = await extractDocxWithAdapter(new Uint8Array([80, 75]).buffer, {
      convertToHtml: async (_input: unknown, options: unknown) => {
        const convertImage = (options as never as { convertImage(image: unknown): Promise<{ src: string }> }).convertImage;
        const image = { contentType: "image/png", read: async () => btoa(String.fromCharCode(...imageBytes)) };
        const first = await convertImage(image);
        const second = await convertImage(image);
        return { value: `<p>A</p><img src="${first.src}"><p>B</p><img src="${second.src}">`, messages: [] };
      },
    } as never);

    expect(result.assets).toHaveLength(1);
    expect(result.markdown.match(/asset:asset-[a-f0-9]{12}/g)).toHaveLength(2);
  });
});
