import { createContext, useContext, type ReactNode } from "react";

const WorkspaceActivity = createContext(true);

export function WorkspaceActivityProvider({ active, children }: { active: boolean; children: ReactNode }) {
  return <WorkspaceActivity.Provider value={active}>{children}</WorkspaceActivity.Provider>;
}

/** Standalone views remain active; embedded inactive workspaces keep data, not focus. */
export function useWorkspaceActive(): boolean {
  return useContext(WorkspaceActivity);
}
