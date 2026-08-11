import type { DocumentFormat } from "./contracts";
import JSZip from "jszip";
import mammoth from "mammoth";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

export const MAX_FILE_COUNT = 20;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

export type FileIssueCode =
  | "MAX_FILE_COUNT"
  | "FILE_TOO_LARGE"
  | "TOTAL_TOO_LARGE"
  | "UNSUPPORTED_EXTENSION"
  | "EMPTY_FILE"
  | "EMPTY_CONTENT"
  | "SIGNATURE_MISMATCH"
  | "INVALID_UTF8"
  | "INVALID_DOCX"
  | "DOCX_CONVERSION_FAILED"
  | "PDF_INVALID"
  | "PDF_ENCRYPTED"
  | "PDF_TEXTLESS"
  | "PDF_EXTRACTION_FAILED"
  | "FILE_READ_FAILED"
  | "HASH_UNAVAILABLE";

export interface FileIssue {
  code: FileIssueCode;
  message: string;
}

export interface PreflightAccepted {
  accepted: true;
  file: File;
  format: DocumentFormat;
  originalBytes: ArrayBuffer;
}

export interface PreflightRejected {
  accepted: false;
  file: File;
  issue: FileIssue;
}

export type PreflightResult = PreflightAccepted | PreflightRejected;

export interface PreflightCapacity {
  acceptedCount?: number;
  acceptedBytes?: number;
}

export interface HashAdapter {
  digest(bytes: ArrayBuffer): Promise<ArrayBufferLike>;
}

export interface ExtractionResult {
  format: DocumentFormat;
  extractedText: string;
  warnings: string[];
  originalHash: string;
  extractedTextHash: string;
  requiresReview: boolean;
  duplicateOf?: string;
}

export interface ExistingExtractedDocument {
  id: string;
  originalHash: string;
}

export interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
}

export interface PdfPageAdapter {
  getTextContent(): Promise<{ items: readonly PdfTextItem[] }>;
}

export interface PdfDocumentAdapter {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageAdapter>;
  destroy?(): void | Promise<void>;
}

export interface PdfLoadingTaskAdapter {
  promise: Promise<PdfDocumentAdapter>;
  destroy?(): void | Promise<void>;
}

export interface PdfAdapter {
  load(bytes: Uint8Array): PdfLoadingTaskAdapter;
}

export interface DocxMessage {
  type: "warning" | "error";
  message: string;
}

export interface DocxConverterAdapter {
  convertToHtml(
    input: { arrayBuffer: ArrayBuffer },
    options: {
      styleMap: string[];
      includeEmbeddedStyleMap: false;
      externalFileAccess: false;
      ignoreEmptyParagraphs: false;
    },
  ): Promise<{ value: string; messages: readonly DocxMessage[] }>;
}

export interface ExtractionDependencies {
  hasher?: HashAdapter | null;
  existingDocuments?: readonly ExistingExtractedDocument[];
  pdfAdapter?: PdfAdapter;
  docxAdapter?: DocxConverterAdapter;
}

const ISSUE_MESSAGES: Record<FileIssueCode, string> = {
  MAX_FILE_COUNT: "The maximum number of files has been reached.",
  FILE_TOO_LARGE: "This file is larger than the permitted size.",
  TOTAL_TOO_LARGE: "Adding this file would exceed the permitted total size.",
  UNSUPPORTED_EXTENSION: "This file type is not supported.",
  EMPTY_FILE: "Empty files cannot be reviewed.",
  EMPTY_CONTENT: "This file does not contain reviewable content.",
  SIGNATURE_MISMATCH: "The file contents do not match its declared format.",
  INVALID_UTF8: "This text file is not valid UTF-8.",
  INVALID_DOCX: "This DOCX file is not a valid Word document.",
  DOCX_CONVERSION_FAILED: "This DOCX file could not be converted safely.",
  PDF_INVALID: "This PDF file is invalid or unsupported.",
  PDF_ENCRYPTED: "Password-protected PDFs cannot be reviewed.",
  PDF_TEXTLESS: "This PDF does not contain selectable text.",
  PDF_EXTRACTION_FAILED: "This PDF could not be extracted safely.",
  FILE_READ_FAILED: "This file could not be read safely.",
  HASH_UNAVAILABLE: "A browser hashing capability is unavailable.",
};

