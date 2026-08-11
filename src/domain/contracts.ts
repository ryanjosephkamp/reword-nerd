import type { ContextAssessment } from "./context";
import type { ModelProfile } from "./profiles";
import type { RewriteSettings, SettingsOverride } from "./settings";

export type DocumentFormat = "text" | "markdown" | "docx" | "pdf";
export type DocumentStatus = "queued" | "extracting" | "needs-review" | "ready" | "blocked" | "error";

export interface PromptSet {
  decompose: string;
  rewrite: string;
  verify: string;
  final: string;
}

export interface WorkspaceDocument {
  id: string;
  original: File;
  originalByteSize: number;
  originalHash: string;
  name: string;
  format: DocumentFormat;
  status: DocumentStatus;
  extractedText: string;
  extractedTextHash: string;
  warnings: string[];
  requiresReview: boolean;
  duplicateOf?: string;
  settingsOverride: SettingsOverride;
  contextWarningAcknowledged: boolean;
  safeErrorMessage?: string;
}

export interface ManifestDocumentInput {
  documentId: string;
  documentName: string;
  documentFormat: DocumentFormat;
  reviewedExtractedText: string;
  resolvedSettings: RewriteSettings;
  chosenProfile: ModelProfile;
  promptSet: PromptSet;
  warnings: string[];
  contextAssessment: ContextAssessment;
}
