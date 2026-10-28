// Turns a rewrite back into a file: the original format for text files, and Word for
// documents that started as Word or PDF. The Word writer loads only when it's needed.
import type { Token, Tokens } from "marked";
import type { DocumentFormat } from "../types";

export interface ExportFile {
  name: string;
  blob: Blob;
}

const TEXT_TYPES: Partial<Record<DocumentFormat, string>> = {
  markdown: "text/markdown",
  html: "text/html",
  json: "application/json",
  csv: "text/csv",
  xml: "application/xml",
};

function stem(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The file a rewrite should be saved as, given where it came from. */
export async function exportRewrite(
  sourcePath: string,
  format: DocumentFormat,
  text: string,
): Promise<ExportFile> {
  if (format === "docx" || format === "pdf") {
    return { name: `${stem(sourcePath)}.docx`, blob: await markdownToDocx(text) };
  }
  const type = TEXT_TYPES[format] ?? "text/plain";
  return { name: fileName(sourcePath), blob: new Blob([text], { type: `${type};charset=utf-8` }) };
}

export function exportMarkdown(sourcePath: string, text: string): ExportFile {
  return {
    name: `${stem(sourcePath)}.md`,
    blob: new Blob([text], { type: "text/markdown;charset=utf-8" }),
  };
}

type Docx = typeof import("docx");
type Run = InstanceType<Docx["TextRun"]> | InstanceType<Docx["ExternalHyperlink"]>;
type Block = InstanceType<Docx["Paragraph"]> | InstanceType<Docx["Table"]>;

interface RunStyle {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  code?: boolean;
}

function inlineRuns(docx: Docx, tokens: readonly Token[] | undefined, style: RunStyle = {}): Run[] {
  const runs: Run[] = [];
  for (const token of tokens ?? []) {
    switch (token.type) {
      case "strong":
        runs.push(...inlineRuns(docx, (token as Tokens.Strong).tokens, { ...style, bold: true }));
        break;
      case "em":
        runs.push(...inlineRuns(docx, (token as Tokens.Em).tokens, { ...style, italics: true }));
        break;
      case "del":
        runs.push(...inlineRuns(docx, (token as Tokens.Del).tokens, { ...style, strike: true }));
        break;
      case "codespan":
        runs.push(textRun(docx, (token as Tokens.Codespan).text, { ...style, code: true }));
        break;
      case "br":
        runs.push(new docx.TextRun({ break: 1 }));
        break;
      case "link": {
        const link = token as Tokens.Link;
        runs.push(
          new docx.ExternalHyperlink({
            link: link.href,
            children: inlineRuns(docx, link.tokens, style).filter(
              (run): run is InstanceType<Docx["TextRun"]> => run instanceof docx.TextRun,
            ),
          }),
        );
        break;
      }
      case "image": {
        const image = token as Tokens.Image;
        runs.push(
          textRun(docx, `[Figure: ${image.text || image.href}]`, { ...style, italics: true }),
        );
        break;
      }
      default: {
        const nested = (token as { tokens?: Token[] }).tokens;
        if (nested?.length) runs.push(...inlineRuns(docx, nested, style));
        else
          runs.push(
            textRun(docx, decodeEntities((token as { text?: string }).text ?? token.raw), style),
          );
      }
    }
  }
  return runs;
}

function textRun(docx: Docx, text: string, style: RunStyle) {
  return new docx.TextRun({
    text,
    bold: style.bold,
    italics: style.italics,
    strike: style.strike,
    font: style.code ? "Consolas" : undefined,
  });
}

function decodeEntities(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

const HEADINGS = [
  "HEADING_1",
  "HEADING_2",
  "HEADING_3",
  "HEADING_4",
  "HEADING_5",
  "HEADING_6",
] as const;

function blocks(docx: Docx, tokens: readonly Token[], quote = false): Block[] {
  const out: Block[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case "heading": {
        const heading = token as Tokens.Heading;
        out.push(
          new docx.Paragraph({
            heading: docx.HeadingLevel[HEADINGS[Math.min(heading.depth, 6) - 1]],
            children: inlineRuns(docx, heading.tokens),
          }),
        );
        break;
      }
      case "paragraph":
        out.push(
          new docx.Paragraph({
            children: inlineRuns(docx, (token as Tokens.Paragraph).tokens),
            indent: quote ? { left: 720 } : undefined,
          }),
        );
        break;
      case "blockquote":
        out.push(...blocks(docx, (token as Tokens.Blockquote).tokens, true));
        break;
      case "list":
        out.push(...listBlocks(docx, token as Tokens.List, 0));
        break;
      case "code":
        for (const line of (token as Tokens.Code).text.split("\n")) {
          out.push(new docx.Paragraph({ children: [textRun(docx, line, { code: true })] }));
        }
        break;
      case "table":
        out.push(tableBlock(docx, token as Tokens.Table));
        break;
      case "hr":
        out.push(new docx.Paragraph({ thematicBreak: true }));
        break;
      case "space":
        break;
      default: {
        const text = (token as { text?: string }).text ?? token.raw;
        if (text.trim()) out.push(new docx.Paragraph({ children: [textRun(docx, text, {})] }));
      }
    }
  }
  return out;
}

function listBlocks(docx: Docx, list: Tokens.List, level: number): Block[] {
  const out: Block[] = [];
  for (const item of list.items) {
    const [first, ...rest] = item.tokens;
    const firstRuns =
      first && (first.type === "text" || first.type === "paragraph")
        ? inlineRuns(docx, (first as Tokens.Text).tokens ?? [first])
        : [];
    out.push(
      new docx.Paragraph({
        children: firstRuns,
        ...(list.ordered
          ? { numbering: { reference: "numbered", level: Math.min(level, 8) } }
          : { bullet: { level: Math.min(level, 8) } }),
      }),
    );
    const remaining = firstRuns.length ? rest : item.tokens;
    for (const nested of remaining) {
      if (nested.type === "list") out.push(...listBlocks(docx, nested as Tokens.List, level + 1));
      else out.push(...blocks(docx, [nested]));
    }
  }
  return out;
}

function tableBlock(docx: Docx, table: Tokens.Table) {
  const row = (cells: Tokens.TableCell[], header: boolean) =>
    new docx.TableRow({
      tableHeader: header,
      children: cells.map(
        (cell) =>
          new docx.TableCell({
            children: [
              new docx.Paragraph({
                children: inlineRuns(docx, cell.tokens, header ? { bold: true } : {}),
              }),
            ],
          }),
      ),
    });
  return new docx.Table({
    width: { size: 100, type: docx.WidthType.PERCENTAGE },
    rows: [row(table.header, true), ...table.rows.map((cells) => row(cells, false))],
  });
}

export async function markdownToDocx(markdown: string): Promise<Blob> {
  const [docx, { marked }] = await Promise.all([import("docx"), import("marked")]);
  const tokens = marked.lexer(markdown, { gfm: true });
  const levels = Array.from({ length: 9 }, (_unused, level) => ({
    level,
    format: docx.LevelFormat.DECIMAL,
    text: `%${level + 1}.`,
    alignment: docx.AlignmentType.START,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));
  const document = new docx.Document({
    numbering: { config: [{ reference: "numbered", levels }] },
    sections: [{ children: blocks(docx, tokens) }],
  });
  return docx.Packer.toBlob(document);
}
