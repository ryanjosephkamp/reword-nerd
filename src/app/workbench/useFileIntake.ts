import { useCallback, useEffect, useRef, type ChangeEvent, type DragEvent } from "react";
import type { WorkspaceDocument } from "../../domain";
import type { WorkbenchServices, WorkbenchState } from "./contracts";
import type { WorkbenchAction } from "./reducer";
import { safeExtractionMessage } from "./services";

interface FileIntake {
  inputRef: React.RefObject<HTMLInputElement | null>;
  addButtonRef: React.RefObject<HTMLButtonElement | null>;
  openFilePicker(): void;
  onInputChange(event: ChangeEvent<HTMLInputElement>): void;
  onDragEnter(event: DragEvent<HTMLElement>): void;
  onDragLeave(event: DragEvent<HTMLElement>): void;
  onDragOver(event: DragEvent<HTMLElement>): void;
  onDrop(event: DragEvent<HTMLElement>): void;
  retry(documentId: string): void;
}

export function useFileIntake(
  state: WorkbenchState,
  dispatch: React.Dispatch<WorkbenchAction>,
  services: WorkbenchServices,
): FileIntake {
  const inputRef = useRef<HTMLInputElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const stateRef = useRef(state);
  const capacityRef = useRef({ acceptedCount: 0, acceptedBytes: 0 });
  const nextUploadOrdinalRef = useRef(0);
  const knownHashesRef = useRef(new Map<string, string>());
  const intakeQueueRef = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    stateRef.current = state;
    capacityRef.current = {
      acceptedCount: state.documents.length,
      acceptedBytes: state.documents.reduce((total, document) => total + document.originalByteSize, 0),
    };
    nextUploadOrdinalRef.current = Math.max(
      nextUploadOrdinalRef.current,
      state.documents.reduce((next, document) => Math.max(next, document.uploadOrdinal + 1), 0),
    );
    const retainedIds = new Set(state.documents.map((document) => document.id));
    for (const [hash, documentId] of knownHashesRef.current) {
      if (!retainedIds.has(documentId)) knownHashesRef.current.delete(hash);
    }
    for (const document of state.documents) {
      if (document.originalHash && !knownHashesRef.current.has(document.originalHash)) {
        knownHashesRef.current.set(document.originalHash, document.id);
      }
    }
  }, [state]);

  const performIntake = useCallback(async (files: readonly File[]) => {
    if (files.length === 0) return;
    const results = await services.preflight(files, capacityRef.current);
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
    if (accepted.length === 0) return;
    capacityRef.current = {
      acceptedCount: capacityRef.current.acceptedCount + accepted.length,
      acceptedBytes: capacityRef.current.acceptedBytes
        + accepted.reduce((total, result) => total + result.file.size, 0),
    };

    const batchId = services.createDocumentId();
    const baseOrdinal = nextUploadOrdinalRef.current;
    nextUploadOrdinalRef.current += accepted.length;
    const admitted = accepted.map((result, index) => {
      const id = services.createDocumentId();
      const document: WorkspaceDocument = {
        id,
        original: result.file,
        originalByteSize: result.file.size,
        originalHash: "",
        name: result.file.name,
        format: result.format,
        status: "queued",
        extractedText: "",
        extractedTextHash: "",
        warnings: [],
        requiresReview: true,
        settingsOverride: {},
        contextWarningAcknowledged: false,
      };
      return { result, document, uploadOrdinal: baseOrdinal + index };
    });
    dispatch({
      type: "intake/accepted",
      batchId,
      documents: admitted.map(({ document, uploadOrdinal }) => ({ document, uploadOrdinal })),
    });

    let cursor = 0;
    const worker = async () => {
      while (cursor < admitted.length) {
        const current = admitted[cursor++];
        dispatch({ type: "extraction/started", batchId, documentId: current.document.id });
        try {
          let extraction = await services.extract(
            current.result,
            Array.from(knownHashesRef.current, ([originalHash, id]) => ({ id, originalHash })),
          );
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
            result: extraction,
          });
        } catch (error) {
          dispatch({
            type: "extraction/failed",
            batchId,
            documentId: current.document.id,
            message: safeExtractionMessage(error),
          });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, admitted.length) }, () => worker()));
  }, [dispatch, services]);

  const intake = useCallback((files: readonly File[]) => {
    const run = intakeQueueRef.current.then(() => performIntake(files));
    intakeQueueRef.current = run.catch(() => undefined);
    return run;
  }, [performIntake]);

  const onInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    void intake(files);
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
    void intake(Array.from(event.dataTransfer.files));
  }, [dispatch, intake]);

  const retry = useCallback((documentId: string) => {
    const document = stateRef.current.documents.find((item) => item.id === documentId);
    if (!document) return;
    dispatch({ type: "extraction/started", batchId: document.batchId, documentId });
    void document.original.arrayBuffer().then((originalBytes) => services.extract(
      { accepted: true, file: document.original, format: document.format, originalBytes },
      stateRef.current.documents
        .filter((item) => item.id !== documentId && item.originalHash)
        .map((item) => ({ id: item.id, originalHash: item.originalHash })),
    )).then((result) => dispatch({
      type: "extraction/succeeded",
      batchId: document.batchId,
      documentId,
      result,
    })).catch((error) => dispatch({
      type: "extraction/failed",
      batchId: document.batchId,
      documentId,
      message: safeExtractionMessage(error),
    }));
  }, [dispatch, services]);

  return { inputRef, addButtonRef, openFilePicker, onInputChange, onDragEnter, onDragLeave, onDragOver, onDrop, retry };
}
