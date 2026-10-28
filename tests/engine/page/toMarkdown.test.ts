// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  detectConventions,
  escapeMarkdownText,
  loadConverter,
} from "../../../src/engine/page/toMarkdown";

function element(html: string): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  return wrapper;
}

describe("escapeMarkdownText", () => {
  it("leaves ordinary text alone", () => {
    for (const text of [
      "snake_case and file_name.txt",
      "See [1] and [2].",
      "5 * 3 = 15",
      "C:\\Users\\name",
      "Tom & Jerry",
      "a < b",
      "Cost: $5 - $10",
    ]) {
      expect(escapeMarkdownText(text)).toBe(text);
    }
  });

  it("escapes what would change meaning", () => {
    expect(escapeMarkdownText("_not italic_")).toBe("\\_not italic\\_");
    expect(escapeMarkdownText("*not bold*")).toBe("\\*not bold\\*");
    expect(escapeMarkdownText("# not a heading")).toBe("\\# not a heading");
    expect(escapeMarkdownText("1. not a list")).toBe("1\\. not a list");
    expect(escapeMarkdownText("- not a bullet")).toBe("\\- not a bullet");
    expect(escapeMarkdownText("[not](a link)")).toBe("\\[not\\](a link)");
    expect(escapeMarkdownText("<b>not html</b>")).toBe("\\<b>not html\\</b>");
    expect(escapeMarkdownText("&amp; stays text")).toBe("\\&amp; stays text");
    expect(escapeMarkdownText("`code`")).toBe("\\`code\\`");
  });
});

describe("detectConventions", () => {
  it("matches the document's own markers", () => {
    expect(detectConventions("* a\n* b\n\n*em* and **strong**\n\n~~~\ncode\n~~~")).toEqual({
      bullet: "*",
      em: "*",
      strong: "**",
      fence: "~~~",
    });
    expect(detectConventions("plain text")).toEqual({
      bullet: "-",
      em: "_",
      strong: "**",
      fence: "```",
    });
  });
});

describe("loadConverter", () => {
  it("turns edited blocks back into Markdown in the document's style", async () => {
    const convert = await loadConverter({ bullet: "*", em: "*", strong: "**", fence: "```" });
    expect(convert(element("<h2>Heading</h2>"))).toBe("## Heading");
    expect(convert(element("<p>Some <b>bold</b> and <i>italic</i> words</p>"))).toBe(
      "Some **bold** and *italic* words",
    );
    expect(convert(element("<ul><li>one</li><li>two</li></ul>"))).toMatch(/^\*\s+one\n\*\s+two$/);
    expect(convert(element('<p><span style="color:red">styled</span> text</p>'))).toBe(
      "styled text",
    );
  });

  it("keeps each figure's original Markdown", async () => {
    const convert = await loadConverter({ bullet: "-", em: "_", strong: "**", fence: "```" });
    const html =
      '<p>Before <span class="figure-ref" data-md="![Chart](asset:asset-0123456789ab)">[Figure: Chart]</span> after</p>';
    expect(convert(element(html))).toBe("Before ![Chart](asset:asset-0123456789ab) after");
  });

  it("writes tables as Markdown tables", async () => {
    const convert = await loadConverter({ bullet: "-", em: "_", strong: "**", fence: "```" });
    const html =
      "<table><thead><tr><th>Bed</th><th>Crop</th></tr></thead><tbody><tr><td>1</td><td>Kale</td></tr></tbody></table>";
    expect(convert(element(html))).toBe("| Bed | Crop |\n| --- | --- |\n| 1 | Kale |");
  });
});