function issue(code: FileIssueCode): FileIssue {
  return { code, message: ISSUE_MESSAGES[code] };
}

export function formatFromName(name: string): DocumentFormat | undefined {
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
  switch (extension) {
    case ".txt":
      return "text";
    case ".md":
    case ".markdown":
      return "markdown";
    case ".docx":
      return "docx";
    case ".pdf":
      return "pdf";
    default:
      return undefined;
  }
}

function hasZipSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && ((bytes[2] === 0x03 && bytes[3] === 0x04)
      || (bytes[2] === 0x05 && bytes[3] === 0x06)
      || (bytes[2] === 0x07 && bytes[3] === 0x08));
}

function hasPdfSignature(bytes: Uint8Array): boolean {
  const lastStart = Math.min(bytes.length - 5, 1_023);
  for (let offset = 0; offset <= lastStart; offset += 1) {
    if (bytes[offset] === 0x25
      && bytes[offset + 1] === 0x50
      && bytes[offset + 2] === 0x44
      && bytes[offset + 3] === 0x46
      && bytes[offset + 4] === 0x2d) {
      return true;
    }
  }
  return false;
}

async function validateAdmittedBytes(format: DocumentFormat, originalBytes: ArrayBuffer): Promise<FileIssue | undefined> {
  const bytes = new Uint8Array(originalBytes);
  if (format === "text" || format === "markdown") {
    let decoded: string;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return issue("INVALID_UTF8");
    }
    if (decoded.includes("\0") || decoded.trim().length === 0) {
      return issue("EMPTY_CONTENT");
    }
    return undefined;
  }
  if (format === "pdf") {
    return hasPdfSignature(bytes) ? undefined : issue("SIGNATURE_MISMATCH");
  }
  if (!hasZipSignature(bytes)) {
    return issue("SIGNATURE_MISMATCH");
  }
  try {
    const packageData = await JSZip.loadAsync(originalBytes);
    return packageData.file("[Content_Types].xml") && packageData.file("word/document.xml")
      ? undefined
      : issue("INVALID_DOCX");
  } catch {
    return issue("INVALID_DOCX");
  }
}

function defaultHashAdapter(): HashAdapter | null {
  const subtle = globalThis.crypto?.subtle;
  return subtle
    ? { digest: (bytes) => subtle.digest("SHA-256", bytes) }
    : null;
}

export async function hashBytes(bytes: ArrayBufferLike, adapter: HashAdapter | null = defaultHashAdapter()): Promise<string> {
  if (!adapter) {
    throw new FileExtractionError(issue("HASH_UNAVAILABLE"));
  }
  try {
    const ownedBytes = new Uint8Array(bytes).slice().buffer;
    const digest = new Uint8Array(await adapter.digest(ownedBytes));
    if (digest.byteLength !== 32) {
      throw new FileExtractionError(issue("HASH_UNAVAILABLE"));
    }
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    throw new FileExtractionError(issue("HASH_UNAVAILABLE"));
  }
}

function decodeText(originalBytes: ArrayBuffer): string {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(originalBytes);
    if (decoded.includes("\0") || decoded.trim().length === 0) {
      throw new FileExtractionError(issue("EMPTY_CONTENT"));
    }
    return decoded;
  } catch (error) {
    if (error instanceof FileExtractionError) throw error;
    throw new FileExtractionError(issue("INVALID_UTF8"));
  }
}

function pdfIssueFor(error: unknown): FileIssue {
  const name = error instanceof Error ? error.name : "";
  if (name === "PasswordException") return issue("PDF_ENCRYPTED");
  if (name === "InvalidPDFException" || name === "FormatError") return issue("PDF_INVALID");
  return issue("PDF_EXTRACTION_FAILED");
}

