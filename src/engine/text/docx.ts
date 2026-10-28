// Word documents become Markdown: mammoth turns the .docx into HTML, and turndown turns that HTML
// into GitHub-flavored Markdown. Pictures become assets that the text refers to as `asset:<id>`.
import type { DocumentAsset } from "../types";
import { createZipBudget, listZip, ZipReadError, type ZipOpener } from "../zip";
import { hasZipSignature } from "./formats";
import { AssetCollector, assetReference } from "./assets";
import { plural, ReadProblem } from "./util";

export interface DocxPicture {
  contentType: string;
  altText?: string;
  read(): Promise<Uint8Array<ArrayBuffer>>;
}

export interface DocxMessage {
  type: "warning" | "error";
  message: string;
}

/** Turns a .docx into HTML, asking `convertPicture` what each picture should point to. */
export type DocxToHtml = (
  bytes: ArrayBuffer,
  convertPicture: (picture: DocxPicture) => Promise<{ src: string; alt?: string }>,
) => Promise<{ html: string; messages: readonly DocxMessage[] }>;

export const mammothToHtml: DocxToHtml = async (bytes, convertPicture) => {
  const { default: mammoth } = await import("mammoth");
  // mammoth's browser build reads `arrayBuffer`; its Node build, which the tests use, reads `buffer`.
  const input = { arrayBuffer: bytes, buffer: new Uint8Array(bytes) };
  const result = await mammoth.convertToHtml(input, {
    styleMap: [],
    includeEmbeddedStyleMap: false,
    externalFileAccess: false,
    ignoreEmptyParagraphs: false,
    convertImage: mammoth.images.imgElement((image) =>
      convertPicture({
        contentType: image.contentType,
        altText: (image as { altText?: string }).altText,
        read: async () => new Uint8Array(await image.readAsArrayBuffer()),
      }),
    ),
  });
  return { html: result.value, messages: result.messages };
};

const ASSET_SOURCE = /^asset:asset-[a-f0-9]{12}$/;

export async function htmlToMarkdown(html: string): Promise<string> {
  const [{ default: TurndownService }, { gfm }] = await Promise.all([
    import("turndown"),
    import("turndown-plugin-gfm"),
  ]);
  const service = new TurndownService({
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "_",
    headingStyle: "atx",
  });
  service.use(gfm);
  // Only pictures that were saved as assets stay; anything else (such as a data URI) is dropped.
  service.addRule("asset-pictures", {
    filter: "img",
    replacement: (_content, node) => {
      const element = node as HTMLElement;
      const source = element.getAttribute("src") ?? "";
      if (!ASSET_SOURCE.test(source)) return "";
      const alt = (element.getAttribute("alt") ?? "").replace(/[[\]]/g, "").trim();
      return `![${alt}](${source})`;
    },
  });
  // Word tables have no header row, which the GFM plugin needs, so it would keep them as raw
  // HTML. Every table becomes a Markdown table here, with its first row as the header.
  service.addRule("tables", {
    filter: "table",
    replacement: (_content, node) => {
      const rows = [...(node as HTMLTableElement).rows].map((row) =>
        [...row.cells].map((cell) =>
          service
            .turndown(cell.innerHTML)
            .replace(/\s*\n+\s*/g, " ")
            .replaceAll("|", "\\|")
            .trim(),
        ),
      );
      if (rows.length === 0) return "";
      const width = Math.max(...rows.map((row) => row.length));
      const line = (cells: string[]) =>
        `| ${[...cells, ...Array(width - cells.length).fill("")].join(" | ")} |`;
      const divider = line(Array(width).fill("---"));
      return `\n\n${[line(rows[0]), divider, ...rows.slice(1).map(line)].join("\n")}\n\n`;
    },
  });
  service.addRule("strikethrough", {
    filter: (node) => ["DEL", "S", "STRIKE"].includes(node.nodeName),
    replacement: (content) => `~~${content}~~`,
  });
  return service.turndown(html).trim();
}

