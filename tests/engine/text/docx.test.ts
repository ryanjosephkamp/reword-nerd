import { describe, expect, it } from "vitest";

import { htmlToMarkdown, readDocx, type DocxToHtml } from "../../../src/engine/text/docx";
import { bytesOf, makeZip } from "./helpers";

const imageBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);

async function docxBytes() {
  return makeZip({ "[Content_Types].xml": "<Types />", "word/document.xml": "<w:document />" });
}

function converter(html: (convert: Parameters<DocxToHtml>[1]) => Promise<string>, messages = []) {
  const toHtml: DocxToHtml = async (_bytes, convert) => ({ html: await html(convert), messages });
  return toHtml;
}

describe("HTML to Markdown", () => {
  it("writes GitHub-flavored Markdown for headings, nested lists, links, tables, and tasks", async () => {
    // Catches HTML passing through untouched or the GFM plugin going missing.
    const markdown = await htmlToMarkdown(`
      <h1>Heading</h1><ul><li>Parent<ul><li>Child</li></ul></li></ul>
      <p><a href="https://example.com">Reference</a> and <del>removed</del></p>
      <table><thead><tr><th>One</th><th>Two</th></tr></thead><tbody><tr><td>A</td><td>B</td></tr></tbody></table>
      <ul><li><input type="checkbox" checked> Done</li></ul>
    `);

    expect(markdown).toContain("# Heading");
    expect(markdown).toMatch(/-\s+Parent\n\s+-\s+Child/);
    expect(markdown).toContain("[Reference](https://example.com)");
    expect(markdown).toContain("~~removed~~");
    expect(markdown).toMatch(/\| One \| Two \|/);
    expect(markdown).toMatch(/\[x\]\s+Done/i);
  });

  it("turns Word tables without a header row into Markdown tables", async () => {
    // Catches the GFM plugin keeping header-less tables as raw HTML.
    const markdown = await htmlToMarkdown(
      "<table><tr><td><p><strong>Need</strong></p></td><td><p>Why</p></td></tr>" +
        "<tr><td><p>Water</p><p>nearby</p></td><td><p>Beds | dry out</p></td></tr></table>",
    );
    expect(markdown).toBe("| **Need** | Why |\n| --- | --- |\n| Water nearby | Beds \\| dry out |");
  });

  it("keeps only pictures saved as assets", async () => {
    const markdown = await htmlToMarkdown(
      '<p>Text</p><img src="asset:asset-0123456789ab" alt="A [chart]"><img src="data:image/png;base64,AAAA" alt="x">',
    );
    expect(markdown).toBe("Text\n\n![A chart](asset:asset-0123456789ab)");
  });
});

describe("Word conversion", () => {
  it("saves pictures as assets referenced from the Markdown", async () => {
    const result = await readDocx(
      await docxBytes(),
      converter(async (convert) => {
        const picture = await convert({
          contentType: "image/png",
          altText: "Calibration curve",
          read: async () => imageBytes.slice(),
        });
        return `<h1>Results</h1><img src="${picture.src}" alt="${picture.alt}">`;
      }),
    );

    expect(result.markdown).toMatch(
      /^# Results\n\n!\[Calibration curve\]\(asset:asset-[a-f0-9]{12}\)$/,
    );
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({
      filename: "image-1.png",
      mimeType: "image/png",
      altText: "Calibration curve",
    });
    expect(await bytesOf(result.assets[0].bytes)).toEqual(Array.from(imageBytes));
  });

  it("stores a repeated picture once but keeps both references", async () => {
    const result = await readDocx(
      await docxBytes(),
      converter(async (convert) => {
        const picture = { contentType: "image/png", read: async () => imageBytes.slice() };
        const first = await convert(picture);
        const second = await convert(picture);
        return `<p>A</p><img src="${first.src}"><p>B</p><img src="${second.src}">`;
      }),
    );

    expect(result.assets).toHaveLength(1);
    expect(result.markdown.match(/asset:asset-[a-f0-9]{12}/g)).toHaveLength(2);
  });

  it("drops pictures it couldn't save and says so", async () => {
    // Catches a data URI slipping past the converter into the text.
    const result = await readDocx(
      await docxBytes(),
      converter(async () => '<p>Keep this text.</p><img src="data:image/png;base64,secret-bytes">'),
    );

    expect(result.markdown).toBe("Keep this text.");
    expect(result.notes).toEqual(["1 picture in this document couldn't be read and was left out."]);
  });

  it("notes layout warnings but not style warnings, in plain words", async () => {
    const styleOnly = await readDocx(await docxBytes(), async () => ({
      html: "<p>Text</p>",
      messages: [
        { type: "warning", message: "Unrecognised paragraph style: 'Title' (Style ID: Title)" },
      ],
    }));
    expect(styleOnly.notes).toEqual([]);

    const layout = await readDocx(await docxBytes(), async () => ({
      html: "<p>Text</p>",
      messages: [{ type: "warning", message: "An unrecognised element was ignored: w:sdt" }],
    }));
    expect(layout.notes).toEqual([
      "Some of this document's layout didn't carry over. Compare the text with the original if the layout matters.",
    ]);
    expect(layout.notes.join(" ")).not.toMatch(/w:sdt|unrecognised/i);
  });

  it("rejects empty or picture-only output, and converter failures, with plain reasons", async () => {
    for (const html of ["", " \n\t ", '<img src="data:image/png;base64,AAAA" alt="diagram">']) {
      await expect(
        readDocx(
          await docxBytes(),
          converter(async () => html),
        ),
      ).rejects.toThrow("This Word document has no text to rewrite.");
    }
    await expect(
      readDocx(await docxBytes(), async () => {
        throw new Error("raw parser detail");
      }),
    ).rejects.toThrow(/couldn't be opened/);
  });
});

describe("Word file safety", () => {
  it("refuses a Word file whose parts expand hugely, before mammoth unpacks them", async () => {
    // Catches mammoth inflating a 1000:1 part in full because the .docx itself looked small.
    const toHtml = vi.fn<DocxToHtml>();
    const bomb = await makeZip({
      "[Content_Types].xml": "<Types />",
      "word/document.xml": "x".repeat(2 * 1024 * 1024),
    });
    await expect(readDocx(bomb, toHtml)).rejects.toThrow(/unpacks to far more/);
    expect(toHtml).not.toHaveBeenCalled();
  });

  it("refuses many small parts that add up to far more than the file", async () => {
    const toHtml = vi.fn<DocxToHtml>();
    const parts = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`word/media/${i}.bin`, new Uint8Array(1024 * 1024)]),
    );
    const bomb = await makeZip({ "[Content_Types].xml": "<Types />", ...parts });
    await expect(readDocx(bomb, toHtml)).rejects.toThrow(/unpacks to far more than its own size/);
    expect(toHtml).not.toHaveBeenCalled();
  });

  it("stops when canceled during a conversion that can't be interrupted", async () => {
    const controller = new AbortController();
    const toHtml: DocxToHtml = async () => {
      controller.abort();
      return { html: "<p>Text</p>", messages: [] };
    };
    await expect(
      readDocx(await docxBytes(), toHtml, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
