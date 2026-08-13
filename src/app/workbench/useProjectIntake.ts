import { useCallback, useEffect, useLayoutEffect, useRef, type ChangeEvent } from "react";
import { readFolderProject, readZipProject, type WorkspaceProject } from "../../domain";
import type { WorkbenchServices, WorkbenchState } from "./contracts";
import type { WorkbenchAction } from "./reducer";
import type { IntakeCapacity, IntakeCapacityCoordinator } from "./intakeCapacityCoordinator";

export function useProjectIntake(
  state: WorkbenchState,
  dispatch: React.Dispatch<WorkbenchAction>,
  services: WorkbenchServices,
  intakeCapacity: IntakeCapacityCoordinator,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const generationRef = useRef(0);
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => () => { generationRef.current += 1; }, []);

  const options = useCallback((existingSessionBytes: number) => ({
    honorRootGitignore: stateRef.current.globalCodeRewriteOptions.honorRootGitignore,
    excludeDependenciesBuildGenerated: stateRef.current.globalCodeRewriteOptions.excludeDependenciesBuildGenerated,
    preserveSafeNonTextAssets: stateRef.current.globalCodeRewriteOptions.preserveSafeNonTextAssets,
    existingSessionBytes,
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
    const run = intakeCapacity.run(async (capacity) => {
      if (generation !== generationRef.current) return { value: undefined, acceptedCount: 0, acceptedBytes: 0 };
      const reader = services.readFolderProject ?? readFolderProject;
      try {
        const project = await reader({ kind: "folder", name, files }, options(capacity.acceptedBytes));
        if (generation !== generationRef.current) return { value: undefined, acceptedCount: 0, acceptedBytes: 0 };
        admit(project, generation);
        return { value: undefined, acceptedCount: 0, acceptedBytes: project.totalByteCount };
      } catch {
        if (generation === generationRef.current) dispatch({ type: "intake/issues", issues: [{ filename: name, message: "This folder could not be admitted safely." }], message: "The folder project was not added." });
        return { value: undefined, acceptedCount: 0, acceptedBytes: 0 };
      }
    });
    void run.catch(() => undefined);
  }, [admit, dispatch, intakeCapacity, options, services]);

  const intakeZip = useCallback(async (files: readonly File[], initialCapacity: IntakeCapacity) => {
    const generation = generationRef.current;
    let admittedBytes = 0;
    if (generation !== generationRef.current) return 0;
    const reader = services.readZipProject ?? readZipProject;
    let uploadOrdinal = stateRef.current.items.reduce((next, item) => Math.max(next, item.uploadOrdinal + 1), 0);
    for (const file of files) {
      try {
        const project = await reader({ kind: "zip", name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, options(initialCapacity.acceptedBytes + admittedBytes));
        if (generation !== generationRef.current) return 0;
        admittedBytes += project.totalByteCount;
        admit(project, generation, uploadOrdinal);
        uploadOrdinal += 1;
      } catch {
        if (generation === generationRef.current) dispatch({ type: "intake/issues", issues: [{ filename: file.name, message: "This ZIP project could not be admitted safely." }], message: "The ZIP project was not added." });
      }
    }
    return admittedBytes;
  }, [admit, dispatch, options, services]);

  return {
    inputRef,
    open: () => inputRef.current?.click(),
    onChange,
    intakeZip,
    resetSession: () => {
      generationRef.current += 1;
      if (inputRef.current) inputRef.current.value = "";
    },
  };
}
