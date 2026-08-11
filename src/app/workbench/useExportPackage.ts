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
  const handledDownloadOperationRef = useRef<number | null>(null);

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

  useEffect(() => {
    const blob = state.export.pendingDownloadBlob;
    const operationId = state.export.operationId;
    const revision = state.export.operationRevision;
    if (!blob || operationId === undefined || revision === undefined) return;
    if (handledDownloadOperationRef.current === operationId) return;
    handledDownloadOperationRef.current = operationId;
    const download = services.download(blob);
    dispatch(download.ok
      ? { type: "export/succeeded", blob, operationId, revision }
      : { type: "export/failed", message: safeFailure, retryBlob: blob, operationId, revision });
  }, [dispatch, services, state.export.operationId, state.export.operationRevision, state.export.pendingDownloadBlob]);

  const build = useCallback(async () => {
    const active = activeOperationRef.current;
    if (active?.revision === state.revision || state.export.status === "busy") return;
    const revision = state.revision;
    const operationId = nextOperationIdRef.current + 1;
    nextOperationIdRef.current = operationId;
    activeOperationRef.current = { operationId, revision };
    const retryBlob = state.export.retryRevision === revision ? state.export.retryBlob : undefined;
    dispatch({ type: "export/started", operationId, revision });
    if (retryBlob) {
      dispatch({ type: "export/package-built", blob: retryBlob, operationId, revision });
      return;
    }
    if (blocker) {
      dispatch({ type: "export/failed", message: blocker, operationId, revision });
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
        dispatch({ type: "export/failed", message: safeFailure, operationId, revision });
        return;
      }
      dispatch({ type: "export/package-built", blob: result.blob, operationId, revision });
    } catch {
      dispatch({ type: "export/failed", message: safeFailure, operationId, revision });
    }
  }, [blocker, dispatch, services, state]);

  return { blocker, build };
}