async function destroyPdfResource(
  resource: PdfDocumentAdapter | PdfLoadingTaskAdapter | undefined,
): Promise<void> {
  try {
    await resource?.destroy?.();
  } catch {
    // Cleanup errors are intentionally not user-facing extraction errors.
  }
}

export async function extractPdfWithAdapter(
  bytes: Uint8Array,
  adapter: PdfAdapter,
): Promise<{ text: string; warnings: string[] }> {
  let loadingTask: PdfLoadingTaskAdapter | undefined;
  let document: PdfDocumentAdapter | undefined;
  try {
    loadingTask = adapter.load(bytes.slice());
    document = await loadingTask.promise;
    const pageTexts: string[] = [];
    const textlessPages: number[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => `${item.str}${item.hasEOL ? "\n" : ""}`).join("");
      if (pageText.trim().length === 0) textlessPages.push(pageNumber);
      pageTexts.push(`--- Page ${pageNumber} ---\n\n${pageText}`);
    }
    if (textlessPages.length === document.numPages) {
      throw new FileExtractionError(issue("PDF_TEXTLESS"));
    }
    return {
      text: pageTexts.join("\n\n"),
      warnings: textlessPages.length > 0
        ? [`Pages ${textlessPages.join(", ")} do not contain selectable text.`]
        : [],
    };
  } catch (error) {
    if (error instanceof FileExtractionError) throw error;
    throw new FileExtractionError(pdfIssueFor(error));
  } finally {
    await destroyPdfResource(document);
    await destroyPdfResource(loadingTask);
  }
}

export function htmlToGfm(html: string): string {
  const turndown = new TurndownService({
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "_",
    headingStyle: "atx",
  });
  turndown.use(gfm);
  turndown.addRule("omit-docx-images", {
    filter: "img",
    replacement: () => "",
  });
  turndown.addRule("deterministic-strikethrough", {
    filter: (node) => ["DEL", "S", "STRIKE"].includes(node.nodeName),
    replacement: (content) => `~~${content}~~`,
  });
  return turndown.turndown(html).trim();
}

function safeDocxWarning(message: string): string {
  const oneLine = message.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  const withoutPaths = oneLine.replace(/(?:[A-Za-z]:)?(?:\\|\/)[^\s]+/g, "the document");
  const bounded = withoutPaths.slice(0, 180).trim();
  return `DOCX conversion warning: ${bounded || "A conversion warning was reported."}`;
}

export async function extractDocxWithAdapter(
  bytes: ArrayBuffer,
  adapter: DocxConverterAdapter,
): Promise<{ markdown: string; warnings: string[] }> {
  try {
    const result = await adapter.convertToHtml(
      { arrayBuffer: bytes },
      {
        styleMap: [],
        includeEmbeddedStyleMap: false,
        externalFileAccess: false,
        ignoreEmptyParagraphs: false,
      },
    );
    if (result.messages.some((message) => message.type === "error")) {
      throw new FileExtractionError(issue("DOCX_CONVERSION_FAILED"));
    }
    const omittedImages = result.value.match(/<img\b/gi)?.length ?? 0;
    const markdown = htmlToGfm(result.value);
    if (markdown.trim().length === 0) {
      throw new FileExtractionError(issue("EMPTY_CONTENT"));
    }
    return {
      markdown,
      warnings: [
        ...result.messages.map((message) => safeDocxWarning(message.message)),
        ...(omittedImages === 0
          ? []
          : [omittedImages === 1
            ? "An embedded image was omitted from DOCX extraction."
            : "Embedded images were omitted from DOCX extraction."]),
      ],
    };
  } catch (error) {
    if (error instanceof FileExtractionError) throw error;
    throw new FileExtractionError(issue("DOCX_CONVERSION_FAILED"));
  }
}

const browserDocxAdapter: DocxConverterAdapter = {
  convertToHtml: (input, options) => mammoth.convertToHtml(input, options),
};

