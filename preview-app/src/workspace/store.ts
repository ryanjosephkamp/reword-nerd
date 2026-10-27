import { WORKSPACE_LIMITS } from "./codec";
export const WORKSPACE_DATABASE = "reword-nerd:preview:workspace:v1";
export interface SavedWorkspace { revision: number; enabled: boolean; file: Blob | null; previous: Blob | null; savedAt: string | null }
export interface WorkspaceStore {
  readonly label: string;
  read(): Promise<SavedWorkspace>;
  save(file: Blob, expected: number): Promise<SavedWorkspace>;
  enable(enabled: boolean, expected: number): Promise<SavedWorkspace>;
  forget(expected: number): Promise<SavedWorkspace>;
}
export const emptySave = (): SavedWorkspace => ({ revision: 0, enabled: false, file: null, previous: null, savedAt: null });
export const conflictMessage = "Another tab or window changed the saved workspace. Autosave is paused. Export this tab or load the latest saved copy before continuing.";

/** One transaction replaces the current revision and retains its predecessor. */
export class IndexedWorkspaceStore implements WorkspaceStore {
  readonly label = "This browser on this device";
  private database: Promise<IDBDatabase>;
  constructor() {
    this.database = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") return reject(Error("Browser storage is unavailable. Export your workspace to keep it."));
      const request = indexedDB.open(WORKSPACE_DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("workspace");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(Error("Browser storage could not open. Export your workspace to keep it."));
      request.onblocked = () => reject(Error("Another window is blocking workspace storage. Close that window or export this workspace."));
    });
  }
  async read(): Promise<SavedWorkspace> {
    const db = await this.database;
    return new Promise((resolve, reject) => {
      const request = db.transaction("workspace", "readonly").objectStore("workspace").get("current");
      request.onsuccess = () => resolve(request.result ?? emptySave());
      request.onerror = () => reject(Error("The saved workspace could not be read. The stored copy is unchanged."));
    });
  }
  private async change(expected: number, transform: (old: SavedWorkspace) => SavedWorkspace): Promise<SavedWorkspace> {
    const db = await this.database;
    return new Promise((resolve, reject) => {
      let next: SavedWorkspace, error: Error | undefined;
      const tx = db.transaction("workspace", "readwrite");
      const store = tx.objectStore("workspace"), request = store.get("current");
      request.onsuccess = () => {
        const old: SavedWorkspace = request.result ?? emptySave();
        if (old.revision !== expected) { error = Error(conflictMessage); tx.abort(); return; }
        try { next = transform(old); store.put(next, "current"); }
        catch { error = Error("Workspace save failed or storage is full. The previous confirmed save is unchanged. Export this tab to keep your latest work."); tx.abort(); }
      };
      tx.oncomplete = () => resolve(next);
      tx.onabort = tx.onerror = () => reject(error ?? Error("Workspace save failed or storage is full. The previous confirmed save is unchanged. Export this tab to keep your latest work."));
    });
  }
  save(file: Blob, expected: number): Promise<SavedWorkspace> {
    if (file.size > WORKSPACE_LIMITS.bytes) return Promise.reject(Error("Workspace recovery size limit exceeded."));
    return this.change(expected, old => ({ revision: old.revision + 1, enabled: true, file, previous: old.file ?? old.previous, savedAt: new Date().toISOString() }));
  }
  enable(enabled: boolean, expected: number) { return this.change(expected, old => ({ ...old, revision: old.revision + 1, enabled })); }
  forget(expected: number) { return this.change(expected, old => ({ ...emptySave(), revision: old.revision + 1 })); }
}
