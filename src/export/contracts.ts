import type { ContextAssessment } from "../domain/context";
import type { DocumentFormat, ManifestDocumentInput, PromptSet } from "../domain/contracts";
import type { HashAdapter } from "../domain/extraction";
import type { ModelProfile, PromptStage } from "../domain/profiles";
import type { RewriteSettings } from "../domain/settings";

export interface ExportDocumentInput extends ManifestDocumentInput {
  original: File;
  reviewed: boolean;
  contextWarningAcknowledged: boolean;
  uploadOrdinal: number;
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
  contextAssessment: ContextAssessment;
  contextWarningAcknowledged: boolean;
  prompts: Record<keyof PromptSet, ManifestPromptRecord>;
  combined: { markdown: ManifestPromptRecord; html: ManifestPromptRecord };
}

export interface PromptPackageManifest {
  schemaVersion: 2;
  package: { name: "reword-nerd"; version: "0.2.0"; format: "manual-four-stage-prompt-package" };
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
  contextAssessment: ContextAssessment;
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