export async function extractFile(
  accepted: PreflightAccepted,
  dependencies: ExtractionDependencies = {},
): Promise<ExtractionResult> {
  const hasher = dependencies.hasher ?? defaultHashAdapter();
  const originalHash = await hashBytes(accepted.originalBytes, hasher);
  let extractedText: string;
  let warnings: string[] = [];

  if (accepted.format === "text" || accepted.format === "markdown") {
    extractedText = decodeText(accepted.originalBytes);
  } else if (accepted.format === "pdf") {
    const adapter = dependencies.pdfAdapter
      ? dependencies.pdfAdapter
      : await import("./pdfBrowser").then(({ loadBrowserPdfAdapter }) => loadBrowserPdfAdapter());
    const pdf = await extractPdfWithAdapter(new Uint8Array(accepted.originalBytes), adapter);
    extractedText = pdf.text;
    warnings = pdf.warnings;
  } else {
    const docx = await extractDocxWithAdapter(
      accepted.originalBytes,
      dependencies.docxAdapter ?? browserDocxAdapter,
    );
    extractedText = docx.markdown;
    warnings = docx.warnings;
  }

  const duplicateOf = dependencies.existingDocuments?.find(
    (document) => document.originalHash === originalHash,
  )?.id;
  if (duplicateOf) warnings = [...warnings, "This file duplicates an existing document and needs review."];
  return {
    format: accepted.format,
    extractedText,
    warnings,
    originalHash,
    extractedTextHash: await hashBytes(new TextEncoder().encode(extractedText).buffer, hasher),
    requiresReview: true,
    ...(duplicateOf ? { duplicateOf } : {}),
  };
}

export async function editExtractedText(
  extraction: ExtractionResult,
  extractedText: string,
  hasher: HashAdapter | null = defaultHashAdapter(),
): Promise<ExtractionResult> {
  return {
    ...extraction,
    warnings: [...extraction.warnings],
    extractedText,
    extractedTextHash: await hashBytes(new TextEncoder().encode(extractedText).buffer, hasher),
    requiresReview: true,
  };
}

export function confirmExtractionReview(extraction: ExtractionResult): ExtractionResult {
  return { ...extraction, warnings: [...extraction.warnings], requiresReview: false };
}

export async function preflightFiles(
  files: readonly File[],
  capacity: PreflightCapacity = {},
): Promise<PreflightResult[]> {
  let acceptedCount = capacity.acceptedCount ?? 0;
  let acceptedBytes = capacity.acceptedBytes ?? 0;
  const results: PreflightResult[] = [];

  for (const file of files) {
    const format = formatFromName(file.name);
    if (!format) {
      results.push({ accepted: false, file, issue: issue("UNSUPPORTED_EXTENSION") });
      continue;
    }
    if (file.size === 0) {
      results.push({ accepted: false, file, issue: issue("EMPTY_FILE") });
      continue;
    }
    if (acceptedCount >= MAX_FILE_COUNT) {
      results.push({ accepted: false, file, issue: issue("MAX_FILE_COUNT") });
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      results.push({ accepted: false, file, issue: issue("FILE_TOO_LARGE") });
      continue;
    }
    if (acceptedBytes + file.size > MAX_TOTAL_BYTES) {
      results.push({ accepted: false, file, issue: issue("TOTAL_TOO_LARGE") });
      continue;
    }

    let originalBytes: ArrayBuffer;
    try {
      originalBytes = await file.arrayBuffer();
    } catch {
      results.push({ accepted: false, file, issue: issue("FILE_READ_FAILED") });
      continue;
    }
    const byteIssue = await validateAdmittedBytes(format, originalBytes);
    if (byteIssue) {
      results.push({ accepted: false, file, issue: byteIssue });
      continue;
    }
    results.push({ accepted: true, file, format, originalBytes });
    acceptedCount += 1;
    acceptedBytes += file.size;
  }

  return results;
}

export class FileExtractionError extends Error {
  readonly issue: FileIssue;

  constructor(fileIssue: FileIssue) {
    super(fileIssue.message);
    this.name = "FileExtractionError";
    this.issue = fileIssue;
  }
}
