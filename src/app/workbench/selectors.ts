import {
  assessContext,
  assessSourceContext,
  createCustomProfile,
  resolveSettings,
  type ContextAssessment,
  type ModelProfile,
  type RewriteSettings,
} from "../../domain";
import type { WorkbenchDocument, WorkbenchProject, WorkbenchState } from "./contracts";

export function selectSelectedItem(state: WorkbenchState) {
  return state.items.find((item) => item.id === state.selectedItemId);
}

export function selectSelectedDocument(state: WorkbenchState): WorkbenchDocument | undefined {
  return state.documents.find((document) => document.id === state.selectedDocumentId);
}

export function selectSelectedVisualAsset(state: WorkbenchState, documentId: string) {
  const document = state.documents.find((item) => item.id === documentId);
  if (!document) return undefined;
  const selectedId = state.selectedAssetIdByDocument[documentId];
  return document.visualAssets?.find((asset) => asset.id === selectedId) ?? document.visualAssets?.[0];
}

export function selectResolvedSettings(state: WorkbenchState, documentId: string): RewriteSettings {
  const document = state.items.find((item) => item.id === documentId);
  return resolveSettings(
    state.globalSettings,
    document && state.overrideEnabled[documentId] ? document.settingsOverride : {},
  );
}

export function selectEditableSettings(state: WorkbenchState, documentId: string): RewriteSettings {
  const document = state.items.find((item) => item.id === documentId);
  if (!document || !state.overrideEnabled[documentId]) return state.globalSettings;
  return { ...state.globalSettings, ...document.settingsOverride };
}

export function selectWorkingProfile(state: WorkbenchState): ModelProfile {
  if (state.customContextDraft.trim() && (!/^\d+$/.test(state.customContextDraft) || Number(state.customContextDraft) <= 0)) {
    throw new Error("Context limit must be a positive whole number or unknown.");
  }
  if (state.selectedProfileId === "custom") {
    return createCustomProfile(state.customProfileLabel, state.workingProfile.contextWindowTokens);
  }
  if (!Number.isInteger(state.workingProfile.contextWindowTokens ?? 1)
    || (state.workingProfile.contextWindowTokens ?? 1) <= 0) {
    throw new Error("Context limit must be a positive whole number or unknown.");
  }
  return { ...state.workingProfile };
}

export function selectContextAssessment(
  state: WorkbenchState,
  documentId: string,
): ContextAssessment {
  const document = state.documents.find((item) => item.id === documentId);
  if (document) return assessContext(document.extractedText, selectWorkingProfile(state).contextWindowTokens);
  const project = state.items.find((item): item is WorkbenchProject => item.kind === "project" && item.id === documentId);
  if (!project) return assessContext("", null);
  return assessSourceContext({
    kind: "project",
    includedFiles: project.entries.flatMap((entry) => entry.promptIncluded
      && entry.contentKind === "text"
      && entry.reviewedText !== null
      && entry.previewKind !== null
      ? [{ path: entry.path, text: entry.reviewedText, previewKind: entry.previewKind }]
      : []),
  }, selectWorkingProfile(state).contextWindowTokens);
}

export function selectCounts(state: WorkbenchState) {
  return state.items.reduce(
    (counts, document) => {
      if (document.status === "ready") counts.ready += 1;
      else if (document.status === "blocked" || document.status === "error") counts.blocked += 1;
      else counts.review += 1;
      return counts;
    },
    { total: state.items.length, ready: 0, review: 0, blocked: 0 },
  );
}

export function selectFirstExportBlocker(state: WorkbenchState): string | null {
  if (state.items.length === 0) return "Add at least one reviewed document before exporting.";
  if (state.documents.some((document) => document.status === "queued" || document.status === "extracting")) {
    return "Extraction is in progress.";
  }
  if (state.documents.some((document) => document.status === "blocked" || document.status === "error")) {
    return "Remove blocked files before exporting.";
  }
  if (state.documents.some((document) => document.extractedText.trim().length === 0)) {
    return "Extracted text cannot be blank. Add text or remove the file.";
  }
  if (state.documents.some((document) => document.ocrCandidates?.some((candidate) => candidate.status === "pending"))) {
    return "Review every OCR candidate before export.";
  }
  if (state.documents.some((document) => document.format === "latex-project" && !document.latexProject?.mainFile)) {
    return "Select the main LaTeX file before export.";
  }
  if (state.documents.some((document) => document.status === "needs-review" || document.requiresReview)) {
    return "Review extracted content before export";
  }
  if (Object.values(state.editor).some((editor) => editor.hashPending)) return "Review extracted content before export";
  const projectMutations = Object.values(state.projectMutationState);
  if (projectMutations.some((mutation) => mutation.status === "failed")) {
    return "Retry the failed project review change before export.";
  }
  if (projectMutations.length > 0) return "A project review change is still being applied.";
  const projects = state.items.filter((item) => item.kind === "project");
  if (projects.some((project) => project.status === "blocked" || project.status === "error")) {
    return "Remove blocked projects before exporting.";
  }
  if (projects.some((project) => project.requiresReview || project.status === "needs-review")) {
    return "Review and confirm every project before export";
  }
  if (projects.some((project) => !project.entries.some((entry) => entry.promptIncluded && entry.contentKind === "text" && Boolean(entry.reviewedText?.trim())))) {
    return "Include at least one reviewed project text file before export.";
  }
  try {
    selectWorkingProfile(state);
    for (const document of state.items) {
      selectResolvedSettings(state, document.id);
      const context = selectContextAssessment(state, document.id);
      if (context.acknowledgmentRequired && !document.contextWarningAcknowledged) {
        return "Estimated workflow context exceeds the selected profile.";
      }
    }
  } catch (error) {
    return error instanceof Error ? error.message : "One or more settings need attention.";
  }
  if (state.export.status === "building") return "Building package…";
  if (state.export.status === "downloading") return "Downloading package…";
  return null;
}

export function selectDirty(state: WorkbenchState): boolean {
  return state.revision !== state.lastExportedRevision;
}
