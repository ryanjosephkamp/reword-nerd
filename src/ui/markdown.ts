// Markdown in and out of the page, loaded on first use. Documents are shown, never run: pictures
// become labeled placeholders (so nothing is fetched from the network), raw HTML is shown as
// text, and every result is sanitized as a second guard.
import type { Token, TokensList } from "marked";

export interface MarkdownTools {
  /** The whole document as inert HTML. */
  render(markdown: string): string;
  lex(markdown: string): TokensList;
  /** One top-level block as inert HTML, using the document's link references. */
  renderBlock(token: Token, links: TokensList["links"]): string;
  /** Pasted HTML reduced to structure: headings, lists, emphasis, links, quotes, and tables. */
  cleanPaste(html: string): string;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const PASTE_TAGS = [
  "p",
  "br",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "strong",
  "b",
  "em",
  "i",
  "a",
  "blockquote",
  "code",
  "pre",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "del",
  "s",
  "hr",
];

let toolsPromise: Promise<MarkdownTools> | undefined;

export function loadMarkdown(): Promise<MarkdownTools> {
  toolsPromise ??= Promise.all([import("marked"), import("dompurify")]).then(
    ([{ Marked, Lexer }, { default: purify }]) => {
      const marked = new Marked({
        gfm: true,
        async: false,
        renderer: {
          image: ({ text, raw }) =>
            `<span class="figure-ref" data-md="${escapeHtml(raw)}">[Figure${
              text ? `: ${escapeHtml(text)}` : ""
            }]</span>`,
          html: ({ text }) => escapeHtml(text),
        },
      });
      purify.addHook("afterSanitizeAttributes", (node) => {
        if (node.tagName === "A") {
          node.setAttribute("target", "_blank");
          node.setAttribute("rel", "noopener noreferrer");
        }
      });
      const sanitize = (html: string) =>
        purify.sanitize(html, {
          FORBID_TAGS: ["img", "picture", "source", "video", "audio", "iframe", "style", "form"],
          FORBID_ATTR: ["style", "srcset"],
        });
      return {
        render: (markdown) => sanitize(marked.parse(markdown) as string),
        lex: (markdown) => new Lexer({ gfm: true }).lex(markdown),
        renderBlock: (token, links) => {
          const list = Object.assign([token], { links }) as TokensList;
          return sanitize(marked.parser(list) as string);
        },
        cleanPaste: (html) => {
          // Google Docs wraps a whole paste in a bold tag; drop that wrapper first.
          const unwrapped = html.replace(
            /<b\b[^>]*id="docs-internal-guid[^"]*"[^>]*>([\s\S]*)<\/b>/i,
            "$1",
          );
          return purify.sanitize(unwrapped, {
            ALLOWED_TAGS: PASTE_TAGS,
            ALLOWED_ATTR: ["href"],
          });
        },
      } satisfies MarkdownTools;
    },
  );
  return toolsPromise;
}
