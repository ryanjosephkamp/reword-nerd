import { useCallback, useEffect, useRef } from "react";
import type { WorkbenchServices, WorkbenchState } from "./contracts";
import type { WorkbenchAction } from "./reducer";

export function useReviewEditor(
  state: WorkbenchState,
  dispatch: React.Dispatch<WorkbenchAction>,
  services: WorkbenchServices,
) {
  const timers = useRef(new Map<string, number>());

  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.clear();
  }, []);

  const edit = useCallback((documentId: string, text: string) => {
    const revision = (state.editor[documentId]?.revision ?? 0) + 1;
    dispatch({ type: "editor/edited", documentId, text });
    const previous = timers.current.get(documentId);
    if (previous) window.clearTimeout(previous);
    timers.current.set(documentId, window.setTimeout(() => {
      const hashWithOneRetry = async () => {
        try {
          return await services.hashText(text);
        } catch {
          return services.hashText(text);
        }
      };
      void hashWithOneRetry().then((hash) => {
        dispatch({ type: "editor/hash-completed", documentId, revision, hash });
      }).catch(() => {
        dispatch({ type: "editor/hash-failed", documentId, revision });
      });
    }, 160));
  }, [dispatch, services, state.editor]);

  const confirm = useCallback((documentId: string) => {
    const editorState = state.editor[documentId];
    const document = state.documents.find((item) => item.id === documentId);
    if (!editorState || !document) return;
    const revision = editorState.revision;
    if (editorState.hashFailed) {
      dispatch({ type: "editor/hash-retry-started", documentId, revision });
      void services.hashText(document.extractedText).then((hash) => {
        dispatch({ type: "editor/hash-completed", documentId, revision, hash });
        dispatch({ type: "review/confirmed", documentId, revision });
      }).catch(() => dispatch({ type: "editor/hash-failed", documentId, revision }));
      return;
    }
    dispatch({ type: "review/confirmed", documentId, revision });
  }, [dispatch, services, state.documents, state.editor]);

  return { edit, confirm };
}
