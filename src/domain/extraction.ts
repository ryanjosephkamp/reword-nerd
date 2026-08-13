import type { DocumentFormat } from "./contracts";
import type { ExtractionOptions, LatexProjectMetadata, OcrCandidate, ProcessingProgress, VisualAsset } from "./media";
import {
  cloneExtractionOptions,
  DEFAULT_EXTRACTION_OPTIONS,
  MAX_VISUAL_ASSET_BYTES_PER_DOCUMENT,
  MAX_VISUAL_ASSETS_PER_DOCUMENT,
  MAX_OCR_PAGES,
  selectedPages,
} from "./media";
import { analyzeStandaloneLatex, extractLatexProject, LatexArchiveError, validateLatexProjectArchive } from "./latex";
import { extractMarkdownMedia } from "./markdownMedia";
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
  | "HASH_UNAVAILABLE"
  | "UNSAFE_ARCHIVE"
  | "ARCHIVE_LIMIT_EXCEEDED"
  | "INVALID_LATEX_PROJECT";

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
  pageCount?: number | null;
  visualAssets?: VisualAsset[];
  ocrCandidates?: OcrCandidate[];
  extractionOptions?: ExtractionOptions;
  latexProject?: LatexProjectMetadata;
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
  extractRasterImages?(): Promise<readonly PdfRasterImage[]>;
  renderToPng?(scale: number): Promise<PdfRenderedImage>;
  cleanup?(): void | Promise<void>;
}

export interface PdfRasterImage extends PdfRenderedImage {
  mimeType: string;
  bounds?: { x: number; y: number; width: number; height: number };
}

export interface PdfRenderedImage {
  bytes: Uint8Array;
  width: number;
  height: number;
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
      convertImage(image: DocxImageAdapter): Promise<{ src: string; alt?: string }>;
    },
  ): Promise<{ value: string; messages: readonly DocxMessage[] }>;
}

export interface DocxImageAdapter {
  contentType: string;
  altText?: string;
  read(format: "base64"): Promise<string>;
}

export interface ExtractionDependencies {
  hasher?: HashAdapter | null;
  existingDocuments?: readonly ExistingExtractedDocument[];
  pdfAdapter?: PdfAdapter;
  docxAdapter?: DocxConverterAdapter;
  options?: ExtractionOptions;
  ocrAdapter?: OcrAdapter;
  signal?: AbortSignal;
  onProgress?: (progress: ProcessingProgress) => void;
}

export interface OcrAdapter {
  recognize(
    image: PdfRenderedImage,
    context: {
      pageNumber: number;
      language: ExtractionOptions["ocrLanguage"];
      signal?: AbortSignal;
      onProgress?: (progress: number) => void;
    },
  ): Promise<{ text: string; confidence: number; engineVersion: string; languageHash: string }>;
  terminate?(): void | Promise<void>;
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
  UNSAFE_ARCHIVE: "This archive contains an unsafe path, link, duplicate, or encrypted entry.",
  ARCHIVE_LIMIT_EXCEEDED: "This archive exceeds the permitted project safety limits.",
  INVALID_LATEX_PROJECT: "This archive is not a valid LaTeX project.",
};

function formatPageNumbers(pages: readonly number[]): string {
  if (pages.length < 2) return String(pages[0]);
  if (pages.length === 2) return `${pages[0]} and ${pages[1]}`;
  return `${pages.slice(0, -1).join(", ")}, and ${pages.at(-1)}`;
}

