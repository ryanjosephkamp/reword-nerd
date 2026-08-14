import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useState,
} from "react";
import type { ImagePortalItem } from "../contracts";
import type {
  ImageInputFile,
  ImageIntakePdfCaptureContext,
  ImageIntakeIssue,
  ImageIntakeResult,
  ImagePdfCaptureChoice,
} from "../intake";
import type { ImageOcrToken } from "../ocrService";
import {
  loadImagePreferences,
  saveImagePreferences,
  snapshotImagePreferences,
} from "../preferences";
import {
  createInitialImagePortalState,
  imagePortalReducer,
  type ImagePortalAction,
  type ImagePortalState,
} from "../reducer";
import type { ImagePdfCaptureRequestView } from "./contracts";
import {
  createImageOccurrenceId,
  defaultImageWorkbenchServices,
  type ImageWorkbenchServices,
} from "./services";

interface ActiveIntakeRun {
  readonly id: number;
  readonly expectedSessionGeneration: number;
  readonly generation: number;
}

interface PendingPdfCapture {
  readonly context: ImageIntakePdfCaptureContext;
  readonly resolve: (choice: ImagePdfCaptureChoice) => void;
  readonly reject: (reason: unknown) => void;
  readonly onAbort: () => void;
}

export interface ImageSessionController {
  readonly state: ImagePortalState;
  readonly intakeBusy: boolean;
  readonly ledger: ImageIntakeResult["ledger"];
  readonly intakeIssues: readonly ImageIntakeIssue[];
  readonly pdfCapture: ImagePdfCaptureRequestView | null;
  readonly objectUrls: ReturnType<ImageWorkbenchServices["createObjectUrls"]>;
  dispatch(action: ImagePortalAction): boolean;
  intakeFiles(inputs: readonly ImageInputFile[]): Promise<boolean>;
  intakeFolder(inputs: readonly ImageInputFile[]): Promise<boolean>;
  choosePdfCapture(choice: ImagePdfCaptureChoice): void;
  resetSession(): void;
  discardItem(item: Readonly<ImagePortalItem>): void;
  runOcr(itemIds: readonly string[]): Promise<void>;
  reviewOcr(itemId: string, status: "accepted" | "rejected", reviewedText: string | null): boolean;
  isCurrentOcrToken(token: ImageOcrToken): boolean;
}

function issuesFromResult(result: ImageIntakeResult): readonly ImageIntakeIssue[] {
  return result.ledger.flatMap((entry) => entry.issue ? [entry.issue] : []);
}

function abortError(): DOMException {
  return new DOMException("PDF capture selection cancelled.", "AbortError");
}

