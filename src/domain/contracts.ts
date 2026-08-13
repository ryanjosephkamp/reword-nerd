import type { ContextAssessment } from "./context";
import type { ModelProfile } from "./profiles";
import type { RewriteSettings, SettingsOverride } from "./settings";
import type {
  ExtractionOptions,
  LatexProjectMetadata,
  OcrCandidate,
  ProcessingProgress,
  VisualAsset,
} from "./media";

export type DocumentFormat =
  | "text"
  | "markdown"
  | "html"
  | "xml"
  | "json"
  | "jsonl"
  | "ndjson"
  | "csv"
  | "tsv"
  | "yaml"
  | "toml"
  | "ini"
  | "config"
  | "css"
  | "sql"
  | "code"
  | "docx"
  | "pdf"
  | "latex"
  | "latex-project";
export type DocumentStatus = "queued" | "extracting" | "needs-review" | "ready" | "blocked" | "error";

export interface PromptSet {
  decompose: string;
  rewrite: string;
  verify: string;
  final: string;
}

export interface PromptBundle {
  oneShot: string;
  manual: PromptSet;
}

export interface WorkspaceDocument {
  /** Compatibility surface; WorkspaceItem uses WorkspaceDocumentItem with a required discriminant. */
  kind?: "document";
  id: string;
  original: File;
  originalByteSize: number;
  originalHash: string;
  name: string;
  format: DocumentFormat;
  languageId?: string;
  previewKind?: import("./sourceText").SourcePreviewKind;
  status: DocumentStatus;
  extractedText: string;
  baseExtractedText?: string;
  extractedTextHash: string;
  warnings: string[];
  pageCount?: number | null;
  visualAssets?: VisualAsset[];
  ocrCandidates?: OcrCandidate[];
  extractionOptions?: ExtractionOptions;
  latexProject?: LatexProjectMetadata;
  processingProgress?: ProcessingProgress;
  processingOperationId?: number;
  requiresReview: boolean;
  duplicateOf?: string;
  settingsOverride: SettingsOverride;
  contextWarningAcknowledged: boolean;
  safeErrorMessage?: string;
}

export type WorkspaceDocumentItem = WorkspaceDocument & { kind: "document" };
export type WorkspaceItem = WorkspaceDocumentItem | import("./project").WorkspaceProject;

export interface ManifestDocumentInput {
  documentId: string;
  documentName: string;
  documentFormat: DocumentFormat;
  reviewedExtractedText: string;
  resolvedSettings: RewriteSettings;
  chosenProfile: ModelProfile;
  promptBundle: PromptBundle;
  warnings: string[];
  contextAssessment: ContextAssessment;
}
