// Turns an edited block of the page back into Markdown, in the document's own conventions
// (bullet marker, emphasis marker, code fences), and escapes only what would otherwise change
// meaning, so ordinary text like snake_case or [1] stays as written.
import type TurndownService from "turndown";
import { addStrikethroughRule, addTableRule } from "../markdownRules";

export interface MarkdownConventions {
  bullet: "-" | "*" | "+";
  em: "_" | "*";
  strong: "**" | "__";
  fence: "```" | "~~~";
}

function mostCommon<T extends string>(counts: [T, number][], fallback: T): T {
  const [best] = [...counts].sort((a, b) => b[1] - a[1]);
  return best && best[1] > 0 ? best[0] : fallback;
}

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

/** Reads the document's habits so new Markdown matches the old. */
export function detectConventions(markdown: string): MarkdownConventions {
  return {
    bullet: mostCommon(
      [
        ["-", count(markdown, /^\s*- /gm)],
        ["*", count(markdown, /^\s*\* /gm)],
        ["+", count(markdown, /^\s*\+ /gm)],
      ],
      "-",
    ),
    em: mostCommon(
      [
        ["_", count(markdown, /(?<![\w_])_(?=\S)[^_\n]+(?<=\S)_(?![\w_])/g)],
        ["*", count(markdown, /(?<!\*)\*(?=\S)[^*\n]+(?<=\S)\*(?!\*)/g)],
      ],
      "_",
    ),
    strong: count(markdown, /__\S/g) > count(markdown, /\*\*\S/g) ? "__" : "**",
    fence: count(markdown, /^~~~/gm) > count(markdown, /^```/gm) ? "~~~" : "```",
  };
}

const PUNCTUATION = String.raw`!-\/:-@\[-\`{-~`;

/** Escapes text so Markdown reads it back as the same text, and no more than that. */
export function escapeMarkdownText(text: string): string {
  let out = text
    .replace(new RegExp(String.raw`\\(?=[${PUNCTUATION}])`, "g"), "\\\\")
    .replace(/`/g, "\\`")
    .replace(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, "\\_")
    .replace(/\*(?!\s)|(?<!\s)\*/g, "\\*")
    .replace(/~(?=~)/g, "\\~")
    .replace(/<(?=[A-Za-z/!?])/g, "\\<")
    .replace(/&(?=#?\w+;)/g, "\\&");
  if (/\]\s*[([:]/.test(out)) out = out.replace(/[[\]]/g, "\\$&");
  return out
    .replace(/^(#{1,6})(?=\s|$)/, "\\$1")
    .replace(/^>/, "\\>")
    .replace(/^([-+])(?=\s)/, "\\$1")
    .replace(/^(=+|-+)$/, "\\$1")
    .replace(/^~~~/, "\\~~~")
    .replace(/^(\d+)([.)])(?=\s)/, "$1\\$2");
}

const loadModules = () => Promise.all([import("turndown"), import("turndown-plugin-gfm")]);

const services = new Map<string, TurndownService>();
let loading: ReturnType<typeof loadModules> | null = null;

function build(
  Turndown: typeof TurndownService,
  gfm: (service: TurndownService) => void,
  conventions: MarkdownConventions,
): TurndownService {
  const service = new Turndown({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: conventions.bullet,
    emDelimiter: conventions.em,
    strongDelimiter: conventions.strong,
    codeBlockStyle: "fenced",
    fence: conventions.fence,
  });
  service.use(gfm);
  service.escape = escapeMarkdownText;
  addTableRule(service);
  addStrikethroughRule(service);
  // Editors leave styling spans and font tags behind; only their text matters.
  service.addRule("plain-inline", {
    filter: (node: HTMLElement) => ["SPAN", "FONT", "U", "MARK", "SMALL"].includes(node.nodeName),
    replacement: (content: string) => content,
  });
  // Rules added later win, so figures come after the span rule above.
  // Figures are shown as placeholders on the page; each keeps its original Markdown.
  service.addRule("figures", {
    filter: (node: HTMLElement) => node.nodeName === "SPAN" && node.dataset.md !== undefined,
    replacement: (_content: string, node: TurndownService.Node) =>
      (node as HTMLElement).dataset.md ?? "",
  });
  return service;
}

/** Loads turndown once and returns a converter for a document with these conventions. */
export async function loadConverter(
  conventions: MarkdownConventions,
): Promise<(node: HTMLElement) => string> {
  loading ??= loadModules();
  const [{ default: Turndown }, { gfm }] = await loading;
  const key = JSON.stringify(conventions);
  let service = services.get(key);
  if (!service) {
    service = build(Turndown, gfm, conventions);
    services.set(key, service);
  }
  const ready = service;
  return (node) => ready.turndown(node).trim();
}
