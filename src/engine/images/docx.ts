// Takes the pictures out of a Word (.docx) file, in the order they appear in the document.
import { compareText, type ZipBudget, type ZipOpener } from "../zip";
import { readImageArchive, type ArchiveSkip } from "./archive";
import { ImageReadError } from "./errors";
import { IMAGE_LIMITS } from "./limits";

export interface DocxPicture {
  /** Path inside the Word file, such as word/media/image1.png. */
  path: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export interface DocxContents {
  pictures: DocxPicture[];
  /** Pictures that weren't unpacked, with the reason. */
  skipped: ArchiveSkip[];
}

export interface ReadDocxOptions {
  open: ZipOpener;
  budget: ZipBudget;
  signal?: AbortSignal;
}

const MEDIA_FOLDER = "word/media/";
const CONTENT_TYPES = "[Content_Types].xml";
const DOCUMENT = "word/document.xml";
const DOCUMENT_RELATIONSHIPS = "word/_rels/document.xml.rels";
const PARTS = new Set([CONTENT_TYPES, DOCUMENT, DOCUMENT_RELATIONSHIPS]);

export async function readDocxPictures(
  source: Blob,
  { open, budget, signal }: ReadDocxOptions,
): Promise<DocxContents> {
  const contents = await readImageArchive(source, {
    open,
    budget,
    signal,
    label: "Word file",
    // Only the pictures and the parts that give their order are unpacked; embedded
    // spreadsheets, fonts, and the like stay packed.
    limitFor: (path) =>
      path.startsWith(MEDIA_FOLDER) || PARTS.has(path) ? IMAGE_LIMITS.maxImageBytes : null,
  });
  const parts = new Map(contents.files.map((file) => [file.path, file.bytes]));
  const known = [...contents.files, ...contents.skipped].some(({ path }) => path === CONTENT_TYPES);
  if (!known) {
    throw new ImageReadError("This file isn't a valid Word (.docx) file, or it's damaged.");
  }
  const order = documentOrder(parts.get(DOCUMENT), parts.get(DOCUMENT_RELATIONSHIPS));
  const rank = (path: string) => order.get(path) ?? Number.MAX_SAFE_INTEGER;
  const pictures = contents.files
    .filter(({ path }) => path.startsWith(MEDIA_FOLDER))
    .sort(
      (left, right) => rank(left.path) - rank(right.path) || compareText(left.path, right.path),
    );
  return {
    pictures,
    skipped: contents.skipped.filter(({ path }) => path.startsWith(MEDIA_FOLDER)),
  };
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "u").exec(tag);
  return match ? (match[1] ?? match[2]) : null;
}

/** Resolves a relationship target against the folder of the part that refers to it. */
function resolveTarget(folder: string, target: string): string {
  const segments = target.startsWith("/") ? [] : folder.split("/").filter(Boolean);
  for (const segment of target.split("/")) {
    if (segment === "..") segments.pop();
    else if (segment && segment !== ".") segments.push(segment);
  }
  return segments.join("/");
}

/**
 * Maps each media path to where the body first shows it. Pictures only in headers,
 * footers, or nowhere at all aren't in the map and go last.
 */
function documentOrder(
  documentXml: Uint8Array | undefined,
  relationshipsXml: Uint8Array | undefined,
): Map<string, number> {
  const order = new Map<string, number>();
  if (!documentXml || !relationshipsXml) return order;
  const decoder = new TextDecoder();
  const targets = new Map<string, string>();
  for (const [tag] of decoder.decode(relationshipsXml).matchAll(/<Relationship\b[^>]*>/gu)) {
    const id = attribute(tag, "Id");
    const target = attribute(tag, "Target");
    if (id && target && attribute(tag, "TargetMode") !== "External") {
      targets.set(id, resolveTarget("word", target));
    }
  }
  // Pictures are referenced by r:embed (DrawingML) or r:id (older VML shapes).
  const references = decoder.decode(documentXml).matchAll(/\sr:(?:embed|id)\s*=\s*"([^"]+)"/gu);
  for (const [, id] of references) {
    const path = targets.get(id);
    if (path && !order.has(path)) order.set(path, order.size);
  }
  return order;
}
