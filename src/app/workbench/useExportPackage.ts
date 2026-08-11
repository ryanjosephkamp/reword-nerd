import { useCallback, useEffect, useRef } from "react";
import { renderPromptSet } from "../../prompting";
import type { ExportDocumentInput } from "../../export";
import type { WorkbenchServices, WorkbenchState } from "./contracts";
import type { WorkbenchAction } from "./reducer";
import {
  selectContextAssessment,
  selectFirstExportBlocker,
  selectResolvedSettings,
  selectWorkingProfile,
} from "./selectors";

const safeFailure = "Package could not be generated. Your session is still available.";

export function useExportPackage(
  state: WorkbenchState,
  dispatch: React.Dispatch<WorkbenchAction>,
  services: WorkbenchServices,
) {
  const blocker = selectFirstExportBlocker(state);
  const nextOperationIdRef = useRef(0);
  const activeOperationRef = useRef<{ operationId: number; revision: number } | null>(null);
  const activeDownloadRef = useRef(false);

  useEffect(() => {
    const active = activeOperationRef.current;
    if (!active) return;
    if (
      state.export.operationId !== active.operationId
      || state.export.operationRevision !== active.revision
    ) {
      activeOperationRef.current = null;
    }
  }, [state.export.operationId, state.export.operationRevision]);

  const build = useCallback(async () => {
    const active = activeOperationRef.current;
    if (active?.revision === state.revision
      || state.export.status === "building"
      || state.export.status === "downloading") return;
    const revision = state.revision;
    const operationId = nextOperationIdRef.current + 1;
    nextOperationIdRef.current = operationId;
    activeOperationRef.current = { operationId, revision };
    dispatch({ type: "export/started", operationId, revision });
    if (blocker) {
      dispatch({ type: "export/build-failed", message: blocker, operationId, revision });
      return;
    }
    try {
      const profile = selectWorkingProfile(state);
      const snapshot: ExportDocumentInput[] = state.documents.map((document) => {
        const resolvedSettings = selectResolvedSettings(state, document.id);
        return {
          documentId: document.id,
          documentName: document.name,
          documentFormat: document.format,
          original: document.original,
          reviewedExtractedText: document.extractedText,
          resolvedSettings,
          chosenProfile: { ...profile },
          promptSet: renderPromptSet(document.extractedText, resolvedSettings, profile),
          warnings: [...document.warnings],
          contextAssessment: selectContextAssessment(state, document.id),
          reviewed: document.status === "ready" && !document.requiresReview,
          contextWarningAcknowledged: document.contextWarningAcknowledged,
          uploadOrdinal: document.uploadOrdinal,
        };
      });
      const result = await services.buildPackage(snapshot);
      if (!result.ok) {
        dispatch({ type: "export/build-failed", message: safeFailure, operationId, revision });
        return;
      }
      dispatch({ type: "export/package-built", builtPackage: result, operationId, revision });
    } catch {
      dispatch({ type: "export/build-failed", message: safeFailure, operationId, revision });
    }
  }, [blocker, dispatch, services, state]);

  const download = useCallback(() => {
    const builtPackage = state.export.builtPackage;
    const revision = state.export.builtRevision;
    if (!builtPackage
      || revision === undefined
      || revision !== state.revision
      || activeDownloadRef.current) return;
    activeDownloadRef.current = true;
    dispatch({ type: "export/download-started", revision });
    try {
      const result = services.download(builtPackage.blob);
      dispatch(result.ok
        ? { type: "export/download-succeeded", revision }
        : { type: "export/download-failed", revision, message: safeFailure });
    } catch {
      dispatch({ type: "export/download-failed", revision, message: safeFailure });
    } finally {
      activeDownloadRef.current = false;
    }
  }, [dispatch, services, state.export.builtPackage, state.export.builtRevision, state.revision]);

  return { blocker, build, download };
}
