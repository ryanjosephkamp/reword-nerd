import type { ContextAssessment } from "../domain/context";
import type { DocumentFormat, ManifestDocumentInput, PromptSet } from "../domain/contracts";
import type { HashAdapter } from "../domain/extraction";
import type { ModelProfile, PromptStage } from "../domain/profiles";
import type { RewriteSettings } from "../domain/settings";
import type { ExtractionOptions, LatexProjectMetadata, OcrCandidate, VisualAsset } from "../domain/media";

export interface ExportDocumentInput extends ManifestDocumentInput {
  original: File;
  reviewed: boolean;
  contextWarningAcknowledged: boolean;
  uploadOrdinal: number;
  pageCount?: number | null;
  extractionOptions?: ExtractionOptions;
  visualAssets?: readonly VisualAsset[];
  ocrCandidates?: readonly OcrCandidate[];
  latexProject?: LatexProjectMetadata & { projectRoot?: string };
}

export type ExportFailureCode =
  | "NO_DOCUMENTS"
  | "REVIEW_REQUIRED"
  | "CONTEXT_ACKNOWLEDGMENT_REQUIRED"
  | "INVALID_INPUT"
  | "HASH_UNAVAILABLE"
  | "FILE_READ_FAILED"
  | "ARCHIVE_GENERATION_FAILED";

export interface ExportFailure {
  code: ExportFailureCode;
  message: string;
  documentKey?: string;
}

export interface ManifestPromptRecord {
  path: string;
  sha256: string;
}

export interface ManifestAssetRecord {
  id: string;
  path?: string;
  sha256?: string;
  byteCount: number;
  mimeType: string;
  kind: VisualAsset["kind"];
  filename: string;
  order: number;
  pageNumber?: number;
  sourcePath?: string;
  bounds?: VisualAsset["bounds"];
  width?: number;
  height?: number;
  caption?: string;
  altText?: string;
  included: boolean;
  decorative: boolean;
  warnings: string[];
}

export interface ManifestOcrRecord {
  id: string;
  source: OcrCandidate["source"];
  confidence: number;
  status: OcrCandidate["status"];
  engine: OcrCandidate["engine"];
  engineVersion: string;
  languageCode: string;
  languageHash: string;
  rawTextSha256: string;
  reviewedTextSha256: string;
}

export type ManifestGeneratedArtifact =
  | { status: "generated"; path: string; sha256: string }
  | { status: "not-generated"; reason: "encoded-size-limit" };

export interface ManifestDocumentRecord {
  key: string;
  exportOrdinal: number;
  originalDisplayName: string;
  format: DocumentFormat;
  original: { path: string; byteCount: number; sha256: string };
  reviewedExtraction: { path: string; unicodeCodePointCount: number; sha256: string; warnings: string[] };
  settings: RewriteSettings;
  model: Pick<ModelProfile, "id" | "family" | "label" | "contextWindowTokens" | "lastReviewed" | "workflowNote"> & {
    promptStrategy: Pick<ModelProfile["promptStrategy"], "id" | "version" | "referenceModel" | "reviewedAt">;
  };
  contextAssessment: Pick<ContextAssessment,
    | "estimateLabel"
    | "sourceTokens"
    | "workflowTokens"
    | "contextWindowTokens"
    | "ratio"
    | "oversized"
    | "acknowledgmentRequired"
  >;
  contextWarningAcknowledged: boolean;
  prompts: Record<keyof PromptSet, ManifestPromptRecord>;
  processing: { pageCount: number | null; options: ExtractionOptions };
  visualAssets: {
    index: ManifestPromptRecord;
    placementMap: ManifestPromptRecord;
    records: ManifestAssetRecord[];
  };
  ocr: { path: string; sha256: string; records: ManifestOcrRecord[] };
  latexProject?: LatexProjectMetadata;
  combined: {
    markdown: ManifestPromptRecord;
    html: ManifestPromptRecord;
    fullHtml: ManifestGeneratedArtifact;
  };
}

export interface PromptPackageManifest {
  schemaVersion: 3;
  package: { name: "reword-nerd"; version: "0.3.0"; format: "manual-four-stage-prompt-package" };
  archive: {
    entryOrder: "lexicographic-code-unit-ascending";
    timestamp: "1980-01-01T00:00:00.000Z";
    originalCompression: "STORE";
    generatedCompression: "DEFLATE-9";
  };
  workflow: {
    mode: "manual";
    stages: ["decompose", "rewrite", "verify", "final"];
    responseMarkers: { stage1: string; stage2: string; stage3: string };
  };
  documents: ManifestDocumentRecord[];
}

export interface CombinedPromptBlock {
  stage: PromptStage;
  title: string;
  content: string;
}

export interface CombinedPromptRunbook {
  package: PromptPackageManifest["package"];
  documentKey: string;
  originalDisplayName: string;
  model: ManifestDocumentRecord["model"];
  settings: RewriteSettings;
  contextAssessment: ManifestDocumentRecord["contextAssessment"];
  contextWarningAcknowledged: boolean;
  responseMarkers: PromptPackageManifest["workflow"]["responseMarkers"];
}

export interface CombinedPromptArtifact {
  documentKey: string;
  originalDisplayName: string;
  runbook: Readonly<CombinedPromptRunbook>;
  runbookMarkdown: string;
  promptBlocks: readonly Readonly<CombinedPromptBlock>[];
  markdown: string;
  html: string;
  fullHtml?: string;
  fullHtmlStatus: ManifestGeneratedArtifact["status"];
  visualAssets: readonly VisualAsset[];
}

export type PromptPackageResult =
  | { ok: true; blob: Blob; filename: "reword-nerd-prompt-package.zip"; manifest: PromptPackageManifest; artifacts: readonly CombinedPromptArtifact[] }
  | { ok: false; error: ExportFailure };

export interface ExportDependencies {
  hasher?: HashAdapter | null;
  createArchive?: () => ArchiveAdapter;
}

export interface ArchiveAdapter {
  file(path: string, data: string | Uint8Array, options: Record<string, unknown>): void;
  generateAsync(options: Record<string, unknown>): Promise<Blob>;
}

export type DownloadResult = { ok: true } | { ok: false; error: ExportFailure };
