import { Lexer } from "marked";
import { describe, expect, it } from "vitest";
import { assembleMarkdown, segmentTokens, type PageItem } from "../../../src/engine/page/blocks";

const DOCUMENT = [
  "# Title",
  "Right after the title.",
  "",
  "- one",
  "- two",
  "",
  "",
  "A paragraph with a [link][ref].",
  "",
  "[ref]: https://example.com",
  "",
  "Last line without a newline",
].join("\n");

function segments(markdown: string) {
  return segmentTokens(new Lexer({ gfm: true }).lex(markdown));
}

const keepAll = (count: number): PageItem[] =>
  Array.from({ length: count }, (_unused, index) => ({ keep: index }));

describe("assembleMarkdown", () => {
  it("rebuilds an untouched document exactly", () => {
    const parts = segments(DOCUMENT);
    expect(assembleMarkdown(parts, keepAll(parts.blocks.length))).toBe(DOCUMENT);
  });

  it("keeps link definitions and spacing that the page doesn't show", () => {
    const parts = segments(DOCUMENT);
    expect(parts.blocks.map((block) => block.token.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "paragraph",
      "paragraph",
    ]);
    expect(parts.blocks[3].trailer).toContain("[ref]: https://example.com");
  });

  it("changes only the edited block", () => {
    const parts = segments(DOCUMENT);
    const items = keepAll(parts.blocks.length);
    items[3] = { markdown: "A shorter paragraph with a [link][ref].", from: 3 };
    const result = assembleMarkdown(parts, items);
    expect(result).toBe(DOCUMENT.replace("A paragraph with", "A shorter paragraph with"));
  });

  it("separates a new block from a block that ended without a blank line", () => {
    const parts = segments(DOCUMENT);
    const items: PageItem[] = [{ keep: 0 }, { markdown: "## Inserted" }, ...keepAll(5).slice(1)];
    const result = assembleMarkdown(parts, items);
    expect(result.startsWith("# Title\n\n## Inserted\n\nRight after the title.\n")).toBe(true);
  });

  it("never lets an edited block run into the next one", () => {
    const parts = segments(DOCUMENT);
    const items = keepAll(parts.blocks.length);
    items[0] = { markdown: "Title as a paragraph", from: 0 };
    expect(assembleMarkdown(parts, items)).toMatch(/^Title as a paragraph\n\nRight after/);
    items[0] = { markdown: "# New title", from: 0 };
    expect(assembleMarkdown(parts, items)).toMatch(/^# New title\nRight after/);
  });

  it("drops deleted blocks and ends a new last block with one newline", () => {
    const parts = segments("First\n\nSecond\n");
    expect(assembleMarkdown(parts, [{ keep: 0 }])).toBe("First\n\n");
    expect(assembleMarkdown(parts, [{ keep: 0 }, { markdown: "Changed" }])).toBe(
      "First\n\nChanged\n",
    );
  });

  it("restores Windows line endings", () => {
    const parts = segmentTokens(new Lexer().lex("One\n\nTwo\n"), true);
    expect(assembleMarkdown(parts, [{ keep: 0 }, { markdown: "Three" }])).toBe(
      "One\r\n\r\nThree\r\n",
    );
  });
});