function countDroppedPictures(html: string, messages: readonly DocxMessage[]): number {
  const unsaved = [...html.matchAll(/<img\b[^>]*>/gi)].filter((match) => {
    const source = /\bsrc=["']([^"']*)["']/i.exec(match[0])?.[1] ?? "";
    return !ASSET_SOURCE.test(source);
  }).length;
  // mammoth reports a picture it couldn't read as an error, or a missing one as a warning.
  const unread = messages.filter(
    (message) =>
      message.type === "error" ||
      /could not find image|imagedata element without/i.test(message.message),
  ).length;
  return unsaved + unread;
}

function hasLayoutWarnings(messages: readonly DocxMessage[]): boolean {
  return messages.some(
    (message) =>
      message.type === "warning" &&
      !/^unrecognised \w+ style/i.test(message.message) &&
      !/image/i.test(message.message),
  );
}

/** The most a Word document may unpack to, all parts together. */
export const MAX_DOCX_UNPACKED_BYTES = 100 * 1024 * 1024;
const MAX_DOCX_PARTS = 5_000;

const UNSAFE_DOCX =
  "This Word document unpacks to far more than its own size, or part of it is damaged, so it wasn't opened.";

/**
 * mammoth unpacks every part it needs in full, trusting the sizes the file states. So every
 * part is unpacked here first, counting the real bytes against the size limits, and dropped.
 */
export async function checkDocxParts(
  source: Blob,
  options: { open?: ZipOpener; signal?: AbortSignal } = {},
): Promise<void> {
  let zip: Awaited<ReturnType<typeof listZip>>;
  try {
    zip = await listZip(source, {
      label: "Word document",
      maxEntries: MAX_DOCX_PARTS,
      open: options.open,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof ZipReadError) throw new ReadProblem(error.message);
    throw error;
  }
  try {
    try {
      zip.checkExpansion(zip.files);
    } catch (error) {
      if (error instanceof ZipReadError) throw new ReadProblem(error.message);
      throw error;
    }
    const budget = createZipBudget(MAX_DOCX_UNPACKED_BYTES);
    for (const part of zip.files) {
      const unpacked = await zip.unpack(part, MAX_DOCX_UNPACKED_BYTES, budget);
      if (!(unpacked instanceof Uint8Array)) throw new ReadProblem(UNSAFE_DOCX);
    }
  } finally {
    await zip.close();
  }
}

export interface DocxText {
  markdown: string;
  assets: DocumentAsset[];
  notes: string[];
}

export async function readDocx(
  bytes: Uint8Array<ArrayBuffer>,
  toHtml: DocxToHtml = mammothToHtml,
  options: { open?: ZipOpener; signal?: AbortSignal } = {},
): Promise<DocxText> {
  if (!hasZipSignature(bytes)) {
    throw new ReadProblem("This file is named .docx, but it isn't a Word document.");
  }
  await checkDocxParts(new Blob([bytes]), options);
  const collector = new AssetCollector();
  let converted: Awaited<ReturnType<DocxToHtml>>;
  try {
    converted = await toHtml(bytes.slice().buffer, async (picture) => {
      const asset = await collector.add(await picture.read(), picture.contentType, picture.altText);
      if (!asset) return { src: "" };
      return {
        src: assetReference(asset.id),
        ...(picture.altText ? { alt: picture.altText } : {}),
      };
    });
  } catch {
    throw new ReadProblem(
      "This Word document couldn't be opened. It may be damaged, or it may not be a real .docx file.",
    );
  }

  // mammoth can't be stopped partway, so a cancel takes effect as soon as it finishes.
  options.signal?.throwIfAborted();
  const markdown = await htmlToMarkdown(converted.html);
  if (!markdown) throw new ReadProblem("This Word document has no text to rewrite.");

  const assets = collector.assets.filter((asset) => markdown.includes(assetReference(asset.id)));
  const dropped = countDroppedPictures(converted.html, converted.messages);
  const notes: string[] = [];
  if (assets.length > 0) {
    notes.push(
      "Pictures in this document are kept separately, and the text marks where each one goes.",
    );
  }
  if (dropped > 0) {
    notes.push(
      `${plural(dropped, "picture", "pictures")} in this document couldn't be read and ${dropped === 1 ? "was" : "were"} left out.`,
    );
  }
  if (hasLayoutWarnings(converted.messages)) {
    notes.push(
      "Some of this document's layout didn't carry over. Compare the text with the original if the layout matters.",
    );
  }
  return { markdown, assets, notes };
}
