// Reads the files and folders the user adds into TextSources and TextProjects. The heavy
// libraries each format needs load only when a file of that format shows up.
import type { Progress, Rejection, TextProject, TextSource } from "../types";
import { createZipBudget, type ZipBudget, type ZipOpener } from "../zip";
import { readDocx, type DocxToHtml } from "./docx";
import {
  DECODE_PROBLEM_REASONS,
  decodeText,
  extensionOf,
  PLAIN_TEXT,
  textKindForName,
  unsupportedReason,
  type TextKind,
} from "./formats";
import { standaloneLatexNotes } from "./latex";
import { extractMarkdownPictures } from "./markdown";
import { readPdf, type OpenPdfPages, type RecognizeText } from "./pdfText";
import { MAX_ZIP_BYTES, readFolderProject, readZipProject, type ProjectRead } from "./project";
import { makeTextSource } from "./source";
import { ReadProblem } from "./util";

export interface ReadTextOptions {
  /** PDFs only: which pages go through text recognition. */
  ocr: "off" | "pages-without-text" | "all-pages";
  onProgress?: (progress: Progress) => void;
  signal?: AbortSignal;
}

export interface ReadTextResult {
  sources: TextSource[];
  projects: TextProject[];
  rejected: Rejection[];
}

/** Stand-ins for the converters that can't run in tests. */
export interface ReadDependencies {
  docxToHtml?: DocxToHtml;
  openPdf?: OpenPdfPages;
  recognize?: RecognizeText;
  openZip?: ZipOpener;
  /** Bytes one call may read in all, counting what ZIPs unpack to; MAX_TOTAL_BYTES by default. */
  budgetBytes?: number;
}

export const MAX_FILE_COUNT = 20;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

const DOCX_KIND: TextKind = { format: "docx", languageId: "markdown", previewKind: "markdown" };
const PDF_KIND: TextKind = { format: "pdf", languageId: "plaintext", previewKind: "plain-text" };

function emptyResult(): ReadTextResult {
  return { sources: [], projects: [], rejected: [] };
}

function addProject(result: ReadTextResult, read: ProjectRead): void {
  result.projects.push(read.project);
  result.sources.push(...read.sources);
}

/** Turns an error into a rejection, or rethrows it when the read was canceled. */
function rejectionFor(name: string, error: unknown, signal: AbortSignal | undefined): Rejection {
  if (signal?.aborted) throw signal.reason;
  if (error instanceof ReadProblem) return { name, reason: error.message };
  return { name, reason: "Something went wrong while reading this file." };
}

function isZipName(name: string): boolean {
  return extensionOf(name) === ".zip";
}

function sizeProblem(file: File, count: number, budget: ZipBudget): string | null {
  if (count >= MAX_FILE_COUNT) {
    return `Only ${MAX_FILE_COUNT} files can be added at a time, so this one was left out.`;
  }
  if (file.size === 0) return "This file is empty.";
  const limit = isZipName(file.name) ? MAX_ZIP_BYTES : MAX_FILE_BYTES;
  if (file.size > limit) return `This file is larger than ${limit / 1024 / 1024} MB.`;
  // A ZIP is read in place; what it unpacks to is counted as it's read.
  if (!isZipName(file.name) && file.size > budget.remaining) {
    return "These files add up to more than 100 MB, so this one was left out.";
  }
  return null;
}

async function fileBytes(file: File): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new ReadProblem(
      "This file couldn't be opened. Make sure it's still there and try again.",
    );
  }
}

