export const MAX_OCR_PAGES = 150;
export const MAX_VISUAL_ASSETS_PER_DOCUMENT = 200;
export const MAX_VISUAL_ASSET_BYTES_PER_DOCUMENT = 100 * 1024 * 1024;
export const MAX_GENERATED_MEDIA_BYTES_PER_PACKAGE = 300 * 1024 * 1024;
export const MAX_FULL_HTML_BYTES = 150 * 1024 * 1024;

export type PageCaptureQuality = "standard" | "high";
export type OcrMode = "off" | "textless-pages" | "all-pages";

export type OcrLanguage =
  | { kind: "bundled"; code: "eng"; label: "English" }
  | { kind: "session"; code: string; label: string; trainedData: Uint8Array; sha256: string };

export interface ExtractionOptions {
  extractEmbeddedImages: boolean;
  capturePageVisuals: boolean;
  pageSelection: "all" | string;
  pageCaptureQuality: PageCaptureQuality;
  ocrMode: OcrMode;
  ocrExtractedAssets: boolean;
  ocrLanguage: OcrLanguage;
  excludeDecorativeImages: boolean;
}

export const DEFAULT_EXTRACTION_OPTIONS: Readonly<ExtractionOptions> = Object.freeze({
  extractEmbeddedImages: false,
  capturePageVisuals: false,
  pageSelection: "all",
  pageCaptureQuality: "standard",
  ocrMode: "off",
  ocrExtractedAssets: false,
  ocrLanguage: Object.freeze({ kind: "bundled", code: "eng", label: "English" }),
  excludeDecorativeImages: true,
});

export type VisualAssetKind =
  | "pdf-raster"
  | "pdf-page-capture"
  | "docx-media"
  | "markdown-data-image"
  | "latex-asset"
  | "latex-preview";

export interface VisualAssetBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualAsset {
  id: string;
  kind: VisualAssetKind;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  byteCount: number;
  sha256: string;
  order: number;
  pageNumber?: number;
  sourcePath?: string;
  bounds?: VisualAssetBounds;
  width?: number;
  height?: number;
  caption?: string;
  altText?: string;
  included: boolean;
  decorative: boolean;
  warnings: string[];
}

export type OcrReviewStatus = "pending" | "accepted" | "omitted";

export interface OcrCandidate {
  id: string;
  source: { kind: "page"; pageNumber: number } | { kind: "asset"; assetId: string };
  text: string;
  reviewedText: string;
  confidence: number;
  status: OcrReviewStatus;
  engine: "tesseract.js";
  engineVersion: string;
  languageCode: string;
  languageHash: string;
}

export interface LatexProjectFile {
  path: string;
  byteCount: number;
  sha256: string;
  kind: "tex" | "bibliography" | "visual" | "other";
}

export interface LatexProjectMetadata {
  mainFile: string | null;
  mainFileCandidates: string[];
  files: LatexProjectFile[];
  dependencies: Record<string, string[]>;
  missingDependencies: string[];
  cycles: string[][];
}

export interface ProcessingProgress {
  phase: "reading" | "text" | "images" | "ocr" | "finalizing";
  completed: number;
  total: number;
  message: string;
}

export function cloneExtractionOptions(options: ExtractionOptions): ExtractionOptions {
  return {
    ...options,
    ocrLanguage: options.ocrLanguage.kind === "bundled"
      ? { ...options.ocrLanguage }
      : { ...options.ocrLanguage, trainedData: options.ocrLanguage.trainedData.slice() },
  };
}

export function normalizePageSelection(selection: string, pageCount: number): number[] {
  if (!Number.isSafeInteger(pageCount) || pageCount <= 0) {
    throw new Error("Page range requires a positive document page count.");
  }
  const pages = new Set<number>();
  for (const token of selection.split(",").map((part) => part.trim()).filter(Boolean)) {
    const range = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(token);
    if (!range) throw new Error("Page range is invalid.");
    const first = Number(range[1]);
    const last = Number(range[2] ?? range[1]);
    if (first < 1 || last < first) throw new Error("Page range is invalid.");
    for (let page = first; page <= Math.min(last, pageCount); page += 1) pages.add(page);
  }
  if (pages.size === 0) throw new Error("Page range does not select a page.");
  return [...pages].sort((left, right) => left - right);
}

export function selectedPages(selection: ExtractionOptions["pageSelection"], pageCount: number): number[] {
  return selection === "all"
    ? Array.from({ length: pageCount }, (_, index) => index + 1)
    : normalizePageSelection(selection, pageCount);
}

export function composeExtractionWithOcr(baseText: string, candidates: readonly OcrCandidate[]): string {
  const accepted = candidates
    .filter((candidate) => candidate.status === "accepted" && candidate.reviewedText.trim())
    .sort((left, right) => {
      const leftOrder = left.source.kind === "page" ? left.source.pageNumber : Number.MAX_SAFE_INTEGER;
      const rightOrder = right.source.kind === "page" ? right.source.pageNumber : Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.id.localeCompare(right.id);
    });
  const blocks = accepted.map((candidate) => {
    const label = candidate.source.kind === "page" ? `Page ${candidate.source.pageNumber}` : `Asset ${candidate.source.assetId}`;
    return `--- Reviewed OCR: ${label} ---\n\n${candidate.reviewedText}`;
  });
  return [baseText, ...blocks].join("\n\n");
}
