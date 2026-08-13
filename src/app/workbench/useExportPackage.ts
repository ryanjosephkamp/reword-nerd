import { useCallback, useEffect, useRef } from "react";
import { renderPromptBundle } from "../../prompting";
import type { ExportDocumentInput } from "../../export";
import type { WorkbenchServices, WorkbenchState } from "./contracts";
import type { WorkbenchAction } from "./reducer";
import {
  selectContextAssessment,
  selectFirstExportBlocker,
  selectResolvedSettings,
  selectWorkingProfile,
} from "./selectors";

const safeBuildFailure = "Package could not be generated. Your session is still available.";
const safeDownloadFailure = "Package could not be downloaded. Your built package is still ready.";

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
          promptBundle: renderPromptBundle(document.extractedText, resolvedSettings, profile, {
            format: document.format,
            assets: (document.visualAssets ?? []).map((asset) => ({
              id: asset.id,
              filename: asset.filename,
              mimeType: asset.mimeType,
              ...(asset.pageNumber ? { pageNumber: asset.pageNumber } : {}),
              ...(asset.sourcePath ? { sourcePath: asset.sourcePath } : {}),
              ...(asset.caption ? { caption: asset.caption } : {}),
              ...(asset.altText ? { altText: asset.altText } : {}),
              included: asset.included,
            })),
            latexMainFile: document.latexProject?.mainFile,
          }),
          warnings: [...document.warnings],
          contextAssessment: selectContextAssessment(state, document.id),
          reviewed: document.status === "ready" && !document.requiresReview,
          contextWarningAcknowledged: document.contextWarningAcknowledged,
          uploadOrdinal: document.uploadOrdinal,
          pageCount: document.pageCount ?? null,
          extractionOptions: document.extractionOptions ?? state.globalExtractionOptions,
          visualAssets: document.visualAssets ?? [],
          ocrCandidates: document.ocrCandidates ?? [],
          ...(document.latexProject ? { latexProject: document.latexProject } : {}),
        };
      });
      const result = await services.buildPackage(snapshot);
      if (!result.ok) {
        dispatch({ type: "export/build-failed", message: safeBuildFailure, operationId, revision });
        return;
      }
      dispatch({ type: "export/package-built", builtPackage: result, operationId, revision });
    } catch {
      dispatch({ type: "export/build-failed", message: safeBuildFailure, operationId, revision });
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
        : { type: "export/download-failed", revision, message: safeDownloadFailure });
    } catch {
      dispatch({ type: "export/download-failed", revision, message: safeDownloadFailure });
    } finally {
      activeDownloadRef.current = false;
    }
  }, [dispatch, services, state.export.builtPackage, state.export.builtRevision, state.revision]);

  return { blocker, build, download };
}