function textlessPagesWarning(pages: readonly number[]): string {
  return pages.length === 1
    ? `Page ${pages[0]} does not contain selectable text.`
    : `Pages ${formatPageNumbers(pages)} do not contain selectable text.`;
}

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
    case ".tex":
    case ".ltx":
      return "latex";
    case ".zip":
      return "latex-project";
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
  if (format === "text" || format === "markdown" || format === "latex") {
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
    if (format === "latex-project") {
      try {
        await validateLatexProjectArchive(bytes);
        return undefined;
      } catch (error) {
        if (error instanceof LatexArchiveError) return issue(error.code);
        return issue("INVALID_LATEX_PROJECT");
      }
    }
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
  options: ExtractionOptions = cloneExtractionOptions(DEFAULT_EXTRACTION_OPTIONS),
  hasher: HashAdapter | null = defaultHashAdapter(),
  ocrAdapter?: OcrAdapter,
  signal?: AbortSignal,
  onProgress?: (progress: ProcessingProgress) => void,
): Promise<{
  text: string;
  warnings: string[];
  assets: VisualAsset[];
  pageCount: number;
  textlessPages: number[];
  ocrCandidates: OcrCandidate[];
}> {
  let loadingTask: PdfLoadingTaskAdapter | undefined;
  let document: PdfDocumentAdapter | undefined;
  try {
    loadingTask = adapter.load(bytes.slice());
    document = await loadingTask.promise;
    const totalPages = document.numPages;
    const pageTexts: string[] = [];
    const textlessPages: number[] = [];
    const assets: VisualAsset[] = [];
    const ocrCandidates: OcrCandidate[] = [];
    const visualPages = new Set(selectedPages(options.pageSelection, totalPages));
    let visualBytes = 0;
    let limitWarningAdded = false;
    let ocrLimitReached = false;
    const addAsset = async (
      candidate: PdfRenderedImage & { mimeType: string; bounds?: PdfRasterImage["bounds"] },
      pageNumber: number,
      kind: "pdf-raster" | "pdf-page-capture",
      order: number,
    ) => {
      if (assets.length >= MAX_VISUAL_ASSETS_PER_DOCUMENT
        || visualBytes + candidate.bytes.byteLength > MAX_VISUAL_ASSET_BYTES_PER_DOCUMENT) {
        limitWarningAdded = true;
        return;
      }
      const sha256 = await hashBytes(
        candidate.bytes.buffer.slice(candidate.bytes.byteOffset, candidate.bytes.byteOffset + candidate.bytes.byteLength),
        hasher,
      );
      const decorative = kind === "pdf-raster" && (candidate.width < 16 || candidate.height < 16);
      assets.push({
        id: `asset-${sha256.slice(0, 12)}-p${pageNumber}-${order + 1}`,
        kind,
        filename: `${kind === "pdf-page-capture" ? "page" : "figure"}-${pageNumber}-${order + 1}.png`,
        mimeType: candidate.mimeType,
        bytes: candidate.bytes.slice(),
        byteCount: candidate.bytes.byteLength,
        sha256,
        order: assets.length,
        pageNumber,
        width: candidate.width,
        height: candidate.height,
        ...(candidate.bounds ? { bounds: { ...candidate.bounds } } : {}),
        included: !(options.excludeDecorativeImages && decorative),
        decorative,
        warnings: decorative ? ["This small PDF image may be decorative; review its inclusion."] : [],
      });
      visualBytes += candidate.bytes.byteLength;
    };
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        if (signal?.aborted) throw new DOMException("Processing cancelled.", "AbortError");
        const content = await page.getTextContent();
        const pageText = content.items.map((item) => `${item.str}${item.hasEOL ? "\n" : ""}`).join("");
        if (pageText.trim().length === 0) textlessPages.push(pageNumber);
        pageTexts.push(`--- Page ${pageNumber} ---\n\n${pageText}`);
        if (visualPages.has(pageNumber) && options.extractEmbeddedImages && page.extractRasterImages) {
          const images = await page.extractRasterImages();
          for (const [order, image] of images.entries()) await addAsset(image, pageNumber, "pdf-raster", order);
        }
        if (visualPages.has(pageNumber) && options.capturePageVisuals && page.renderToPng) {
          const capture = await page.renderToPng(options.pageCaptureQuality === "high" ? 3 : 2);
          await addAsset({ ...capture, mimeType: "image/png" }, pageNumber, "pdf-page-capture", 0);
        }
        const wantsOcr = visualPages.has(pageNumber)
          && options.ocrMode !== "off"
          && (options.ocrMode === "all-pages" || pageText.trim().length === 0);
        if (wantsOcr) {
          if (ocrCandidates.length >= MAX_OCR_PAGES) {
            ocrLimitReached = true;
          } else if (ocrAdapter && page.renderToPng) {
            const image = await page.renderToPng(200 / 72);
            const recognized = await ocrAdapter.recognize(image, {
              pageNumber,
              language: options.ocrLanguage,
              signal,
              onProgress: (fraction) => onProgress?.({
                phase: "ocr",
                completed: Math.min(totalPages, pageNumber - 1 + fraction),
                total: Math.min(totalPages, MAX_OCR_PAGES),
                message: `Recognizing page ${pageNumber}…`,
              }),
            });
            if (recognized.text.trim()) {
              ocrCandidates.push({
                id: `ocr-page-${pageNumber}`,
                source: { kind: "page", pageNumber },
                text: recognized.text,
                reviewedText: recognized.text,
                confidence: Math.max(0, Math.min(100, recognized.confidence)),
                status: "pending",
                engine: "tesseract.js",
                engineVersion: recognized.engineVersion,
                languageCode: options.ocrLanguage.code,
                languageHash: recognized.languageHash,
              });
            }
          }
        }
        onProgress?.({
          phase: options.ocrMode === "off" ? "text" : "ocr",
          completed: pageNumber,
          total: totalPages,
          message: `Processed page ${pageNumber} of ${totalPages}.`,
        });
      } finally {
        await page.cleanup?.();
      }
    }
    if (textlessPages.length === totalPages
      && (options.ocrMode === "off" || ocrCandidates.length === 0)) {
      throw new FileExtractionError(issue("PDF_TEXTLESS"));
    }
    const warnings = textlessPages.length > 0
      ? [textlessPagesWarning(textlessPages)]
      : [];
    if (limitWarningAdded) warnings.push("The PDF visual-asset limit was reached; additional visuals were omitted.");
    if (ocrCandidates.length > 0) warnings.push("Review every OCR candidate before confirming the extraction.");
    if (ocrLimitReached) warnings.push(`The ${MAX_OCR_PAGES}-page OCR limit was reached; additional pages were not recognized.`);
    return {
      text: pageTexts.join("\n\n"),
      warnings,
      assets,
      pageCount: totalPages,
      textlessPages,
      ocrCandidates,
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
  turndown.addRule("controlled-docx-images", {
    filter: "img",
    replacement: (_content, node) => {
      const element = node as HTMLImageElement;
      const source = element.getAttribute("src") ?? "";
      if (!/^asset:asset-[a-f0-9]{12}$/.test(source)) return "";
      const alt = (element.getAttribute("alt") ?? "").replaceAll("[", "").replaceAll("]", "").trim();
      return `![${alt}](${source})`;
    },
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
  hasher: HashAdapter | null = defaultHashAdapter(),
  captureImages = true,
): Promise<{ markdown: string; warnings: string[]; assets: VisualAsset[] }> {
  try {
    const assetsByHash = new Map<string, VisualAsset>();
    let imageOrder = 0;
    const convertImage = async (image: DocxImageAdapter): Promise<{ src: string; alt?: string }> => {
      if (!captureImages) return { src: "", ...(image.altText ? { alt: image.altText } : {}) };
      const encoded = await image.read("base64");
      let imageBytes: Uint8Array;
      try {
        imageBytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
      } catch {
        throw new FileExtractionError(issue("DOCX_CONVERSION_FAILED"));
      }
      const sha256 = await hashBytes(
        imageBytes.buffer.slice(imageBytes.byteOffset, imageBytes.byteOffset + imageBytes.byteLength),
        hasher,
      );
      const id = `asset-${sha256.slice(0, 12)}`;
      if (!assetsByHash.has(sha256)) {
        const imageExtensions: Record<string, string> = {
          "image/png": "png",
          "image/jpeg": "jpg",
          "image/gif": "gif",
          "image/webp": "webp",
          "image/svg+xml": "svg",
          "image/tiff": "tiff",
        };
        const extension = imageExtensions[image.contentType.toLowerCase()] ?? "bin";
        assetsByHash.set(sha256, {
          id,
          kind: "docx-media",
          filename: `${id}.${extension}`,
          mimeType: image.contentType || "application/octet-stream",
          bytes: imageBytes,
          byteCount: imageBytes.byteLength,
          sha256,
          order: imageOrder,
          altText: image.altText?.trim() || undefined,
          included: true,
          decorative: false,
          warnings: extension === "svg" || extension === "tiff" || extension === "bin"
            ? ["This DOCX image is preserved but is not rendered directly in the workbench."]
            : [],
        });
        imageOrder += 1;
      }
      return { src: `asset:${id}`, ...(image.altText ? { alt: image.altText } : {}) };
    };
    const result = await adapter.convertToHtml(
      { arrayBuffer: bytes },
      {
        styleMap: [],
        includeEmbeddedStyleMap: false,
        externalFileAccess: false,
        ignoreEmptyParagraphs: false,
        convertImage,
      },
    );
    if (result.messages.some((message) => message.type === "error")) {
      throw new FileExtractionError(issue("DOCX_CONVERSION_FAILED"));
    }
    const omittedImages = Array.from(result.value.matchAll(/<img\b[^>]*\bsrc=["']([^"']*)["'][^>]*>/gi))
      .filter((match) => !/^asset:asset-[a-f0-9]{12}$/.test(match[1])).length;
    const markdown = htmlToGfm(result.value);
    if (markdown.trim().length === 0) {
      throw new FileExtractionError(issue("EMPTY_CONTENT"));
    }
    return {
      markdown,
      warnings: [
        ...result.messages.map((message) => safeDocxWarning(message.message)),
        ...(omittedImages === 0 ? [] : [omittedImages === 1
          ? "An embedded image was omitted from DOCX extraction."
          : `${omittedImages} embedded images were omitted from DOCX extraction.`]),
      ],
      assets: [...assetsByHash.values()],
    };
  } catch (error) {
    if (error instanceof FileExtractionError) throw error;
    throw new FileExtractionError(issue("DOCX_CONVERSION_FAILED"));
  }
}

const browserDocxAdapter: DocxConverterAdapter = {
  convertToHtml: (input, options) => {
    const { convertImage, ...safeOptions } = options;
    const mammothOptions = {
      ...safeOptions,
      convertImage: mammoth.images.imgElement(async (image) => convertImage({
        contentType: image.contentType,
        altText: (image as unknown as { altText?: string }).altText,
        read: (format: "base64") => image.read(format),
      })),
    };
    return mammoth.convertToHtml(input, mammothOptions);
  },
};

export async function extractFile(
  accepted: PreflightAccepted,
  dependencies: ExtractionDependencies = {},
): Promise<ExtractionResult> {
  const hasher = dependencies.hasher ?? defaultHashAdapter();
  const extractionOptions = cloneExtractionOptions(dependencies.options ?? DEFAULT_EXTRACTION_OPTIONS);
  const activeOcrAdapter = extractionOptions.ocrMode === "off" && !extractionOptions.ocrExtractedAssets
    ? undefined
    : dependencies.ocrAdapter ?? await import("./ocrBrowser").then(({ loadBrowserOcrAdapter }) => loadBrowserOcrAdapter());
  const originalHash = await hashBytes(accepted.originalBytes, hasher);
  let extractedText: string;
  let warnings: string[] = [];

  let pageCount: number | null = null;
  let visualAssets: VisualAsset[] = [];
  let ocrCandidates: OcrCandidate[] = [];
  let latexProject: LatexProjectMetadata | undefined;
  if (accepted.format === "text") {
    extractedText = decodeText(accepted.originalBytes);
  } else if (accepted.format === "markdown") {
    const markdown = await extractMarkdownMedia(
      decodeText(accepted.originalBytes),
      extractionOptions.extractEmbeddedImages,
      hasher,
    );
    extractedText = markdown.text;
    warnings = markdown.warnings;
    visualAssets = markdown.assets;
  } else if (accepted.format === "latex") {
    extractedText = decodeText(accepted.originalBytes);
    warnings = analyzeStandaloneLatex(extractedText);
  } else if (accepted.format === "latex-project") {
    const project = await extractLatexProject(new Uint8Array(accepted.originalBytes), hasher);
    extractedText = project.text;
    warnings = project.warnings;
    visualAssets = extractionOptions.extractEmbeddedImages ? project.assets : [];
    if (!extractionOptions.extractEmbeddedImages && project.assets.length > 0) {
      warnings = [...warnings, "LaTeX visual assets were cataloged but not extracted because image extraction is off."];
    }
    latexProject = project.project;
  } else if (accepted.format === "pdf") {
    const adapter = dependencies.pdfAdapter
      ? dependencies.pdfAdapter
      : await import("./pdfBrowser").then(({ loadBrowserPdfAdapter }) => loadBrowserPdfAdapter());
    const pdf = await extractPdfWithAdapter(
      new Uint8Array(accepted.originalBytes),
      adapter,
      extractionOptions,
      hasher,
      activeOcrAdapter,
      dependencies.signal,
      dependencies.onProgress,
    );
    extractedText = pdf.text;
    warnings = pdf.warnings;
    pageCount = pdf.pageCount;
    visualAssets = pdf.assets;
    ocrCandidates = pdf.ocrCandidates;
  } else {
    const docx = await extractDocxWithAdapter(
      accepted.originalBytes,
      dependencies.docxAdapter ?? browserDocxAdapter,
      hasher,
      extractionOptions.extractEmbeddedImages,
    );
    extractedText = docx.markdown;
    warnings = docx.warnings;
    visualAssets = docx.assets;
  }

  if (extractionOptions.ocrExtractedAssets && activeOcrAdapter) {
    const supportedMimeTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
    for (const asset of visualAssets) {
      if (ocrCandidates.length >= MAX_OCR_PAGES) {
        warnings = [...warnings, `The ${MAX_OCR_PAGES}-item OCR limit was reached; additional visual assets were not recognized.`];
        break;
      }
      if (!asset.included || !supportedMimeTypes.has(asset.mimeType)) continue;
      const recognized = await activeOcrAdapter.recognize({
        bytes: asset.bytes,
        width: asset.width ?? 0,
        height: asset.height ?? 0,
      }, {
        pageNumber: asset.pageNumber ?? 0,
        language: extractionOptions.ocrLanguage,
        signal: dependencies.signal,
        onProgress: (fraction) => dependencies.onProgress?.({
          phase: "ocr",
          completed: fraction,
          total: 1,
          message: `Recognizing ${asset.filename}…`,
        }),
      });
      if (!recognized.text.trim()) continue;
      ocrCandidates.push({
        id: `ocr-${asset.id}`,
        source: { kind: "asset", assetId: asset.id },
        text: recognized.text,
        reviewedText: recognized.text,
        confidence: Math.max(0, Math.min(100, recognized.confidence)),
        status: "pending",
        engine: "tesseract.js",
        engineVersion: recognized.engineVersion,
        languageCode: extractionOptions.ocrLanguage.code,
        languageHash: recognized.languageHash,
      });
    }
    if (ocrCandidates.some((candidate) => candidate.source.kind === "asset")) {
      warnings = [...warnings, "Review every visual-asset OCR candidate before confirming the extraction."];
    }
  }

  const duplicateOf = dependencies.existingDocuments?.find(
    (document) => document.originalHash === originalHash,
  )?.id;
  if (duplicateOf) warnings = [...warnings, "This file duplicates an existing document and needs review."];
  return {
    format: accepted.format,
    extractedText,
    warnings,
    pageCount,
    visualAssets,
    ocrCandidates,
    extractionOptions,
    ...(latexProject ? { latexProject } : {}),
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
