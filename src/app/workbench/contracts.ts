import type {
  ExtractionResult,
  ExistingExtractedDocument,
  PreflightAccepted,
  PreflightCapacity,
  PreflightResult,
  WorkspaceDocument,
  WorkspaceProject,
  FolderProjectInput,
  ProjectReadOptions,
  ZipProjectInput,
} from "../../domain";
import type { DownloadResult, ExportSourceInput, PromptPackageResult } from "../../export";
import type { ModelProfile } from "../../domain/profiles";
import type { CodeRewriteOptions, RewriteSettings } from "../../domain/settings";
import type { ExtractionOptions } from "../../domain/media";
import type { ProcessingProgress } from "../../domain/media";

export type MobileTab = "files" | "preview" | "settings";
export type PreviewMode = "source" | "assets" | "package";
export type AssetViewMode = "detail" | "gallery";
export type PackageWorkflow = "one-shot" | "manual";
export type PackagePreviewTab = "runbook" | PackageWorkflow;
export type ActiveOverlay = "help" | "info" | "quick-start" | "settings" | "reset-preferences" | "new-session";
export type BuiltPromptPackage = Extract<PromptPackageResult, { ok: true }>;

export interface WorkbenchDocument extends WorkspaceDocument {
  batchId: string;
  uploadOrdinal: number;
}

export interface WorkbenchProject extends WorkspaceProject {
  uploadOrdinal: number;
}

export type WorkbenchItem = WorkbenchDocument | WorkbenchProject;

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
  /** Canonical v0.6 workspace collection. */
  items: WorkbenchItem[];
  selectedItemId: string | null;
  /** Compatibility aliases for v0.5 document-only consumers. */
  documents: WorkbenchDocument[];
  selectedDocumentId: string | null;
  globalSettings: RewriteSettings;
  globalCodeRewriteOptions: CodeRewriteOptions;
  globalExtractionOptions: ExtractionOptions;
  selectedProfileId: string;
  workingProfile: ModelProfile;
  customProfileLabel: string;
  customContextDraft: string;
  overrideEnabled: Record<string, boolean>;
  mobileTab: MobileTab;
  previewMode: PreviewMode;
  assetViewMode: AssetViewMode;
  selectedAssetIdByDocument: Record<string, string>;
  previewWorkflow: PackagePreviewTab;
  previewDocumentKey: string | null;
  desktopSettingsExpanded: boolean;
  activeOverlay: ActiveOverlay | null;
  tutorialSeenVersion: string | null;
  intake: {
    dragging: boolean;
    activeBatchId: string | null;
    issues: IntakeIssue[];
  };
  editor: Record<string, EditorRevisionState>;
  /** Latest project-review intent. Only that exact ticket may release the export guard. */
  projectMutationState: Record<string, Readonly<{
    originalTreeHash: string;
    projectOperationGeneration: number;
    latestTicket: number;
    status: "pending" | "failed";
  }>>;
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
  buildPackage(inputs: readonly ExportSourceInput[]): Promise<PromptPackageResult>;
  download(blob: Blob): DownloadResult;
  downloadProgressCopy(html: string, filename: string): DownloadResult;
  createDocumentId(): string;
  readFolderProject?(input: FolderProjectInput, options?: ProjectReadOptions): Promise<WorkspaceProject>;
  readZipProject?(input: ZipProjectInput, options?: ProjectReadOptions): Promise<WorkspaceProject>;
}
