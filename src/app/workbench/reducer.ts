import {
  CURATED_MODEL_PROFILES,
  cloneExtractionOptions,
  DEFAULT_EXTRACTION_OPTIONS,
  DEFAULT_CODE_REWRITE_OPTIONS,
  DEFAULT_MODEL_PROFILE_ID,
  DEFAULT_SETTINGS,
  resolveCodeRewriteOptions,
  type ExtractionResult,
  type RewriteSettings,
  type ExtractionOptions,
  type CodeRewriteOptions,
  type OcrReviewStatus,
  type ProcessingProgress,
  type WorkspaceDocument,
  type WorkspaceProject,
} from "../../domain";
import type { ActiveOverlay, AssetViewMode, BuiltPromptPackage, MobileTab, PackagePreviewTab, PreviewMode, WorkbenchDocument, WorkbenchItem, WorkbenchProject, WorkbenchState } from "./contracts";
import { CURRENT_TUTORIAL_VERSION, type SavedPreferencesPatch } from "./preferences";

type IntakeDocument = { document: WorkspaceDocument; uploadOrdinal: number };

export type WorkbenchAction =
  | { type: "project/admitted"; project: WorkspaceProject; uploadOrdinal: number }
  | { type: "project/review-updated"; itemId: string; expectedOriginalTreeHash: string; expectedReviewRevision: number; expectedOperationGeneration: number; mutationTicket?: number; project: WorkspaceProject }
  | { type: "project/selected-entry"; itemId: string; path: string }
  | { type: "project/mutation-started"; itemId: string; originalTreeHash: string; projectOperationGeneration: number; ticket: number }
  | { type: "project/mutation-failed"; itemId: string; originalTreeHash: string; projectOperationGeneration: number; ticket: number }
  | { type: "item/selection-changed"; itemId: string }
  | { type: "item/removed"; itemId: string }
  | { type: "intake/drag-changed"; dragging: boolean }
  | { type: "intake/issues"; issues: WorkbenchState["intake"]["issues"]; message: string }
  | { type: "intake/accepted"; batchId: string; documents: IntakeDocument[] }
  | { type: "extraction/started"; batchId: string; documentId: string; operationId?: number }
  | { type: "extraction/succeeded"; batchId: string; documentId: string; operationId?: number; result: ExtractionResult }
  | { type: "extraction/failed"; batchId: string; documentId: string; operationId?: number; message: string }
  | { type: "extraction/progress"; documentId: string; operationId: number; progress: ProcessingProgress }
  | { type: "extraction/cancelled"; documentId: string; operationId: number }
  | { type: "selection/changed"; documentId: string }
  | { type: "document/removed"; documentId: string }
  | { type: "editor/edited"; documentId: string; text: string }
  | { type: "editor/hash-completed"; documentId: string; revision: number; hash: string }
  | { type: "editor/hash-failed"; documentId: string; revision: number }
  | { type: "editor/hash-retry-started"; documentId: string; revision: number }
  | { type: "review/confirmed"; documentId: string; revision: number }
  | { type: "settings/global-changed"; field: keyof RewriteSettings; value: RewriteSettings[keyof RewriteSettings] }
  | { type: "code-rewrite/global-options-changed"; options: CodeRewriteOptions }
  | { type: "settings/override-enabled"; documentId: string; enabled: boolean }
  | { type: "settings/override-changed"; documentId: string; field: keyof RewriteSettings; value: RewriteSettings[keyof RewriteSettings] }
  | { type: "processing/global-options-changed"; options: ExtractionOptions }
  | { type: "processing/options-changed"; documentId: string; options: ExtractionOptions }
  | { type: "visual-asset/inclusion-changed"; documentId: string; assetId: string; included: boolean }
  | { type: "latex/main-file-selected"; documentId: string; mainFile: string }
  | {
      type: "ocr/candidate-reviewed";
      documentId: string;
      candidateId: string;
      status: OcrReviewStatus;
      reviewedText: string;
      composedText: string;
      composedHash: string;
    }
  | { type: "profile/selected"; profileId: string }
  | { type: "profile/context-limit-changed"; value: number | null }
  | { type: "profile/custom-label-changed"; value: string }
  | { type: "profile/custom-context-draft-changed"; value: string; parsed: number | null | undefined }
  | { type: "context/acknowledged"; itemId: string; acknowledged: boolean }
  | { type: "mobile/tab-changed"; tab: MobileTab }
  | { type: "preview/mode-changed"; mode: PreviewMode }
  | { type: "assets/view-changed"; mode: AssetViewMode }
  | { type: "assets/selected"; documentId: string; assetId: string }
  | { type: "preview/workflow-changed"; workflow: PackagePreviewTab }
  | { type: "preview/document-selected"; documentKey: string }
  | { type: "desktop/settings-expanded"; expanded: boolean }
  | { type: "overlay/opened"; overlay: ActiveOverlay }
  | { type: "overlay/closed" }
  | { type: "session/reset-requested" }
  | { type: "session/reset-cancelled" }
  | { type: "session/reset-confirmed"; focusAfterReset?: "upload" | "parameters" }
  | { type: "drawer/changed"; open: boolean }
  | { type: "tutorial/opened" }
  | { type: "tutorial/dismissed" }
  | { type: "preferences/reset-requested" }
  | { type: "preferences/reset-cancelled" }
  | { type: "preferences/reset-confirmed" }
  | { type: "focus/consumed" }
  | { type: "export/started"; operationId: number; revision: number }
  | { type: "export/package-built"; operationId: number; revision: number; builtPackage: BuiltPromptPackage }
  | { type: "export/build-failed"; operationId: number; revision: number; message: string }
  | { type: "export/download-started"; revision: number }
  | { type: "export/download-succeeded"; revision: number }
  | { type: "export/download-failed"; revision: number; message: string }
  | { type: "live/announced"; message: string };

