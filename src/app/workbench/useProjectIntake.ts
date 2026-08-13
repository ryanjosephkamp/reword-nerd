import { useCallback, useEffect, useLayoutEffect, useRef, type ChangeEvent } from "react";
import { readFolderProject, readZipProject, type WorkspaceProject } from "../../domain";
import type { WorkbenchServices, WorkbenchState } from "./contracts";
import type { WorkbenchAction } from "./reducer";

export function useProjectIntake(
  state: WorkbenchState,
  dispatch: React.Dispatch<WorkbenchAction>,
  services: WorkbenchServices,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const generationRef = useRef(0);
  const stateRef = useRef(state);
  useLayoutEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => () => { generationRef.current += 1; }, []);

  const options = useCallback((reservedBytes = 0) => ({
    honorRootGitignore: stateRef.current.globalCodeRewriteOptions.honorRootGitignore,
    excludeDependenciesBuildGenerated: stateRef.current.globalCodeRewriteOptions.excludeDependenciesBuildGenerated,
    preserveSafeNonTextAssets: stateRef.current.globalCodeRewriteOptions.preserveSafeNonTextAssets,
    existingSessionBytes: stateRef.current.items.reduce((total, item) => total + (item.kind === "project" ? item.totalByteCount : item.originalByteSize), 0) + reservedBytes,
  }), []);

  const admit = useCallback((project: WorkspaceProject, generation: number, uploadOrdinal?: number) => {
    if (generation !== generationRef.current) return;
    const ordinal = uploadOrdinal ?? stateRef.current.items.reduce((next, item) => Math.max(next, item.uploadOrdinal + 1), 0);
    dispatch({ type: "project/admitted", project, uploadOrdinal: ordinal });
  }, [dispatch]);

  const onChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length === 0) return;
    const generation = generationRef.current;
    const path = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath ?? files[0].name;
    const name = path.split("/")[0] || "project";
    const reader = services.readFolderProject ?? readFolderProject;
    void reader({ kind: "folder", name, files }, options()).then((project) => admit(project, generation)).catch(() => {
      if (generation === generationRef.current) dispatch({ type: "intake/issues", issues: [{ filename: name, message: "This folder could not be admitted safely." }], message: "The folder project was not added." });
    });
  }, [admit, dispatch, options, services]);

  const intakeZip = useCallback(async (files: readonly File[]) => {
    const generation = generationRef.current;
    const reader = services.readZipProject ?? readZipProject;
    let reservedBytes = 0;
    let uploadOrdinal = stateRef.current.items.reduce((next, item) => Math.max(next, item.uploadOrdinal + 1), 0);
    for (const file of files) {
      try {
        const project = await reader({ kind: "zip", name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, options(reservedBytes));
        admit(project, generation, uploadOrdinal);
        if (generation !== generationRef.current) return 0;
        reservedBytes += project.totalByteCount;
        uploadOrdinal += 1;
      } catch {
        if (generation === generationRef.current) dispatch({ type: "intake/issues", issues: [{ filename: file.name, message: "This ZIP project could not be admitted safely." }], message: "The ZIP project was not added." });
      }
    }
    return reservedBytes;
  }, [admit, dispatch, options, services]);

  return {
    inputRef,
    open: () => inputRef.current?.click(),
    onChange,
    intakeZip,
    resetSession: () => { generationRef.current += 1; },
  };
}
