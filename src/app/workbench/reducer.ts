import {
  CURATED_MODEL_PROFILES,
  DEFAULT_SETTINGS,
  type ExtractionResult,
  type RewriteSettings,
  type WorkspaceDocument,
} from "../../domain";
import type { MobileTab, WorkbenchDocument, WorkbenchState } from "./contracts";

type IntakeDocument = { document: WorkspaceDocument; uploadOrdinal: number };

export type WorkbenchAction =
  | { type: "intake/drag-changed"; dragging: boolean }
  | { type: "intake/issues"; issues: WorkbenchState["intake"]["issues"]; message: string }
  | { type: "intake/accepted"; batchId: string; documents: IntakeDocument[] }
  | { type: "extraction/started"; batchId: string; documentId: string }
  | { type: "extraction/succeeded"; batchId: string; documentId: string; result: ExtractionResult }
  | { type: "extraction/failed"; batchId: string; documentId: string; message: string }
  | { type: "selection/changed"; documentId: string }
  | { type: "document/removed"; documentId: string }
  | { type: "editor/edited"; documentId: string; text: string }
  | { type: "editor/hash-completed"; documentId: string; revision: number; hash: string }
  | { type: "editor/hash-failed"; documentId: string; revision: number }
  | { type: "editor/hash-retry-started"; documentId: string; revision: number }
  | { type: "review/confirmed"; documentId: string; revision: number }
  | { type: "settings/global-changed"; field: keyof RewriteSettings; value: RewriteSettings[keyof RewriteSettings] }
  | { type: "settings/override-enabled"; documentId: string; enabled: boolean }
  | { type: "settings/override-changed"; documentId: string; field: keyof RewriteSettings; value: RewriteSettings[keyof RewriteSettings] }
  | { type: "profile/selected"; profileId: string }
  | { type: "profile/context-limit-changed"; value: number | null }
  | { type: "profile/custom-label-changed"; value: string }
  | { type: "profile/custom-context-draft-changed"; value: string; parsed: number | null }
  | { type: "context/acknowledged"; documentId: string; acknowledged: boolean }
  | { type: "mobile/tab-changed"; tab: MobileTab }
  | { type: "drawer/changed"; open: boolean }
  | { type: "help/changed"; open: boolean }
  | { type: "focus/consumed" }
  | { type: "export/started"; operationId: number; revision: number }
  | { type: "export/package-built"; operationId: number; revision: number; blob: Blob }
  | { type: "export/succeeded"; operationId: number; revision: number; blob: Blob }
  | { type: "export/failed"; operationId: number; revision: number; message: string; retryBlob?: Blob }
  | { type: "live/announced"; message: string };

const firstProfile = CURATED_MODEL_PROFILES[0];

export function createInitialWorkbenchState(): WorkbenchState {
  return {
    documents: [],
    selectedDocumentId: null,
    globalSettings: { ...DEFAULT_SETTINGS },
    selectedProfileId: firstProfile.id,
    workingProfile: { ...firstProfile },
    customProfileLabel: "",
    customContextDraft: "",
    overrideEnabled: {},
    mobileTab: "files",
    settingsDrawerOpen: false,
    helpDialogOpen: false,
    intake: { dragging: false, activeBatchId: null, issues: [] },
    editor: {},
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

export function workbenchReducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
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
          document.batchId === action.batchId ? { ...document, status: "extracting" } : document),
      };
    case "extraction/succeeded": {
      const current = state.documents.find((document) => document.id === action.documentId);
      if (!current || current.batchId !== action.batchId) return state;
      return changed(state, {
        documents: updateDocument(state.documents, action.documentId, (document) => ({
          ...document,
          ...action.result,
          warnings: [...action.result.warnings],
          status: "needs-review",
          requiresReview: true,
          contextWarningAcknowledged: false,
        })),
        liveMessage: `${current.name} is ready for review.`,
      });
    }
    case "extraction/failed": {
      const current = state.documents.find((document) => document.id === action.documentId);
      if (!current || current.batchId !== action.batchId) return state;
      return changed(state, {
        documents: updateDocument(state.documents, action.documentId, (document) => ({
          ...document,
          status: "blocked",
          requiresReview: true,
          safeErrorMessage: action.message,
        })),
        liveMessage: `${current.name} is blocked.`,
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
      delete editor[action.documentId];
      delete overrideEnabled[action.documentId];
      return changed(state, {
        documents,
        selectedDocumentId: state.selectedDocumentId === action.documentId
          ? next?.id ?? null
          : state.selectedDocumentId,
        editor,
        overrideEnabled,
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
      return changed(state, {
        customContextDraft: action.value,
        workingProfile: { ...state.workingProfile, contextWindowTokens: action.parsed },
        documents: clearAcknowledgments(state.documents),
      });
    case "context/acknowledged":
      return changed(state, {
        documents: updateDocument(state.documents, action.documentId, (document) => ({
          ...document,
          contextWarningAcknowledged: action.acknowledged,
        })),
      });
    case "mobile/tab-changed":
      return { ...state, mobileTab: action.tab };
    case "drawer/changed":
      return { ...state, settingsDrawerOpen: action.open };
    case "help/changed":
      return { ...state, helpDialogOpen: action.open };
    case "focus/consumed":
      return { ...state, focusTarget: null };
    case "export/started":
      if (state.export.status === "busy" || action.revision !== state.revision) return state;
      return {
        ...state,
        export: {
          status: "busy",
          safeMessage: "Exporting package…",
          operationId: action.operationId,
          operationRevision: action.revision,
        },
      };
    case "export/package-built":
      if (!isCurrentExportOperation(state, action.operationId, action.revision)) return state;
      return {
        ...state,
        export: {
          ...state.export,
          status: "busy",
          safeMessage: "Exporting package…",
          pendingDownloadBlob: action.blob,
        },
      };
    case "export/succeeded":
      if (!isCurrentExportOperation(state, action.operationId, action.revision)) return state;
      return {
        ...state,
        export: {
          status: "success",
          safeMessage: "Package downloaded.",
          retryBlob: action.blob,
          retryRevision: action.revision,
        },
        lastExportedRevision: action.revision,
        liveMessage: "Package downloaded.",
      };
    case "export/failed":
      if (!isCurrentExportOperation(state, action.operationId, action.revision)) return state;
      return {
        ...state,
        export: {
          status: "failure",
          safeMessage: action.message,
          ...(action.retryBlob ? {
            retryBlob: action.retryBlob,
            retryRevision: action.revision,
          } : {}),
        },
        liveMessage: action.message,
      };
    case "live/announced":
      return { ...state, liveMessage: action.message };
  }
}
