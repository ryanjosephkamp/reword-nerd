/* eslint-disable react-refresh/only-export-components -- Workspace controls and hooks share one scoped context. */
import { Component, createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { DeviceWorkspaceStore } from "./companionStore";
import { WorkspaceRegistry, type WorkspaceStatus } from "./registry";
import "./workspace.css";
const Context = createContext<WorkspaceRegistry | null>(null);
const idle: WorkspaceStatus = { ready: true, enabled: false, dirty: false, saving: false, savedAt: null, error: "", notice: "", generation: 0, hasSaved: false, hasPrevious: false, location: "" };
const noop = () => () => {};
const getIdle = () => idle;
export function useWorkspaceStatus() {
  const registry = useContext(Context);
  return useSyncExternalStore(registry?.subscribe ?? noop, registry?.getStatus ?? getIdle, getIdle);
}
function initialValue<T>(initial: T | (() => T)): T { return typeof initial === "function" ? (initial as () => T)() : initial; }
export function useWorkspaceState<T>(key: string, initial: T | (() => T), options: { binding?: string; restore?: (value: unknown) => T } = {}): [T, Dispatch<SetStateAction<T>>] {
  const registry = useContext(Context), binding = options.binding ?? null;
  const [value, setValue] = useState<T>(() => registry ? registry.read(key, () => initialValue(initial), binding, options.restore) : initialValue(initial));
  useEffect(() => { registry?.capture(key, value, binding); }, [registry, key, binding, value]);
  return [value, setValue];
}
export function useWorkspaceInitial<T>(key: string, initialize: () => T): T {
  const registry = useContext(Context);
  return useState(() => registry ? registry.read(key, initialize) : initialize())[0];
}
export function useWorkspaceCapture(key: string, value: unknown) {
  const registry = useContext(Context);
  useEffect(() => { registry?.capture(key, value); }, [registry, key, value]);
}
export function useWorkspaceReducer<T, A>(key: string, reducer: (state: T, action: A) => T, initialize: () => T): [T, Dispatch<A>] {
  const [state, setState] = useWorkspaceState(key, initialize);
  const dispatch = useCallback((action: A) => setState(current => reducer(current, action)), [reducer, setState]);
  return [state, dispatch];
}
class WorkspaceBoundary extends Component<{ children: ReactNode; generation: number; onError(error: unknown): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.onError(Error("The recovered workspace could not be opened. Saved copies are unchanged. Export the saved file, load another copy, or forget it to start again.")); void error; }
  componentDidUpdate(previous: { generation: number }) { if (previous.generation !== this.props.generation && this.state.failed) this.setState({ failed: false }); }
  render() { return this.state.failed ? <main className="workspace-error" role="alert">The recovered workspace could not be opened. Use the workspace controls above to keep or restore a saved copy.</main> : this.props.children; }
}
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [registry] = useState(() => new WorkspaceRegistry(new DeviceWorkspaceStore()));
  const status = useSyncExternalStore(registry.subscribe, registry.getStatus, registry.getStatus);
  useEffect(() => { void registry.initialize(); return () => registry.dispose(); }, [registry]);
  useEffect(() => {
    const hide = () => { if (document.visibilityState === "hidden") void registry.flush(); };
    const unload = (event: BeforeUnloadEvent) => { const s = registry.status; if (s.dirty || s.saving || s.error) { event.preventDefault(); event.returnValue = ""; } };
    document.addEventListener("visibilitychange", hide); window.addEventListener("beforeunload", unload);
    return () => { document.removeEventListener("visibilitychange", hide); window.removeEventListener("beforeunload", unload); };
  }, [registry]);
  return <Context.Provider value={registry}><WorkspaceControls />{status.ready ? <WorkspaceBoundary generation={status.generation} onError={registry.fail}><div key={status.generation}>{children}</div></WorkspaceBoundary> : <p className="workspace-loading" role="status">Checking for a saved workspace…</p>}</Context.Provider>;
}
function download(file: Blob, name: string) { const url = URL.createObjectURL(file), anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export function WorkspaceControls() {
  const registry = useContext(Context), status = useWorkspaceStatus();
  const [pending, setPending] = useState<File | null>(null), [forget, setForget] = useState(false), [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  if (!registry) return null;
  const action = async (run: () => Promise<unknown>) => { setBusy(true); try { await run(); } catch (error) { registry.fail(error); } finally { setBusy(false); } };
  return <aside className="workspace-recovery" aria-label="Workspace recovery">
    <div className="workspace-recovery-line"><span data-testid="workspace-save-status" role="status">{!status.ready ? "Checking saved workspace…" : status.saving ? "Saving workspace…" : status.error ? "Autosave paused · export to keep your latest work" : status.enabled ? status.dirty ? "Changes waiting to save…" : `Saved ${status.savedAt ? new Date(status.savedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "locally"}` : "Session only · export to keep your work"}</span>
      {!status.enabled && <button disabled={busy || !status.ready} onClick={() => void action(() => registry.setEnabled(true))}>Remember this workspace on this device</button>}
      <details><summary>Workspace options</summary><div className="workspace-options"><p>{status.notice}</p><p>Remembering autosaves documents, images, projects, reviewed content, prompts, responses, settings, packages, review decisions, and job references locally. Recovery never sends or resumes a job. Provider credentials stay with the execution harness.</p><p>{status.location}. Up to 512 MiB per save; one previous copy is retained. Browser data can be cleared or evicted. Export a workspace file for a portable backup.</p>
        <div className="workspace-actions"><button disabled={busy} onClick={() => void action(async () => download(await registry.exportFile(), "reword-nerd-workspace.rn-workspace"))}>Export workspace file</button>
          <label className="workspace-import">Import workspace file<input ref={input} type="file" accept=".rn-workspace,application/x-reword-nerd-workspace" disabled={busy} onChange={e => { setPending(e.target.files?.[0] ?? null); e.target.value = ""; }} /></label>
          {status.enabled && <button disabled={busy} onClick={() => void action(() => registry.setEnabled(false))}>Pause autosave</button>}
          {status.hasSaved && <button disabled={busy} onClick={() => void action(() => registry.loadSaved())}>Load latest saved workspace</button>}
          {status.hasPrevious && <button disabled={busy} onClick={() => void action(() => registry.loadSaved(true))}>Recover previous saved copy</button>}
          {status.hasSaved && <button disabled={busy} onClick={() => { const file = registry.savedFile(); if (file) download(file, "reword-nerd-saved-copy.rn-workspace"); }}>Export saved copy</button>}
          {status.hasSaved && <button disabled={busy} onClick={() => setForget(true)}>Forget saved workspace</button>}</div>
        {pending && <div className="workspace-confirm"><p>Restore {pending.name}? This replaces the open workspace. Export your current workspace first if you want to keep both.</p><button disabled={busy} onClick={() => void action(async () => { await registry.importFile(pending); setPending(null); })}>Restore imported workspace</button><button disabled={busy} onClick={() => setPending(null)}>Cancel import</button></div>}
        {forget && <div className="workspace-confirm"><p>Remove both saved workspace copies from this storage location? Your open work and retained job records stay intact.</p><button disabled={busy} onClick={() => void action(async () => { await registry.forget(); setForget(false); })}>Remove saved copies</button><button disabled={busy} onClick={() => setForget(false)}>Keep saved copies</button></div>}
      </div></details></div>
    {status.error && <p role="alert" className="workspace-save-error">{status.error}</p>}
  </aside>;
}
