import { useCallback, useLayoutEffect, useRef, type ChangeEvent, type DragEvent } from "react";
import type { WorkspaceDocument } from "../../domain";
import { cloneExtractionOptions } from "../../domain";
import type { WorkbenchServices, WorkbenchState } from "./contracts";
import type { WorkbenchAction } from "./reducer";
import { safeExtractionMessage } from "./services";
import type { IntakeCapacity, IntakeCapacityCoordinator, IntakeReservationScope } from "./intakeCapacityCoordinator";

interface FileIntake {
  inputRef: React.RefObject<HTMLInputElement | null>;
  addButtonRef: React.RefObject<HTMLButtonElement | null>;
  openFilePicker(): void;
  onInputChange(event: ChangeEvent<HTMLInputElement>): void;
  onDragEnter(event: DragEvent<HTMLElement>): void;
  onDragLeave(event: DragEvent<HTMLElement>): void;
  onDragOver(event: DragEvent<HTMLElement>): void;
  onDrop(event: DragEvent<HTMLElement>): void;
  retry(documentId: string, optionsOverride?: import("../../domain").ExtractionOptions): void;
  cancel(documentId: string): void;
  resetSession(): void;
}

export function useFileIntake(
  state: WorkbenchState,
  dispatch: React.Dispatch<WorkbenchAction>,
  services: WorkbenchServices,
  intakeZipProjects: ((files: readonly File[], capacity: IntakeCapacity, reservations: IntakeReservationScope) => Promise<number>) | undefined,
  intakeCapacity: IntakeCapacityCoordinator,
): FileIntake {
  const inputRef = useRef<HTMLInputElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const stateRef = useRef(state);
  const knownHashesRef = useRef(new Map<string, string>());
  const nextProcessingOperationRef = useRef(1);
  const controllersRef = useRef(new Map<string, AbortController>());
  const sessionGenerationRef = useRef(0);
  useLayoutEffect(() => {
    stateRef.current = state;
    const retainedIds = new Set(state.documents.map((document) => document.id));
    for (const [hash, documentId] of knownHashesRef.current) {
      if (!retainedIds.has(documentId)) knownHashesRef.current.delete(hash);
    }
    for (const document of state.documents) {
      if (document.originalHash && !knownHashesRef.current.has(document.originalHash)) {
        knownHashesRef.current.set(document.originalHash, document.id);
      }
    }
    for (const [documentId, controller] of controllersRef.current) {
      if (!retainedIds.has(documentId)) {
        controller.abort();
        controllersRef.current.delete(documentId);
      }
    }
  }, [state]);

  const performIntake = useCallback(async (files: readonly File[], generation: number, baseCapacity: IntakeCapacity, reservations: IntakeReservationScope) => {
    if (files.length === 0 || generation !== sessionGenerationRef.current) return { acceptedCount: 0, acceptedBytes: 0 };
    const zipProjects = files.filter((file) => file.name.toLowerCase().endsWith(".zip"));
    const documents = files.filter((file) => !file.name.toLowerCase().endsWith(".zip"));
    let admittedProjectBytes = 0;
    if (zipProjects.length > 0 && intakeZipProjects) {
      admittedProjectBytes = await intakeZipProjects(zipProjects, baseCapacity, reservations);
    }
    if (documents.length === 0) return { acceptedCount: 0, acceptedBytes: admittedProjectBytes };
    const results = await services.preflight(documents, { ...baseCapacity, acceptedBytes: baseCapacity.acceptedBytes + admittedProjectBytes });
    if (generation !== sessionGenerationRef.current) return { acceptedCount: 0, acceptedBytes: 0 };
    const issues = results.flatMap((result) => result.accepted ? [] : [{
      filename: result.file.name,
      message: result.issue.message,
    }]);
    dispatch({
      type: "intake/issues",
      issues,
      message: issues.length === results.length ? "No supported files were added." : `${issues.length} files were not added.`,
    });
    const accepted = results.filter((result) => result.accepted);
    if (accepted.length === 0) return { acceptedCount: 0, acceptedBytes: admittedProjectBytes };

    const batchId = services.createDocumentId();
    const identityIssues: Array<{ filename: string; message: string }> = [];
    const admitted = accepted.flatMap((result) => {
      const id = services.createDocumentId();
      const reservation = reservations.reserveItem({
        id,
        acceptedCount: 1,
        acceptedBytes: result.file.size,
      });
      if (reservation === null) {
        identityIssues.push({ filename: result.file.name, message: "This file conflicts with an existing workspace item and was not added." });
        return [];
      }
      const document: WorkspaceDocument = {
        kind: "document",
        id,
        original: result.file,
        originalByteSize: result.file.size,
        originalHash: "",
        name: result.file.name,
        format: result.format,
        ...(result.languageId ? { languageId: result.languageId } : {}),
        ...(result.previewKind ? { previewKind: result.previewKind } : {}),
        status: "queued",
        extractedText: "",
        extractedTextHash: "",
        warnings: [],
        pageCount: null,
        visualAssets: [],
        ocrCandidates: [],
        extractionOptions: cloneExtractionOptions(stateRef.current.globalExtractionOptions),
        requiresReview: true,
        settingsOverride: {},
        contextWarningAcknowledged: false,
      };
      return [{ result, document, reservation }];
    });
    if (identityIssues.length > 0) {
      dispatch({
        type: "intake/issues",
        issues: [...issues, ...identityIssues],
        message: `${identityIssues.length} conflicting ${identityIssues.length === 1 ? "file was" : "files were"} not added.`,
      });
    }
    if (admitted.length === 0) return { acceptedCount: 0, acceptedBytes: admittedProjectBytes };
    dispatch({
      type: "intake/accepted",
      batchId,
      documents: admitted.map(({ document, reservation }) => ({ document, uploadOrdinal: reservation.uploadOrdinal })),
    });
    for (const { reservation } of admitted) reservation.commit();

    let cursor = 0;
    const worker = async () => {
      while (cursor < admitted.length) {
        const current = admitted[cursor++];
        const operationId = nextProcessingOperationRef.current++;
        const controller = new AbortController();
        controllersRef.current.set(current.document.id, controller);
        dispatch({ type: "extraction/started", batchId, documentId: current.document.id, operationId });
        try {
          let extraction = await services.extract(
            current.result,
            Array.from(knownHashesRef.current, ([originalHash, id]) => ({ id, originalHash })),
            current.document.extractionOptions,
            controller.signal,
            (progress) => dispatch({ type: "extraction/progress", documentId: current.document.id, operationId, progress }),
          );
          if (generation !== sessionGenerationRef.current) continue;
          const duplicateOf = extraction.duplicateOf ?? knownHashesRef.current.get(extraction.originalHash);
          if (duplicateOf) {
            const warning = "This file duplicates an existing document and needs review.";
            extraction = {
              ...extraction,
              duplicateOf,
              warnings: extraction.warnings.includes(warning) ? [...extraction.warnings] : [...extraction.warnings, warning],
            };
          } else {
            knownHashesRef.current.set(extraction.originalHash, current.document.id);
          }
          dispatch({
            type: "extraction/succeeded",
            batchId,
            documentId: current.document.id,
            operationId,
            result: extraction,
          });
        } catch (error) {
          if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
            dispatch({ type: "extraction/cancelled", documentId: current.document.id, operationId });
            continue;
          }
          dispatch({
            type: "extraction/failed",
            batchId,
            documentId: current.document.id,
            operationId,
            message: safeExtractionMessage(error),
          });
        } finally {
          if (controllersRef.current.get(current.document.id) === controller) {
            controllersRef.current.delete(current.document.id);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, admitted.length) }, () => worker()));
    return {
      acceptedCount: admitted.length,
      acceptedBytes: admittedProjectBytes + admitted.reduce((total, { result }) => total + result.file.size, 0),
    };
  }, [dispatch, intakeZipProjects, services]);

  const intake = useCallback((files: readonly File[]) => {
    const generation = sessionGenerationRef.current;
    return intakeCapacity.run(async (capacity, reservations) => {
      const admitted = await performIntake(files, generation, capacity, reservations);
      return { value: undefined, ...admitted };
    });
  }, [intakeCapacity, performIntake]);

  const onInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    void intake(files).catch(() => undefined);
  }, [intake]);

  const openFilePicker = useCallback(() => inputRef.current?.click(), []);
  const onDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    dispatch({ type: "intake/drag-changed", dragging: true });
  }, [dispatch]);
  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    dispatch({ type: "intake/drag-changed", dragging: false });
  }, [dispatch]);
  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => event.preventDefault(), []);
  const onDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    dispatch({ type: "intake/drag-changed", dragging: false });
    void intake(Array.from(event.dataTransfer.files)).catch(() => undefined);
  }, [dispatch, intake]);

  const retry = useCallback((documentId: string, optionsOverride?: import("../../domain").ExtractionOptions) => {
    const document = stateRef.current.documents.find((item) => item.id === documentId);
    if (!document) return;
    controllersRef.current.get(documentId)?.abort();
    const operationId = nextProcessingOperationRef.current++;
    const controller = new AbortController();
    controllersRef.current.set(documentId, controller);
    dispatch({ type: "extraction/started", batchId: document.batchId, documentId, operationId });
    void document.original.arrayBuffer().then((originalBytes) => services.extract(
      {
        accepted: true,
        file: document.original,
        format: document.format,
        originalBytes,
        ...(document.languageId ? { languageId: document.languageId } : {}),
        ...(document.previewKind ? { previewKind: document.previewKind } : {}),
      },
      stateRef.current.documents
        .filter((item) => item.id !== documentId && item.originalHash)
        .map((item) => ({ id: item.id, originalHash: item.originalHash })),
      optionsOverride ?? document.extractionOptions ?? stateRef.current.globalExtractionOptions,
      controller.signal,
      (progress) => dispatch({ type: "extraction/progress", documentId, operationId, progress }),
    )).then((result) => dispatch({
      type: "extraction/succeeded",
      batchId: document.batchId,
      documentId,
      operationId,
      result,
    })).catch((error) => {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        dispatch({ type: "extraction/cancelled", documentId, operationId });
      } else {
        dispatch({
          type: "extraction/failed",
          batchId: document.batchId,
          documentId,
          operationId,
          message: safeExtractionMessage(error),
        });
      }
    }).finally(() => {
      if (controllersRef.current.get(documentId) === controller) controllersRef.current.delete(documentId);
    });
  }, [dispatch, services]);

  const cancel = useCallback((documentId: string) => {
    controllersRef.current.get(documentId)?.abort();
  }, []);

  const resetSession = useCallback(() => {
    sessionGenerationRef.current += 1;
    for (const controller of controllersRef.current.values()) controller.abort();
    controllersRef.current.clear();
    knownHashesRef.current.clear();
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  return { inputRef, addButtonRef, openFilePicker, onInputChange, onDragEnter, onDragLeave, onDragOver, onDrop, retry, cancel, resetSession };
}