async function readStandalone(
  file: File,
  options: ReadTextOptions,
  dependencies: ReadDependencies,
): Promise<TextSource> {
  const unsupported = unsupportedReason(file.name);
  if (unsupported) throw new ReadProblem(unsupported);
  const bytes = await fileBytes(file);
  const base = { path: file.name, projectId: null, bytes };
  const extension = extensionOf(file.name);

  if (extension === ".docx") {
    const docx = await readDocx(bytes, dependencies.docxToHtml, {
      open: dependencies.openZip,
      signal: options.signal,
    });
    return makeTextSource({
      ...base,
      kind: DOCX_KIND,
      text: docx.markdown,
      notes: docx.notes,
      assets: docx.assets,
    });
  }
  if (extension === ".pdf") {
    const pdf = await readPdf(
      bytes,
      { name: file.name, ocr: options.ocr, signal: options.signal, onProgress: options.onProgress },
      { open: dependencies.openPdf, recognize: dependencies.recognize },
    );
    return makeTextSource({
      ...base,
      kind: PDF_KIND,
      text: pdf.text,
      notes: pdf.notes,
      ocr: pdf.ocr,
    });
  }

  const decoded = decodeText(bytes);
  if (!decoded.ok) throw new ReadProblem(DECODE_PROBLEM_REASONS[decoded.problem]);
  const kind = textKindForName(file.name) ?? { ...PLAIN_TEXT };
  if (kind.format === "markdown") {
    const markdown = await extractMarkdownPictures(decoded.text);
    return makeTextSource({
      ...base,
      kind,
      text: markdown.text,
      notes: markdown.notes,
      assets: markdown.assets,
    });
  }
  const notes = kind.format === "latex" ? standaloneLatexNotes(decoded.text) : [];
  return makeTextSource({ ...base, kind, text: decoded.text, notes });
}

function callBudget(dependencies: ReadDependencies): ZipBudget {
  return createZipBudget(dependencies.budgetBytes ?? MAX_TOTAL_BYTES);
}

export async function readFiles(
  files: readonly File[],
  options: ReadTextOptions,
  dependencies: ReadDependencies = {},
  budget: ZipBudget = callBudget(dependencies),
): Promise<ReadTextResult> {
  const result = emptyResult();
  const projectOptions = { ...options, budget, openZip: dependencies.openZip };
  let count = 0;
  for (const [index, file] of files.entries()) {
    options.signal?.throwIfAborted();
    options.onProgress?.({ label: `Reading ${file.name}`, completed: index, total: files.length });
    const problem = sizeProblem(file, count, budget);
    if (problem) {
      result.rejected.push({ name: file.name, reason: problem });
      continue;
    }
    try {
      if (isZipName(file.name)) {
        addProject(result, await readZipProject(file, projectOptions));
      } else {
        result.sources.push(await readStandalone(file, options, dependencies));
        budget.remaining -= file.size;
      }
      count += 1;
    } catch (error) {
      result.rejected.push(rejectionFor(file.name, error, options.signal));
    }
  }
  options.onProgress?.({ label: "Done", completed: files.length, total: files.length });
  return result;
}

/**
 * Each top-level folder becomes its own project, named after the folder. Files with no folder
 * in their path are read as standalone files.
 */
export async function readFolder(
  entries: readonly { file: File; path: string }[],
  options: ReadTextOptions,
  dependencies: ReadDependencies = {},
): Promise<ReadTextResult> {
  const result = emptyResult();
  const budget = callBudget(dependencies);
  const folders = new Map<string, { file: File; path: string }[]>();
  const loose: File[] = [];
  for (const { file, path } of entries) {
    // Paths from a dropped folder start with "/"; those from <input webkitdirectory> don't.
    const fullPath = (path || file.webkitRelativePath || file.name).replace(/^\/+/, "");
    const slash = fullPath.indexOf("/");
    if (slash < 0) {
      loose.push(file);
      continue;
    }
    const root = fullPath.slice(0, slash);
    const group = folders.get(root) ?? [];
    group.push({ file, path: fullPath.slice(slash + 1) });
    folders.set(root, group);
  }

  for (const [root, group] of folders) {
    options.signal?.throwIfAborted();
    try {
      addProject(result, await readFolderProject(root, group, { ...options, budget }));
    } catch (error) {
      result.rejected.push(rejectionFor(root, error, options.signal));
    }
  }
  if (loose.length > 0) {
    const standalone = await readFiles(loose, options, dependencies, budget);
    result.sources.push(...standalone.sources);
    result.projects.push(...standalone.projects);
    result.rejected.push(...standalone.rejected);
  }
  return result;
}
