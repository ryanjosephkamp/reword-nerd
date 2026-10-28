// Saves a document the way it looks on the page: Word, PDF (through the browser's print dialog),
// a self-contained web page, Markdown, or plain text. Nothing here needs a model.
import { escapeMarkdownText } from "../../engine/page/toMarkdown";
import { PAPER_COLORS, type PageLook } from "../../engine/page/look";
import { markdownToDocx } from "../../engine/results/export";
import type { TextSource } from "../../engine/types";
import pageCss from "../../styles/page.css?raw";
import { downloadBlob } from "../../ui/download";
import { loadMarkdown } from "../../ui/markdown";
import serifNormal from "@fontsource-variable/newsreader/files/newsreader-latin-wght-normal.woff2?url";
import serifItalic from "@fontsource-variable/newsreader/files/newsreader-latin-wght-italic.woff2?url";

export type ExportKind = "docx" | "pdf" | "html" | "markdown" | "text" | "original";

export interface ExportChoice {
  kind: ExportKind;
  label: string;
  detail: string;
}

/** Text that reads as a page: Markdown, Word, PDF, and plain text. Code and data don't. */
export function isPageText(source: Pick<TextSource, "previewKind" | "format">): boolean {
  return (
    source.previewKind === "markdown" ||
    source.previewKind === "plain-text" ||
    source.format === "docx" ||
    source.format === "pdf"
  );
}

function isMarkdown(source: Pick<TextSource, "previewKind" | "format">): boolean {
  return source.previewKind === "markdown" || source.format === "docx" || source.format === "pdf";
}

export function stem(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function exportChoices(source: TextSource): ExportChoice[] {
  if (!isPageText(source)) {
    return [
      { kind: "original", label: fileName(source.path), detail: "The file, with your edits" },
    ];
  }
  const choices: ExportChoice[] = [
    { kind: "docx", label: "Word document", detail: ".docx in your page style" },
    { kind: "pdf", label: "PDF", detail: "Print or save as PDF" },
    { kind: "html", label: "Web page", detail: ".html that opens anywhere" },
    { kind: "markdown", label: "Markdown", detail: ".md" },
    { kind: "text", label: "Plain text", detail: ".txt" },
  ];
  return choices;
}

/** Plain text as Markdown: paragraphs stay paragraphs, and single line breaks stay put. */
export function plainToMarkdown(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => escapeMarkdownText(line))
        .join("  \n"),
    )
    .join("\n\n");
}

/** Markdown as plain text, one blank line between blocks. */
async function markdownToText(markdown: string): Promise<string> {
  const tools = await loadMarkdown();
  const holder = document.createElement("div");
  holder.innerHTML = tools.render(markdown);
  const lines: string[] = [];
  const isList = (node: Node): node is HTMLUListElement | HTMLOListElement =>
    node instanceof Element && (node.tagName === "UL" || node.tagName === "OL");
  const list = (element: Element, indent: string) => {
    [...element.children].forEach((item, index) => {
      const marker = element.tagName === "OL" ? `${index + 1}.` : "-";
      const own = [...item.childNodes]
        .filter((node) => !isList(node))
        .map((node) => node.textContent ?? "")
        .join("")
        .trim();
      lines.push(`${indent}${marker} ${own}`);
      for (const nested of item.children) if (isList(nested)) list(nested, `${indent}  `);
    });
  };
  for (const child of holder.children) {
    if (isList(child)) list(child, "");
    else if (child instanceof HTMLTableElement) {
      for (const row of child.rows) {
        lines.push([...row.cells].map((cell) => cell.textContent?.trim() ?? "").join("\t"));
      }
    } else lines.push(child.textContent?.trim() ?? "");
    lines.push("");
  }
  return `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()}\n`;
}

async function asDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** A self-contained web page: the page styles and, for the serif face, the font itself. */
async function htmlDocument(title: string, body: string, look: PageLook): Promise<string> {
  let fonts = "";
  if (look.font === "serif") {
    const [normal, italic] = await Promise.all([asDataUrl(serifNormal), asDataUrl(serifItalic)]);
    fonts = [
      [normal, "normal"],
      [italic, "italic"],
    ]
      .map(
        ([source, style]) =>
          `@font-face{font-family:"Newsreader Variable";font-style:${style};font-weight:200 800;font-display:swap;src:url(${source}) format("woff2-variations");}`,
      )
      .join("");
  }
  const link = look.link ? `--page-link:${look.link};` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${fonts}
${pageCss}
html{background:${PAPER_COLORS[look.paper].bg}}
body{margin:0;${link}}
main{max-width:44rem;margin:0 auto;padding:clamp(1.5rem,6vw,4rem) clamp(1.25rem,5vw,3rem)}
</style>
</head>
<body class="page" data-style="${look.paper}" data-font="${look.font}" data-size="${look.size}">
<main class="prose">
${body}
</main>
</body>
</html>
`;
}

/** Prints only the document, in its page style. The browser's dialog can save it as a PDF. */
function printDocument(title: string, body: string, look: PageLook) {
  document.getElementById("print-root")?.remove();
  const root = document.createElement("div");
  root.id = "print-root";
  root.className = "page";
  root.dataset.style = look.paper;
  root.dataset.font = look.font;
  root.dataset.size = look.size;
  if (look.link) root.style.setProperty("--page-link", look.link);
  // Header and footer rows repeat on every printed page, which gives each page its margins
  // while the paper color still reaches the edges.
  root.innerHTML = `<table class="print-sheet"><thead><tr><td class="print-margin"></td></tr></thead><tbody><tr><td><article class="prose">${body}</article></td></tr></tbody><tfoot><tr><td class="print-margin"></td></tr></tfoot></table>`;
  document.body.append(root);
  const html = document.documentElement;
  const previousTitle = document.title;
  html.classList.add("printing");
  html.style.setProperty("--print-bg", PAPER_COLORS[look.paper].bg);
  document.title = title;
  const finish = () => {
    window.removeEventListener("afterprint", finish);
    root.remove();
    html.classList.remove("printing");
    html.style.removeProperty("--print-bg");
    document.title = previousTitle;
  };
  window.addEventListener("afterprint", finish);
  window.print();
}

export interface ExportRequest {
  path: string;
  source: Pick<TextSource, "previewKind" | "format">;
  text: string;
  look: PageLook;
}

export async function exportDocument(kind: ExportKind, request: ExportRequest): Promise<void> {
  const { path, source, text, look } = request;
  const name = stem(path) || "document";
  const markdown = isMarkdown(source) ? text : plainToMarkdown(text);
  if (kind === "original") {
    downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), fileName(path));
    return;
  }
  if (kind === "markdown") {
    downloadBlob(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), `${name}.md`);
    return;
  }
  if (kind === "text") {
    const plain = isMarkdown(source) ? await markdownToText(text) : text;
    downloadBlob(new Blob([plain], { type: "text/plain;charset=utf-8" }), `${name}.txt`);
    return;
  }
  if (kind === "docx") {
    downloadBlob(await markdownToDocx(markdown, look), `${name}.docx`);
    return;
  }
  const body = (await loadMarkdown()).render(markdown);
  if (kind === "html") {
    const page = await htmlDocument(name, body, look);
    downloadBlob(new Blob([page], { type: "text/html;charset=utf-8" }), `${name}.html`);
    return;
  }
  printDocument(name, body, look);
}

/** The link color for the current palette: the light accent on light papers, else the dark. */
export function linkColor(paper: PageLook["paper"]): string | undefined {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(paper === "night" ? "--d-accent" : "--l-accent")
    .trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
}