const firstProfile = CURATED_MODEL_PROFILES.find((profile) => profile.id === DEFAULT_MODEL_PROFILE_ID)
  ?? CURATED_MODEL_PROFILES[0];

export function createInitialWorkbenchState(preferences: SavedPreferencesPatch | null = null): WorkbenchState {
  const selectedProfile = CURATED_MODEL_PROFILES.find((profile) => profile.id === preferences?.selectedProfileId)
    ?? firstProfile;
  const savedContext = preferences && Object.hasOwn(preferences, "contextWindowTokens")
    ? preferences.contextWindowTokens
    : selectedProfile.contextWindowTokens;
  const customProfileLabel = preferences?.customProfileLabel ?? "";
  const workingProfile = {
    ...selectedProfile,
    label: selectedProfile.id === "custom" && customProfileLabel
      ? customProfileLabel
      : selectedProfile.label,
    contextWindowTokens: savedContext ?? null,
  };
  return {
    items: [],
    selectedItemId: null,
    documents: [],
    selectedDocumentId: null,
    globalSettings: { ...DEFAULT_SETTINGS, ...preferences?.globalSettings },
    globalCodeRewriteOptions: { ...DEFAULT_CODE_REWRITE_OPTIONS, ...preferences?.codeRewriteOptions, protectedExecutableSyntax: true },
    globalExtractionOptions: cloneExtractionOptions({
      ...DEFAULT_EXTRACTION_OPTIONS,
      ...preferences?.processing,
      ocrLanguage: DEFAULT_EXTRACTION_OPTIONS.ocrLanguage,
    }),
    selectedProfileId: selectedProfile.id,
    workingProfile,
    customProfileLabel,
    customContextDraft: savedContext?.toString() ?? "",
    overrideEnabled: {},
    mobileTab: "files",
    previewMode: "source",
    assetViewMode: "detail",
    selectedAssetIdByDocument: {},
    previewWorkflow: "runbook",
    previewDocumentKey: null,
    desktopSettingsExpanded: true,
    activeOverlay: preferences?.tutorialVersion !== CURRENT_TUTORIAL_VERSION ? "quick-start" : null,
    tutorialSeenVersion: preferences?.tutorialVersion ?? null,
    intake: { dragging: false, activeBatchId: null, issues: [] },
    editor: {},
    projectMutationState: {},
    export: { status: "idle", safeMessage: "" },
    liveMessage: "",
    revision: 0,
    lastExportedRevision: 0,
    focusTarget: null,
  };
}

function changed(state: WorkbenchState, patch: Partial<WorkbenchState>): WorkbenchState {
  return {
    ...state,
    ...patch,
    revision: state.revision + 1,
    export: { status: "idle", safeMessage: "" },
    previewMode: "source",
    previewWorkflow: "runbook",
    previewDocumentKey: null,
  };
}

function clearAcknowledgments(documents: readonly WorkbenchDocument[]): WorkbenchDocument[] {
  return documents.map((document) => ({ ...document, contextWarningAcknowledged: false }));
}

