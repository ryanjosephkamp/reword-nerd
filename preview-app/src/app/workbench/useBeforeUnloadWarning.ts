import { useWorkspaceStatus } from "../../workspace/Workspace";
import { useEffect } from "react";

export function useBeforeUnloadWarning(active: boolean): void {
  const workspace = useWorkspaceStatus();
  const warn = active && !(workspace.enabled && !workspace.dirty && !workspace.saving && !workspace.error);
  useEffect(() => {
    if (!warn) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [warn]);
}
