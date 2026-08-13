import type { ContextAssessment } from "../domain/context";
import type { DocumentFormat, ManifestDocumentInput, PromptBundle, PromptSet } from "../domain/contracts";
import type { HashAdapter } from "../domain/extraction";
import type { ModelProfile, PromptStage } from "../domain/profiles";
import type { RewriteSettings } from "../domain/settings";
import type { CodeRewriteOptions } from "../domain/settings";
import type { ExtractionOptions, LatexProjectMetadata, OcrCandidate, VisualAsset } from "../domain/media";
import type {
  ProjectClassification,
  ProjectContentKind,
  ProjectExclusionReason,
  ProjectSourceKind,
  WorkspaceProject,
} from "../domain/project";

export interface ExportDocumentInput extends ManifestDocumentInput {
  kind?: "document";
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

export interface ExportProjectInput {
  kind: "project";
  projectId: string;
  projectName: string;
  /** Complete reviewed in-memory project. Export independently snapshots and revalidates it. */
  project: WorkspaceProject;
  reviewedExtractedText: string;
  resolvedSettings: RewriteSettings;
  codeRewriteOptions: CodeRewriteOptions;
  chosenProfile: ModelProfile;
  promptBundle: PromptBundle;
  warnings: string[];
  /** Aggregate only. Sensitive paths, names, hashes, and bytes are never export inputs. */
  sensitiveBlockedCounts: {
    credentialFiles: number;
    privateKeys: number;
    clearCredentials: number;
  };
  contextAssessment: ContextAssessment;
  reviewed: boolean;
  contextWarningAcknowledged: boolean;
  uploadOrdinal: number;
}

export type ExportSourceInput = ExportDocumentInput | ExportProjectInput;

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

export interface ManifestProjectEntryRecord {
  path: string;
  originalByteCount: number;
  originalSha256: string;
  reviewedSha256: string | null;
  reviewRevision: number;
  contentKind: ProjectContentKind;
  languageId: string | null;
  promptIncluded: boolean;
  packageIncluded: boolean;
  exclusionReason: ProjectExclusionReason;
  packaged?: ManifestPromptRecord;
}

export type ManifestSourceRecord =
  | {
    kind: "file";
    original: { path: string; byteCount: number; sha256: string };
  }
  | {
    kind: "project";
    intakeKind: ProjectSourceKind;
    rootName: string;
    classification: ProjectClassification;
    rootDocument: string | null;
    originalTreeHash: string;
    reviewedTreeHash: string;
    reviewRevision: number;
    totalByteCount: number;
    codeRewriteOptions: CodeRewriteOptions;
    originalContainer?: { displayName: string; byteCount: number; sha256: string };
    index: { markdown: ManifestPromptRecord; json: ManifestPromptRecord };
    entries: ManifestProjectEntryRecord[];
    sensitiveBlockedCounts: {
      credentialFiles: number;
      privateKeys: number;
      clearCredentials: number;
    };
  };

export type ManifestGeneratedArtifact =
  | { status: "generated"; path: string; sha256: string }
  | { status: "not-generated"; reason: "encoded-size-limit" };

export interface ManifestDocumentRecord {
  key: string;
  exportOrdinal: number;
  originalDisplayName: string;
  format: DocumentFormat;
  source: ManifestSourceRecord;
  /** Compatibility field retained for file sources; deliberately absent for projects. */
  original?: { path: string; byteCount: number; sha256: string };
  reviewedExtraction: { path: string; unicodeCodePointCount: number; sha256: string; warnings: string[] };
  settings: RewriteSettings;
  model: Pick<ModelProfile, "id" | "family" | "label" | "contextWindowTokens" | "lastReviewed" | "workflowNote"> & {
    promptStrategy: Pick<ModelProfile["promptStrategy"], "id" | "version" | "referenceModel" | "reviewedAt">;
  };
  contextAssessment: Pick<ContextAssessment,
    | "estimateLabel"
    | "sourceTokens"
    | "oneShotWorkflowTokens"
    | "manualWorkflowTokens"
    | "oneShotRatio"
    | "manualRatio"
    | "oneShotOversized"
    | "manualOversized"
    | "oneShotWarning"
    | "workflowTokens"
    | "contextWindowTokens"
    | "ratio"
    | "oversized"
    | "acknowledgmentRequired"
    | "includedFileCount"
    | "amberRisk"
    | "amberRiskReasons"
    | "inspectDiffsAndRunTestsWarning"
  >;
  contextWarningAcknowledged: boolean;
  prompts: Record<"oneShot" | keyof PromptSet, ManifestPromptRecord>;
  processing: { pageCount: number | null; options: ExtractionOptions };
  visualAssets: {
    index: ManifestPromptRecord;
    placementMap: ManifestPromptRecord;
    records: ManifestAssetRecord[];
  };
  ocr: { path: string; sha256: string; records: ManifestOcrRecord[] };
  latexProject?: LatexProjectMetadata;
  workbooks: {
    oneShot: { markdown: ManifestPromptRecord; html: ManifestPromptRecord };
    manual: { markdown: ManifestPromptRecord; html: ManifestPromptRecord };
    combined: {
      markdown: ManifestPromptRecord;
      html: ManifestPromptRecord;
      fullHtml: ManifestGeneratedArtifact;
    };
  };
}

export interface PromptPackageManifest {
  schemaVersion: 6;
  package: { name: "reword-nerd"; version: "0.6.0"; format: "dual-mode-prompt-package" };
  archive: {
    entryOrder: "lexicographic-code-unit-ascending";
    timestamp: "1980-01-01T00:00:00.000Z";
    originalCompression: "STORE";
    generatedCompression: "DEFLATE-9";
  };
  workflow: {
    modes: ["one-shot", "manual"];
    manualStages: ["decompose", "rewrite", "verify", "final"];
    responseMarkers: { stage1: string; stage2: string; stage3: string };
  };
  rootArtifacts: { readme: ManifestPromptRecord; openMe: ManifestPromptRecord };
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

export type RunbookInline =
  | Readonly<{ type: "text"; value: string }>
  | Readonly<{ type: "code"; value: string }>
  | Readonly<{ type: "link"; label: string; href: string }>;

export type RunbookBlock =
  | Readonly<{ type: "heading"; depth: 1 | 2; content: readonly RunbookInline[] }>
  | Readonly<{ type: "paragraph"; content: readonly RunbookInline[] }>
  | Readonly<{ type: "table"; headers: readonly string[]; rows: readonly (readonly RunbookInline[])[] }>
  | Readonly<{ type: "list"; ordered: boolean; items: readonly (readonly RunbookInline[])[] }>
  | Readonly<{ type: "code-block"; language?: string; value: string }>;

export interface RunbookDocument {
  type: "runbook-document";
  blocks: readonly RunbookBlock[];
}

export interface DocumentWorkbookPaths {
  readme: string;
  oneShotMarkdown: string;
  oneShotHtml: string;
  manualMarkdown: string;
  manualHtml: string;
  combinedMarkdown: string;
  combinedHtml: string;
  combinedFullHtml?: string;
}

export type WorkbookResponseStage = "oneShot" | PromptStage;

export interface WorkbookPromptState {
  text: string;
  canonicalText: string;
  copyEnabled: boolean;
  edited: boolean;
  stale: boolean;
}

export interface WorkbookProgress {
  schemaVersion: 1;
  documentKey: string;
  responses: Readonly<Record<WorkbookResponseStage, string>>;
  oneShotPrompt: Readonly<WorkbookPromptState>;
  manual: {
    prompts: Readonly<Record<PromptStage, Readonly<WorkbookPromptState>>>;
  };
}

export interface WorkbookVisualAsset extends VisualAsset {
  packagedPath: string;
}

export interface DocumentWorkbook {
  documentKey: string;
  originalDisplayName: string;
  runbook: Readonly<CombinedPromptRunbook>;
  /** Semantic source for v0.5+ workbooks. */
  runbookDocument?: Readonly<RunbookDocument>;
  runbookMarkdown: string;
  /** Immutable canonical archive paths for v0.5+ workbooks. */
  paths?: Readonly<DocumentWorkbookPaths>;
  promptBundle: Readonly<PromptBundle>;
  promptBlocks: readonly Readonly<CombinedPromptBlock>[];
  oneShot: Readonly<{ prompt: string; markdown: string; html: string }>;
  manual: Readonly<{ promptBlocks: readonly Readonly<CombinedPromptBlock>[]; markdown: string; html: string }>;
  combined: Readonly<{
    markdown: string;
    html: string;
    fullHtml?: string;
    fullHtmlStatus: ManifestGeneratedArtifact["status"];
  }>;
  /** @deprecated Compatibility alias for combined.markdown. */
  markdown: string;
  /** @deprecated Compatibility alias for combined.html. */
  html: string;
  /** @deprecated Compatibility alias for combined.fullHtml. */
  fullHtml?: string;
  /** @deprecated Compatibility alias for combined.fullHtmlStatus. */
  fullHtmlStatus: ManifestGeneratedArtifact["status"];
  visualAssets: readonly Readonly<WorkbookVisualAsset>[];
}

/** @deprecated Use DocumentWorkbook. */
export type CombinedPromptArtifact = DocumentWorkbook;

export type PromptPackageResult =
  | {
    ok: true;
    blob: Blob;
    filename: "reword-nerd-prompt-package.zip";
    manifest: PromptPackageManifest;
    workbooks: readonly DocumentWorkbook[];
    /** @deprecated Compatibility alias for workbooks. */
    artifacts: readonly DocumentWorkbook[];
  }
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
