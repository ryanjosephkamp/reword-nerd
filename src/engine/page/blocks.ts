// Keeps a Markdown document's own text for every block the user didn't touch on the page.
// The page editor shows one element per block; when the user edits, only the changed blocks
// are turned back into Markdown, so a one-word edit stays a one-word change in the file.
import type { Token } from "marked";

export interface MarkdownBlock {
  /** The block exactly as it was written. */
  raw: string;
  /** Blank lines and invisible definitions (like link references) that followed it. */
  trailer: string;
  token: Token;
}

export interface MarkdownSegments {
  /** Anything before the first visible block, such as leading blank lines. */
  prefix: string;
  blocks: MarkdownBlock[];
  /** Whether the file used Windows line endings, which the parser turns into \n. */
  crlf: boolean;
}

const INVISIBLE = new Set(["space", "def"]);

/** Splits lexed tokens into visible blocks, each carrying the text that followed it. */
export function segmentTokens(tokens: readonly Token[], crlf = false): MarkdownSegments {
  let prefix = "";
  const blocks: MarkdownBlock[] = [];
  for (const token of tokens) {
    if (INVISIBLE.has(token.type)) {
      const last = blocks.at(-1);
      if (last) last.trailer += token.raw;
      else prefix += token.raw;
    } else {
      blocks.push({ raw: token.raw, trailer: "", token });
    }
  }
  return { prefix, blocks, crlf };
}

/** One block of the edited page: an untouched original block, or new Markdown. Edited blocks
 * name the block they came from, so what followed it (like link definitions) stays. */
export type PageItem = { keep: number } | { markdown: string; from?: number };

/** Rebuilds the document from the page, reusing the original text of untouched blocks. */
export function assembleMarkdown(segments: MarkdownSegments, items: readonly PageItem[]): string {
  let out = segments.prefix;
  let lastWasNew = false;
  const separate = () => {
    if (out === "" || out.endsWith("\n\n")) return;
    out += out.endsWith("\n") ? "\n" : "\n\n";
  };
  for (const [index, item] of items.entries()) {
    if ("keep" in item) {
      const block = segments.blocks[item.keep];
      if (!block) continue;
      out += block.raw + block.trailer;
      lastWasNew = false;
    } else {
      const markdown = item.markdown.trim();
      const original = item.from === undefined ? undefined : segments.blocks[item.from];
      if (!markdown) {
        // An emptied block still keeps any definitions that followed it.
        if (original?.trailer.trim()) {
          separate();
          out += original.trailer.replace(/^\n+/, "");
        }
        continue;
      }
      separate();
      if (original) {
        // Same spacing as before, so the next untouched block is unchanged too. Only a heading
        // may sit directly on the next line; anything else would run into the next block.
        let spacing = (/\s*$/.exec(original.raw)?.[0] ?? "") + original.trailer;
        const heading = /^#{1,6}\s[^\n]*$/.test(markdown);
        if (!heading && !/\n[ \t]*\n/.test(spacing) && index < items.length - 1) spacing = "\n\n";
        out += markdown + spacing;
        lastWasNew = false;
      } else {
        out += `${markdown}\n\n`;
        lastWasNew = true;
      }
    }
  }
  if (lastWasNew) out = out.replace(/\n+$/, "\n");
  return segments.crlf ? out.replace(/\r?\n/g, "\r\n") : out;
}