function updateDocument(
  documents: readonly WorkbenchDocument[],
  documentId: string,
  update: (document: WorkbenchDocument) => WorkbenchDocument,
): WorkbenchDocument[] {
  return documents.map((document) => document.id === documentId ? update(document) : document);
}

function isCurrentExportOperation(
  state: WorkbenchState,
  operationId: number,
  revision: number,
): boolean {
  return state.revision === revision
    && state.export.operationId === operationId
    && state.export.operationRevision === revision;
}

function reduceWorkbenchState(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case "project/admitted": {
      const admitted: WorkbenchProject = {
        ...action.project,
        entries: [...action.project.entries],
        warnings: [...action.project.warnings],
        uploadOrdinal: action.uploadOrdinal,
      };
      return changed(state, {
        items: [...state.items, admitted],
        selectedItemId: admitted.id,
        selectedDocumentId: null,
        mobileTab: "preview",
        liveMessage: `${admitted.name} is ready for project review.`,
      });
    }
    case "project/review-updated": {
      const current = state.items.find((item): item is WorkbenchProject => item.kind === "project" && item.id === action.itemId);
      if (!current
        || current.originalTreeHash !== action.expectedOriginalTreeHash
        || current.projectReviewRevision !== action.expectedReviewRevision
        || current.projectOperationGeneration !== action.expectedOperationGeneration
        || action.project.id !== current.id
        || action.project.originalTreeHash !== current.originalTreeHash) return state;
      const project: WorkbenchProject = {
        ...action.project,
        entries: [...action.project.entries],
        warnings: [...action.project.warnings],
        selectedEntryPath: current.selectedEntryPath,
        uploadOrdinal: current.uploadOrdinal,
      };
      const projectMutationState = { ...state.projectMutationState };
      const pending = projectMutationState[current.id];
      if (action.mutationTicket !== undefined
        && pending?.originalTreeHash === action.expectedOriginalTreeHash
        && pending.projectOperationGeneration === action.expectedOperationGeneration
        && pending.latestTicket === action.mutationTicket) {
        delete projectMutationState[current.id];
      }
      return changed(state, {
        items: state.items.map((item) => item.id === current.id ? project : item),
        projectMutationState,
        liveMessage: project.requiresReview ? "Project review changed. Confirm the project again." : "Project review complete.",
      });
    }
    case "project/selected-entry": {
      const current = state.items.find((item): item is WorkbenchProject => item.kind === "project" && item.id === action.itemId);
      if (!current?.entries.some((entry) => entry.path === action.path)) return state;
      return {
        ...state,
        items: state.items.map((item) => item.id === current.id ? { ...current, selectedEntryPath: action.path } : item),
      };
    }
    case "project/mutation-started": {
      const project = state.items.find((item): item is WorkbenchProject => item.kind === "project" && item.id === action.itemId);
      if (!project
        || project.originalTreeHash !== action.originalTreeHash
        || project.projectOperationGeneration !== action.projectOperationGeneration) return state;
      const current = state.projectMutationState[action.itemId];
      if (current?.originalTreeHash === action.originalTreeHash
        && current.projectOperationGeneration === action.projectOperationGeneration
        && action.ticket < current.latestTicket) return state;
      if (current?.originalTreeHash === action.originalTreeHash
        && current.projectOperationGeneration === action.projectOperationGeneration
        && current.latestTicket === action.ticket
        && current.status === "pending") return state;
      const projectMutationState = { ...state.projectMutationState };
      projectMutationState[action.itemId] = {
        originalTreeHash: action.originalTreeHash,
        projectOperationGeneration: action.projectOperationGeneration,
        latestTicket: action.ticket,
        status: "pending",
      };
      return changed(state, { projectMutationState, liveMessage: "Project review change is being applied." });
    }
    case "project/mutation-failed": {
      const project = state.items.find((item): item is WorkbenchProject => item.kind === "project" && item.id === action.itemId);
      const current = state.projectMutationState[action.itemId];
      if (!project
        || project.originalTreeHash !== action.originalTreeHash
        || project.projectOperationGeneration !== action.projectOperationGeneration
        || current?.originalTreeHash !== action.originalTreeHash
        || current.projectOperationGeneration !== action.projectOperationGeneration
        || current.latestTicket !== action.ticket) return state;
      return {
        ...state,
        projectMutationState: {
          ...state.projectMutationState,
          [action.itemId]: { ...current, status: "failed" },
        },
        liveMessage: "The project review change failed. Retry it before export.",
      };
    }
    case "item/selection-changed": {
      const item = state.items.find((candidate) => candidate.id === action.itemId);
      if (!item) return state;
      return { ...state, selectedItemId: item.id, selectedDocumentId: item.kind === "document" ? item.id : null, mobileTab: "preview" };
    }
    case "item/removed": {
      const index = state.items.findIndex((item) => item.id === action.itemId);
      if (index < 0) return state;
      const item = state.items[index];
      if (item.kind === "document") return reduceWorkbenchState(state, { type: "document/removed", documentId: item.id });
      const items = state.items.filter((candidate) => candidate.id !== item.id);
      const next = items[index] ?? items[index - 1] ?? null;
      return changed(state, {
        items,
        selectedItemId: state.selectedItemId === item.id ? next?.id ?? null : state.selectedItemId,
        selectedDocumentId: next?.kind === "document" ? next.id : null,
        focusTarget: next ? `document:${next.id}` : "upload",
        liveMessage: `${item.name} removed from the session.`,
        projectMutationState: Object.fromEntries(Object.entries(state.projectMutationState).filter(([id]) => id !== item.id)),
      });
    }
    case "intake/drag-changed":
      return { ...state, intake: { ...state.intake, dragging: action.dragging } };
    case "intake/issues":
      return {
        ...state,
        intake: { ...state.intake, issues: action.issues },
        liveMessage: action.message,
      };
    case "intake/accepted": {
      const admitted = action.documents.map(({ document, uploadOrdinal }) => ({
        ...document,
        batchId: action.batchId,
        uploadOrdinal,
        settingsOverride: { ...document.settingsOverride },
        warnings: [...document.warnings],
        pageCount: document.pageCount ?? null,
        visualAssets: [...(document.visualAssets ?? [])],
        ocrCandidates: [...(document.ocrCandidates ?? [])],
        baseExtractedText: document.baseExtractedText ?? document.extractedText,
        extractionOptions: cloneExtractionOptions(document.extractionOptions ?? state.globalExtractionOptions),
        processingOperationId: document.processingOperationId,
      }));
      const editor = { ...state.editor };
      const overrideEnabled = { ...state.overrideEnabled };
      for (const document of admitted) {
        editor[document.id] = { revision: 0, hashPending: false, hashFailed: false };
        overrideEnabled[document.id] = false;
      }
      return changed(state, {
        documents: [...state.documents, ...admitted],
        selectedDocumentId: admitted[0]?.id ?? state.selectedDocumentId,
        mobileTab: admitted.length > 0 ? "preview" : state.mobileTab,
        intake: { ...state.intake, activeBatchId: action.batchId },
        editor,
        overrideEnabled,
        liveMessage: admitted.length > 0 ? "Extraction is in progress." : state.liveMessage,
      });
    }
    case "extraction/started":
      return {
        ...state,
        documents: updateDocument(state.documents, action.documentId, (document) =>
          document.batchId === action.batchId ? {
            ...document,
            status: "extracting",
            processingOperationId: action.operationId ?? document.processingOperationId,
          } : document),
      };
    case "extraction/succeeded": {
      const current = state.documents.find((document) => document.id === action.documentId);
      if (!current
        || current.batchId !== action.batchId
        || (action.operationId !== undefined && current.processingOperationId !== action.operationId)) return state;
      const selectedAssetIdByDocument = { ...state.selectedAssetIdByDocument };
      if (!action.result.visualAssets?.some((asset) => asset.id === selectedAssetIdByDocument[action.documentId])) {
        delete selectedAssetIdByDocument[action.documentId];
      }
      return changed(state, {
        documents: updateDocument(state.documents, action.documentId, (document) => ({
          ...document,
          ...action.result,
          baseExtractedText: action.result.extractedText,
          warnings: [...action.result.warnings],
          status: "needs-review",
          requiresReview: true,
          contextWarningAcknowledged: false,
          processingProgress: undefined,
        })),
        selectedAssetIdByDocument,
        liveMessage: `${current.name} is ready for review.`,
      });
    }
    case "extraction/failed": {
      const current = state.documents.find((document) => document.id === action.documentId);
      if (!current
        || current.batchId !== action.batchId
        || (action.operationId !== undefined && current.processingOperationId !== action.operationId)) return state;
      return changed(state, {
        documents: updateDocument(state.documents, action.documentId, (document) => ({
          ...document,
          status: "blocked",
          requiresReview: true,
          safeErrorMessage: action.message,
          processingProgress: undefined,
        })),
        liveMessage: `${current.name} is blocked.`,
      });
    }
    case "extraction/progress": {
      const current = state.documents.find((document) => document.id === action.documentId);
      if (!current || current.processingOperationId !== action.operationId) return state;
      return {
        ...state,
        documents: updateDocument(state.documents, action.documentId, (document) => ({
          ...document,
          processingProgress: { ...action.progress },
        })),
      };
    }
    case "extraction/cancelled": {
      const current = state.documents.find((document) => document.id === action.documentId);
      if (!current || current.processingOperationId !== action.operationId) return state;
      return changed(state, {
        documents: updateDocument(state.documents, action.documentId, (document) => ({
          ...document,
          status: "queued",
          processingProgress: undefined,
        })),
        liveMessage: "Document processing was cancelled.",
      });
    }
    case "selection/changed":
      if (!state.documents.some((document) => document.id === action.documentId)) return state;
      return { ...state, selectedDocumentId: action.documentId, mobileTab: "preview" };
    case "document/removed": {
      const index = state.documents.findIndex((document) => document.id === action.documentId);
      if (index < 0) return state;
      const documents = state.documents.filter((document) => document.id !== action.documentId);
      const next = documents[index] ?? documents[index - 1] ?? null;
      const editor = { ...state.editor };
      const overrideEnabled = { ...state.overrideEnabled };
      const selectedAssetIdByDocument = { ...state.selectedAssetIdByDocument };
      delete editor[action.documentId];
      delete overrideEnabled[action.documentId];
      delete selectedAssetIdByDocument[action.documentId];
      return changed(state, {
        documents,
        selectedDocumentId: state.selectedDocumentId === action.documentId
          ? next?.id ?? null
          : state.selectedDocumentId,
        editor,
        overrideEnabled,
        selectedAssetIdByDocument,
        focusTarget: next ? `document:${next.id}` : "upload",
        liveMessage: "Remove file",
      });
    }
    case "editor/edited": {
      const editorState = state.editor[action.documentId];
      const document = state.documents.find((item) => item.id === action.documentId);
      if (!editorState || !document || (document.status !== "needs-review" && document.status !== "ready")) return state;
      return changed(state, {
        documents: updateDocument(state.documents, action.documentId, (document) => ({
          ...document,
          extractedText: action.text,
          status: "needs-review",
          requiresReview: true,
          contextWarningAcknowledged: false,
        })),
        editor: {
          ...state.editor,
          [action.documentId]: { revision: editorState.revision + 1, hashPending: true, hashFailed: false },
        },
      });
    }
    case "editor/hash-completed": {
      const editorState = state.editor[action.documentId];
      if (!editorState || editorState.revision !== action.revision) return state;
      return {
        ...state,
        documents: updateDocument(state.documents, action.documentId, (document) => ({
          ...document,
          extractedTextHash: action.hash,
        })),
        editor: {
          ...state.editor,
          [action.documentId]: { ...editorState, hashPending: false, hashFailed: false },
        },
      };
    }
    case "editor/hash-failed": {
      const editorState = state.editor[action.documentId];
      if (!editorState || editorState.revision !== action.revision) return state;
      return {
        ...state,
        editor: {
          ...state.editor,
          [action.documentId]: { ...editorState, hashPending: false, hashFailed: true },
        },
        liveMessage: "Review extracted content before export",
      };
    }
    case "editor/hash-retry-started": {
      const editorState = state.editor[action.documentId];
      if (!editorState || editorState.revision !== action.revision) return state;
      return {
        ...state,
        editor: {
          ...state.editor,
          [action.documentId]: { ...editorState, hashPending: true, hashFailed: false },
        },
      };
    }
    case "review/confirmed": {
      const editorState = state.editor[action.documentId];
      const document = state.documents.find((item) => item.id === action.documentId);
      if (!editorState
        || !document
        || document.status !== "needs-review"
        || !document.requiresReview
        || (document.format === "latex-project" && !document.latexProject?.mainFile)
        || document.ocrCandidates?.some((candidate) => candidate.status === "pending")
        || document.extractedText.trim().length === 0
        || editorState.revision !== action.revision
        || editorState.hashPending
        || editorState.hashFailed) return state;
      return changed(state, {
        documents: updateDocument(state.documents, action.documentId, (document) => ({
          ...document,
          status: "ready",
          requiresReview: false,
        })),
        liveMessage: "Review complete",
      });
    }
    case "settings/global-changed":
      return changed(state, {
        globalSettings: { ...state.globalSettings, [action.field]: action.value },
      });
    case "code-rewrite/global-options-changed": {
      try {
        return changed(state, {
          globalCodeRewriteOptions: resolveCodeRewriteOptions(action.options),
        });
      } catch {
        return state;
      }
    }
    case "settings/override-enabled": {
      const document = state.documents.find((item) => item.id === action.documentId);
      if (!document) return state;
      const firstEnable = action.enabled && Object.keys(document.settingsOverride).length === 0;
      return changed(state, {
        documents: firstEnable
          ? updateDocument(state.documents, action.documentId, (item) => ({
              ...item,
              settingsOverride: { ...state.globalSettings },
            }))
          : state.documents,
        overrideEnabled: { ...state.overrideEnabled, [action.documentId]: action.enabled },
      });
    }
    case "settings/override-changed":
      if (!state.documents.some((document) => document.id === action.documentId)) return state;
      return changed(state, {
        documents: updateDocument(state.documents, action.documentId, (document) => ({
          ...document,
          settingsOverride: { ...document.settingsOverride, [action.field]: action.value },
        })),
      });
    case "processing/global-options-changed":
      return changed(state, {
        globalExtractionOptions: cloneExtractionOptions(action.options),
      });
    case "processing/options-changed":
      if (!state.documents.some((document) => document.id === action.documentId)) return state;
      return changed(state, {
        documents: updateDocument(state.documents, action.documentId, (document) => ({
          ...document,
          status: "queued",
          requiresReview: true,
          contextWarningAcknowledged: false,
          visualAssets: [],
          ocrCandidates: [],
          latexProject: undefined,
          processingProgress: undefined,
          extractionOptions: cloneExtractionOptions(action.options),
        })),
        selectedAssetIdByDocument: Object.fromEntries(
          Object.entries(state.selectedAssetIdByDocument).filter(([documentId]) => documentId !== action.documentId),
        ),
        liveMessage: "Document processing settings changed. Reprocess the document before review.",
      });
    case "visual-asset/inclusion-changed": {
      const current = state.documents.find((document) => document.id === action.documentId);
      if (!current?.visualAssets?.some((asset) => asset.id === action.assetId)) return state;
      return {
        ...changed(state, {
          documents: updateDocument(state.documents, action.documentId, (document) => ({
            ...document,
            visualAssets: (document.visualAssets ?? []).map((asset) => asset.id === action.assetId
              ? { ...asset, included: action.included }
              : asset),
            status: "needs-review",
            requiresReview: true,
            contextWarningAcknowledged: false,
          })),
          liveMessage: action.included ? "Visual asset included. Confirm review again." : "Visual asset omitted. Confirm review again.",
        }),
        previewMode: "assets",
      };
    }
    case "latex/main-file-selected": {
      const current = state.documents.find((document) => document.id === action.documentId);
      if (!current?.latexProject?.mainFileCandidates.includes(action.mainFile)) return state;
      return changed(state, {
        documents: updateDocument(state.documents, action.documentId, (document) => ({
          ...document,
          latexProject: document.latexProject ? { ...document.latexProject, mainFile: action.mainFile } : undefined,
          status: "needs-review",
          requiresReview: true,
          contextWarningAcknowledged: false,
        })),
        liveMessage: `LaTeX main file selected: ${action.mainFile}. Confirm review again.`,
      });
    }
    case "ocr/candidate-reviewed": {
      const current = state.documents.find((document) => document.id === action.documentId);
      const candidate = current?.ocrCandidates?.find((item) => item.id === action.candidateId);
      if (!current
        || !candidate
        || (action.status === "accepted" && !action.reviewedText.trim())
        || !action.composedText.trim()
        || !action.composedHash) return state;
      const editorState = state.editor[action.documentId];
      return changed(state, {
        documents: updateDocument(state.documents, action.documentId, (document) => ({
          ...document,
          extractedText: action.composedText,
          extractedTextHash: action.composedHash,
          ocrCandidates: (document.ocrCandidates ?? []).map((item) => item.id === action.candidateId
            ? { ...item, status: action.status, reviewedText: action.reviewedText }
            : item),
          status: "needs-review",
          requiresReview: true,
          contextWarningAcknowledged: false,
        })),
        editor: editorState ? {
          ...state.editor,
          [action.documentId]: {
            revision: editorState.revision + 1,
            hashPending: false,
            hashFailed: false,
          },
        } : state.editor,
        liveMessage: action.status === "accepted" ? "OCR candidate accepted for review." : "OCR candidate omitted.",
      });
    }
    case "profile/selected": {
      const profile = CURATED_MODEL_PROFILES.find((item) => item.id === action.profileId);
      if (!profile) return state;
      return changed(state, {
        selectedProfileId: profile.id,
        workingProfile: { ...profile },
        customContextDraft: profile.contextWindowTokens?.toString() ?? "",
        documents: clearAcknowledgments(state.documents),
      });
    }
    case "profile/context-limit-changed":
      return changed(state, {
        workingProfile: { ...state.workingProfile, contextWindowTokens: action.value },
        documents: clearAcknowledgments(state.documents),
      });
    case "profile/custom-label-changed":
      return changed(state, {
        customProfileLabel: action.value,
        workingProfile: state.selectedProfileId === "custom"
          ? { ...state.workingProfile, label: action.value }
          : state.workingProfile,
      });
    case "profile/custom-context-draft-changed":
      if (action.parsed === undefined) {
        return { ...state, customContextDraft: action.value };
      }
      return changed(state, {
        customContextDraft: action.value,
        workingProfile: { ...state.workingProfile, contextWindowTokens: action.parsed },
        documents: clearAcknowledgments(state.documents),
      });
    case "context/acknowledged":
      return changed(state, {
        items: state.items.map((item) => item.id === action.itemId
          ? { ...item, contextWarningAcknowledged: action.acknowledged }
          : item),
        documents: updateDocument(state.documents, action.itemId, (document) => ({
          ...document,
          contextWarningAcknowledged: action.acknowledged,
        })),
      });
    case "mobile/tab-changed":
      return { ...state, mobileTab: action.tab };
    case "preview/mode-changed":
      if (action.mode === "package" && !state.export.builtPackage) return state;
      return { ...state, previewMode: action.mode };
    case "assets/view-changed":
      return { ...state, assetViewMode: action.mode };
    case "assets/selected": {
      const document = state.documents.find((item) => item.id === action.documentId);
      if (!document?.visualAssets?.some((asset) => asset.id === action.assetId)) return state;
      return {
        ...state,
        selectedAssetIdByDocument: {
          ...state.selectedAssetIdByDocument,
          [action.documentId]: action.assetId,
        },
        liveMessage: `Selected visual asset ${action.assetId}.`,
      };
    }
    case "preview/workflow-changed":
      if (!state.export.builtPackage || state.previewMode !== "package") return state;
      return { ...state, previewWorkflow: action.workflow };
    case "preview/document-selected":
      if (!state.export.builtPackage?.workbooks.some((workbook) => workbook.documentKey === action.documentKey)) return state;
      return { ...state, previewDocumentKey: action.documentKey };
    case "desktop/settings-expanded":
      return { ...state, desktopSettingsExpanded: action.expanded };
    case "overlay/opened":
      return { ...state, activeOverlay: action.overlay };
    case "overlay/closed":
      return { ...state, activeOverlay: null };
    case "session/reset-requested":
      return { ...state, activeOverlay: "new-session" };
    case "session/reset-cancelled":
      return { ...state, activeOverlay: null };
    case "session/reset-confirmed": {
      const revision = state.revision + 1;
      return {
        ...state,
        documents: [],
        items: [],
        selectedDocumentId: null,
        selectedItemId: null,
        overrideEnabled: {},
        mobileTab: "files",
        previewMode: "source",
        assetViewMode: "detail",
        selectedAssetIdByDocument: {},
        previewWorkflow: "runbook",
        previewDocumentKey: null,
        desktopSettingsExpanded: true,
        activeOverlay: null,
        intake: { dragging: false, activeBatchId: null, issues: [] },
        editor: {},
        projectMutationState: {},
        export: { status: "idle", safeMessage: "" },
        liveMessage: "New session ready. Settings kept.",
        revision,
        lastExportedRevision: revision,
        focusTarget: action.focusAfterReset ?? "upload",
      };
    }
    case "drawer/changed":
      return { ...state, activeOverlay: action.open ? "settings" : null };
    case "tutorial/opened":
      return { ...state, activeOverlay: "quick-start" };
    case "tutorial/dismissed":
      return {
        ...state,
        desktopSettingsExpanded: true,
        activeOverlay: null,
        tutorialSeenVersion: CURRENT_TUTORIAL_VERSION,
      };
    case "preferences/reset-requested":
      return { ...state, activeOverlay: "reset-preferences" };
    case "preferences/reset-cancelled":
      return { ...state, activeOverlay: null };
    case "preferences/reset-confirmed":
      return changed(state, {
        globalSettings: { ...DEFAULT_SETTINGS },
        globalCodeRewriteOptions: { ...DEFAULT_CODE_REWRITE_OPTIONS },
        globalExtractionOptions: cloneExtractionOptions(DEFAULT_EXTRACTION_OPTIONS),
        selectedProfileId: firstProfile.id,
        workingProfile: { ...firstProfile },
        customProfileLabel: "",
        customContextDraft: firstProfile.contextWindowTokens?.toString() ?? "",
        activeOverlay: null,
        documents: clearAcknowledgments(state.documents),
      });
    case "focus/consumed":
      return { ...state, focusTarget: null };
    case "export/started":
      if (state.export.status === "building" || action.revision !== state.revision) return state;
      return {
        ...state,
        export: {
          status: "building",
          safeMessage: "Building package…",
          operationId: action.operationId,
          operationRevision: action.revision,
        },
      };
    case "export/package-built":
      if (!isCurrentExportOperation(state, action.operationId, action.revision)) return state;
      return {
        ...state,
        export: {
          status: "ready",
          safeMessage: "Package ready.",
          builtPackage: action.builtPackage,
          builtRevision: action.revision,
        },
        mobileTab: "preview",
        previewMode: "package",
        previewWorkflow: "runbook",
        previewDocumentKey: action.builtPackage.workbooks[0]?.documentKey ?? null,
        focusTarget: "package-preview",
        liveMessage: "Package ready.",
      };
    case "export/build-failed":
      if (!isCurrentExportOperation(state, action.operationId, action.revision)) return state;
      return {
        ...state,
        export: {
          status: "failure",
          safeMessage: action.message,
        },
        liveMessage: action.message,
      };
    case "export/download-started":
      if (state.revision !== action.revision
        || state.export.builtRevision !== action.revision
        || !state.export.builtPackage
        || state.export.status === "downloading") return state;
      return {
        ...state,
        export: {
          ...state.export,
          status: "downloading",
          safeMessage: "Downloading package…",
        },
      };
    case "export/download-succeeded":
      if (state.revision !== action.revision
        || state.export.builtRevision !== action.revision
        || !state.export.builtPackage) return state;
      return {
        ...state,
        export: { ...state.export, status: "success", safeMessage: "Package downloaded." },
        lastExportedRevision: action.revision,
        liveMessage: "Package downloaded.",
      };
    case "export/download-failed":
      if (state.revision !== action.revision
        || state.export.builtRevision !== action.revision
        || !state.export.builtPackage) return state;
      return {
        ...state,
        export: { ...state.export, status: "failure", safeMessage: action.message },
        liveMessage: action.message,
      };
    case "live/announced":
      return { ...state, liveMessage: action.message };
  }
}

function mergeDocumentAliases(
  priorItems: readonly WorkbenchItem[],
  documents: readonly WorkbenchDocument[],
): WorkbenchItem[] {
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const merged: WorkbenchItem[] = [];
  for (const item of priorItems) {
    if (item.kind === "project") {
      merged.push(item);
      continue;
    }
    const document = documentsById.get(item.id);
    if (!document) continue;
    documentsById.delete(item.id);
    merged.push(document);
  }
  return [...merged, ...documentsById.values()];
}

export function workbenchReducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  const next = reduceWorkbenchState(state, action);
  if (!next) return state;
  const documentsChanged = next.documents !== state.documents;
  const selectionChanged = next.selectedDocumentId !== state.selectedDocumentId;
  if (!documentsChanged && !selectionChanged) return next;
  return {
    ...next,
    items: documentsChanged ? mergeDocumentAliases(next.items, next.documents) : next.items,
    selectedItemId: selectionChanged && next.selectedItemId === state.selectedItemId
      ? next.selectedDocumentId
      : next.selectedItemId,
  };
}