export function useImageSession(
  services: ImageWorkbenchServices = defaultImageWorkbenchServices,
): ImageSessionController {
  const [initialState] = useState<ImagePortalState>(() => createInitialImagePortalState(loadImagePreferences()));
  const [state, rawDispatch] = useReducer(imagePortalReducer, initialState);
  const [stateRef] = useState(() => ({ current: initialState }));
  const [intakeBusy, setIntakeBusy] = useState(false);
  const [ledger, setLedger] = useState<ImageIntakeResult["ledger"]>([]);
  const [pdfCapture, setPdfCapture] = useState<ImagePdfCaptureRequestView | null>(null);
  const [activeIntakeRef] = useState<{ current: ActiveIntakeRun | null }>(() => ({ current: null }));
  const [nextIntakeIdRef] = useState(() => ({ current: 0 }));
  const [pendingPdfRef] = useState<{ current: PendingPdfCapture | null }>(() => ({ current: null }));
  const [mountedRef] = useState(() => ({ current: true }));

  const dispatch = useCallback((action: ImagePortalAction): boolean => {
    const previous = stateRef.current;
    const next = imagePortalReducer(previous, action);
    if (next !== previous) stateRef.current = next;
    rawDispatch(action);
    if (next !== previous && (action.type === "defaults/changed" || action.type === "tutorial/seen")) {
      saveImagePreferences(snapshotImagePreferences(next.defaults, next.tutorialSeenVersion));
    }
    return next !== previous;
  }, [stateRef]);

  const isCurrentOcrToken = useCallback((token: ImageOcrToken): boolean => {
    const current = stateRef.current;
    const item = current.items.find((candidate) => candidate.id === token.itemId);
    return current.sessionGeneration === token.sessionGeneration
      && item?.incarnation === token.itemIncarnation
      && item.sourceHash === token.sourceHash
      && item.ocr.operationGeneration === token.ocrGeneration
      && item.ocr.status === "processing";
  }, [stateRef]);

  const [objectUrls] = useState(() => services.createObjectUrls());
  const [ocrRef] = useState<{ current: ReturnType<ImageWorkbenchServices["createOcr"]> | null }>(
    () => ({ current: null }),
  );
  const [intakeRef] = useState<{ current: ReturnType<ImageWorkbenchServices["createIntake"]> | null }>(
    () => ({ current: null }),
  );

  const resolvePdfCapture = useCallback((context: ImageIntakePdfCaptureContext) => {
    return new Promise<ImagePdfCaptureChoice>((resolve, reject) => {
      if (context.signal.aborted) {
        reject(abortError());
        return;
      }
      const existing = pendingPdfRef.current;
      if (existing) {
        existing.context.signal.removeEventListener("abort", existing.onAbort);
        existing.resolve({ mode: "embedded-only" });
      }
      const onAbort = () => {
        const pending = pendingPdfRef.current;
        if (!pending || pending.context !== context) return;
        pendingPdfRef.current = null;
        if (mountedRef.current) setPdfCapture(null);
        reject(abortError());
      };
      pendingPdfRef.current = { context, resolve, reject, onAbort };
      context.signal.addEventListener("abort", onAbort, { once: true });
      setPdfCapture({ inputName: context.inputName, path: context.path, pageCount: context.pageCount });
    });
  }, [mountedRef, pendingPdfRef]);

  const initializeServices = useCallback(() => {
    ocrRef.current ??= services.createOcr({ isCurrent: isCurrentOcrToken });
    intakeRef.current ??= services.createIntake({
        idFactory: createImageOccurrenceId,
        resolvePdfCapture,
        publish: (admission, sessionEpoch) => {
          const run = activeIntakeRef.current;
          if (!run || run.expectedSessionGeneration !== stateRef.current.sessionGeneration) {
            return { accepted: false, occurrenceId: admission.id, sessionEpoch };
          }
          dispatch({
            type: "items/admitted",
            generation: run.generation,
            expectedSessionGeneration: run.expectedSessionGeneration,
            items: [admission],
          });
          const accepted = stateRef.current.items.some((item) => item.id === admission.id
            && item.sourceBytes === admission.sourceBytes);
          if (accepted) intakeRef.current?.reconcile(stateRef.current.items);
          return { accepted, occurrenceId: admission.id, sessionEpoch };
        },
      });
  }, [activeIntakeRef, dispatch, intakeRef, isCurrentOcrToken, ocrRef, resolvePdfCapture, services, stateRef]);

  useLayoutEffect(() => {
    initializeServices();
  }, [initializeServices]);

  useLayoutEffect(() => {
    stateRef.current = state;
    intakeRef.current?.reconcile(state.items);
  }, [intakeRef, state, stateRef]);

  const choosePdfCapture = useCallback((choice: ImagePdfCaptureChoice) => {
    const pending = pendingPdfRef.current;
    if (!pending) return;
    pendingPdfRef.current = null;
    pending.context.signal.removeEventListener("abort", pending.onAbort);
    setPdfCapture(null);
    pending.resolve(choice);
  }, [pendingPdfRef]);

  const runIntake = useCallback(async (
    inputs: readonly ImageInputFile[],
    route: "files" | "folder",
  ): Promise<boolean> => {
    if (activeIntakeRef.current || inputs.length === 0) return false;
    const current = stateRef.current;
    const run: ActiveIntakeRun = {
      id: ++nextIntakeIdRef.current,
      expectedSessionGeneration: current.sessionGeneration,
      generation: current.operationGeneration + 1,
    };
    if (!dispatch({
      type: "operation/started",
      generation: run.generation,
      expectedSessionGeneration: run.expectedSessionGeneration,
    })) return false;
    activeIntakeRef.current = run;
    setIntakeBusy(true);
    setLedger([]);
    try {
      const result = route === "folder"
        ? await intakeRef.current!.intakeFolder(inputs)
        : await intakeRef.current!.intake(inputs);
      if (activeIntakeRef.current?.id === run.id
        && stateRef.current.sessionGeneration === run.expectedSessionGeneration) {
        setLedger(result.ledger);
      }
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return false;
      return false;
    } finally {
      if (activeIntakeRef.current?.id === run.id) {
        activeIntakeRef.current = null;
        if (mountedRef.current) setIntakeBusy(false);
      }
    }
  }, [activeIntakeRef, dispatch, intakeRef, mountedRef, nextIntakeIdRef, stateRef]);

  const resetSession = useCallback(() => {
    activeIntakeRef.current = null;
    const pending = pendingPdfRef.current;
    if (pending) {
      pendingPdfRef.current = null;
      pending.context.signal.removeEventListener("abort", pending.onAbort);
      pending.reject(abortError());
    }
    intakeRef.current?.reset();
    objectUrls.disposeAll();
    void ocrRef.current?.reset();
    setPdfCapture(null);
    setLedger([]);
    setIntakeBusy(false);
    dispatch({ type: "session/reset" });
  }, [activeIntakeRef, dispatch, intakeRef, objectUrls, ocrRef, pendingPdfRef]);

  const discardItem = useCallback((item: Readonly<ImagePortalItem>) => {
    void ocrRef.current?.cancelItem(item.id, item.sourceHash);
    objectUrls.disposeOccurrence(item.id);
    dispatch({ type: "item/removed", itemId: item.id });
  }, [dispatch, objectUrls, ocrRef]);

  const runOcr = useCallback(async (itemIds: readonly string[]) => {
    for (const itemId of itemIds) {
      const item = stateRef.current.items.find((candidate) => candidate.id === itemId);
      if (!item) continue;
      const generation = item.ocr.operationGeneration + 1;
      const token: ImageOcrToken = {
        sessionGeneration: stateRef.current.sessionGeneration,
        itemId: item.id,
        itemIncarnation: item.incarnation,
        sourceHash: item.sourceHash,
        ocrGeneration: generation,
      };
      const started = dispatch({
        type: "ocr/started",
        itemId: item.id,
        generation,
        expectedSessionGeneration: token.sessionGeneration,
        expectedItemIncarnation: token.itemIncarnation,
        expectedSourceHash: token.sourceHash,
      });
      if (!started) continue;
      try {
        const result = await ocrRef.current!.recognize({ token, sourceBytes: item.sourceBytes });
        dispatch({
          type: "ocr/completed",
          itemId: result.token.itemId,
          generation: result.token.ocrGeneration,
          expectedSessionGeneration: result.token.sessionGeneration,
          expectedItemIncarnation: result.token.itemIncarnation,
          expectedSourceHash: result.token.sourceHash,
          detectedText: result.detectedText,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") continue;
        dispatch({
          type: "ocr/failed",
          itemId: token.itemId,
          generation: token.ocrGeneration,
          expectedSessionGeneration: token.sessionGeneration,
          expectedItemIncarnation: token.itemIncarnation,
          expectedSourceHash: token.sourceHash,
        });
      }
    }
  }, [dispatch, ocrRef, stateRef]);

  const reviewOcr = useCallback((
    itemId: string,
    status: "accepted" | "rejected",
    reviewedText: string | null,
  ): boolean => {
    const current = stateRef.current;
    const item = current.items.find((candidate) => candidate.id === itemId);
    if (!item) return false;
    return dispatch({
      type: "ocr/reviewed",
      itemId: item.id,
      expectedSessionGeneration: current.sessionGeneration,
      expectedItemIncarnation: item.incarnation,
      expectedSourceHash: item.sourceHash,
      expectedOperationGeneration: item.ocr.operationGeneration,
      expectedReviewRevision: item.reviewRevision,
      status,
      reviewedText,
    });
  }, [dispatch, stateRef]);

  useEffect(() => {
    mountedRef.current = true;
    initializeServices();
    return () => {
      mountedRef.current = false;
      activeIntakeRef.current = null;
      const pending = pendingPdfRef.current;
      if (pending) {
        pending.context.signal.removeEventListener("abort", pending.onAbort);
        pending.reject(abortError());
        pendingPdfRef.current = null;
      }
      const intake = intakeRef.current;
      intakeRef.current = null;
      intake?.reset();
      objectUrls.disposeAll();
      const ocr = ocrRef.current;
      ocrRef.current = null;
      void ocr?.dispose();
    };
  }, [activeIntakeRef, initializeServices, intakeRef, mountedRef, objectUrls, ocrRef, pendingPdfRef]);

  return {
    state,
    intakeBusy,
    ledger,
    intakeIssues: issuesFromResult({ admissions: [], ledger }),
    pdfCapture,
    objectUrls,
    dispatch,
    intakeFiles: (inputs) => runIntake(inputs, "files"),
    intakeFolder: (inputs) => runIntake(inputs, "folder"),
    choosePdfCapture,
    resetSession,
    discardItem,
    runOcr,
    reviewOcr,
    isCurrentOcrToken,
  };
}
