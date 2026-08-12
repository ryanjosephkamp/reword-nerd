import type {
  ExtractionResult,
  ExistingExtractedDocument,
  PreflightAccepted,
  PreflightCapacity,
  PreflightResult,
  WorkspaceDocument,
} from "../../domain";
import type { DownloadResult, ExportDocumentInput, PromptPackageResult } from "../../export";
import type { ModelProfile } from "../../domain/profiles";
import type { RewriteSettings } from "../../domain/settings";
import type { ExtractionOptions } from "../../domain/media";
import type { ProcessingProgress } from "../../domain/media";

export type MobileTab = "files" | "preview" | "settings";
export type PreviewMode = "source" | "assets" | "package";
export type BuiltPromptPackage = Extract<PromptPackageResult, { ok: true }>;

export interface WorkbenchDocument extends WorkspaceDocument {
  batchId: string;
  uploadOrdinal: number;
}

export interface EditorRevisionState {
  revision: number;
  hashPending: boolean;
  hashFailed: boolean;
}

export interface IntakeIssue {
  filename: string;
  message: string;
}

export interface WorkbenchState {
  documents: WorkbenchDocument[];
  selectedDocumentId: string | null;
  globalSettings: RewriteSettings;
  globalExtractionOptions: ExtractionOptions;
  selectedProfileId: string;
  workingProfile: ModelProfile;
  customProfileLabel: string;
  customContextDraft: string;
  overrideEnabled: Record<string, boolean>;
  mobileTab: MobileTab;
  previewMode: PreviewMode;
  previewArtifactKey: string | null;
  settingsDrawerOpen: boolean;
  helpDialogOpen: boolean;
  intake: {
    dragging: boolean;
    activeBatchId: string | null;
    issues: IntakeIssue[];
  };
  editor: Record<string, EditorRevisionState>;
  export: {
    status: "idle" | "building" | "ready" | "downloading" | "success" | "failure";
    safeMessage: string;
    builtPackage?: BuiltPromptPackage;
    builtRevision?: number;
    operationId?: number;
    operationRevision?: number;
  };
  liveMessage: string;
  revision: number;
  lastExportedRevision: number;
  focusTarget: string | null;
}

export interface WorkbenchServices {
  preflight(files: readonly File[], capacity: PreflightCapacity): Promise<PreflightResult[]>;
  extract(
    accepted: PreflightAccepted,
    existingDocuments: readonly ExistingExtractedDocument[],
    options?: ExtractionOptions,
    signal?: AbortSignal,
    onProgress?: (progress: ProcessingProgress) => void,
  ): Promise<ExtractionResult>;
  hashText(text: string): Promise<string>;
  buildPackage(inputs: readonly ExportDocumentInput[]): Promise<PromptPackageResult>;
  download(blob: Blob): DownloadResult;
  createDocumentId(): string;
}
