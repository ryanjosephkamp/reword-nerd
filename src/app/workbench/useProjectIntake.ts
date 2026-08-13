import { useCallback, useEffect, useLayoutEffect, useRef, type ChangeEvent } from "react";
import { MAX_ZIP_CONTAINER_BYTES, readFolderProject, readZipProject, type WorkspaceProject } from "../../domain";
import type { WorkbenchServices, WorkbenchState } from "./contracts";
import type { WorkbenchAction } from "./reducer";
import type { IntakeCapacity, IntakeCapacityCoordinator, IntakeReservationScope } from "./intakeCapacityCoordinator";

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

  const admit = useCallback((project: WorkspaceProject, generation: number, filename: string, reservations: IntakeReservationScope) => {
    if (generation !== generationRef.current) return false;
    const reservation = reservations.reserveItem({
      id: project.id,
      projectTreeHash: project.originalTreeHash,
      acceptedCount: 0,
      acceptedBytes: project.totalByteCount,
    });
    if (reservation === null) {
      dispatch({
        type: "intake/issues",
        issues: [{ filename, message: "This project duplicates an existing project and was not added." }],
        message: "The duplicate project was not added.",
      });
      return false;
    }
    dispatch({ type: "project/admitted", project, uploadOrdinal: reservation.uploadOrdinal });
    reservation.commit();
    return true;
  }, [dispatch]);

  const onChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length === 0) return;
    const generation = generationRef.current;
    const path = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath ?? files[0].name;
    const name = path.split("/")[0] || "project";
    const run = intakeCapacity.run(async (capacity, reservations) => {
      if (generation !== generationRef.current) return { value: undefined, acceptedCount: 0, acceptedBytes: 0 };
      const reader = services.readFolderProject ?? readFolderProject;
      try {
        const project = await reader({ kind: "folder", name, files }, options(capacity.acceptedBytes));
        if (generation !== generationRef.current) return { value: undefined, acceptedCount: 0, acceptedBytes: 0 };
        const admitted = admit(project, generation, name, reservations);
        return { value: undefined, acceptedCount: 0, acceptedBytes: admitted ? project.totalByteCount : 0 };
      } catch {
        if (generation === generationRef.current) dispatch({ type: "intake/issues", issues: [{ filename: name, message: "This folder could not be admitted safely." }], message: "The folder project was not added." });
        return { value: undefined, acceptedCount: 0, acceptedBytes: 0 };
      }
    });
    void run.catch(() => undefined);
  }, [admit, dispatch, intakeCapacity, options, services]);

  const intakeZip = useCallback(async (files: readonly File[], initialCapacity: IntakeCapacity, reservations: IntakeReservationScope) => {
    const generation = generationRef.current;
    let admittedBytes = 0;
    if (generation !== generationRef.current) return 0;
    const reader = services.readZipProject ?? readZipProject;
    for (const file of files) {
      try {
        if (!Number.isSafeInteger(file.size) || file.size > MAX_ZIP_CONTAINER_BYTES) {
          throw new Error("ZIP_CONTAINER_LIMIT_EXCEEDED");
        }
        const project = await reader({ kind: "zip", name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, options(initialCapacity.acceptedBytes + admittedBytes));
        if (generation !== generationRef.current) return 0;
        if (admit(project, generation, file.name, reservations)) {
          admittedBytes += project.totalByteCount;
        }
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
