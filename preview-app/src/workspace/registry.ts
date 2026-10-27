import { decodeWorkspace, encodeWorkspace } from "./codec";
import { normalizeRestoredSection, validateWorkspaceBytes } from "./recovery";
import type { SavedWorkspace, WorkspaceStore } from "./store";
import { emptySave } from "./store";
export interface Section { binding: string | null; value: unknown }
export interface WorkspaceStatus { ready: boolean; enabled: boolean; dirty: boolean; saving: boolean; savedAt: string | null; error: string; notice: string; generation: number; hasSaved: boolean; hasPrevious: boolean; location: string }

export class WorkspaceRegistry {
  sections: Record<string, Section> = {};
  private listeners = new Set<() => void>();
  private record: SavedWorkspace = emptySave();
  private version = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flight: Promise<void> | null = null;
  private initialization: Promise<void> | undefined;
  status: WorkspaceStatus = { ready: false, enabled: false, dirty: false, saving: false, savedAt: null, error: "", notice: "Session only. Remember this workspace or export it to keep your work.", generation: 0, hasSaved: false, hasPrevious: false, location: "" };
  constructor(private store: WorkspaceStore) {}
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getStatus = () => this.status;
  private update(patch: Partial<WorkspaceStatus>) { this.status = { ...this.status, ...patch }; for (const listener of this.listeners) listener(); }
  fail = (error: unknown) => { clearTimeout(this.timer); this.update({ enabled: false, saving: false, error: error instanceof Error ? error.message : "Workspace recovery failed. Export this tab; saved data is unchanged." }); };
  initialize() {
    return this.initialization ??= (async () => {
      try {
        this.record = await this.store.read();
        if (this.record.enabled && this.record.file) await this.decode(this.record.file);
        this.update({ ready: true, enabled: this.record.enabled, savedAt: this.record.savedAt, hasSaved: Boolean(this.record.file), hasPrevious: Boolean(this.record.previous), location: this.store.label, notice: this.record.enabled && this.record.file ? "Recovered the last confirmed save. No jobs were started." : this.record.file ? "A saved workspace is available. Load it or keep working in this tab." : this.status.notice });
      } catch (error) { this.fail(error); this.update({ ready: true, location: this.store.label, hasSaved: Boolean(this.record.file), hasPrevious: Boolean(this.record.previous) }); }
    })();
  }
  private async decode(file: Blob) {
    const sections = await decodeWorkspace(file); await validateWorkspaceBytes(sections);
    const checked: Record<string, Section> = {};
    for (const [key, raw] of Object.entries(sections)) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).sort().join(",") !== "binding,value") throw Error("Unsupported workspace section schema. Saved data is unchanged.");
      const entry = raw as Section;
      if (entry.binding !== null && typeof entry.binding !== "string") throw Error("Invalid saved workspace binding.");
      checked[key] = { binding: entry.binding, value: normalizeRestoredSection(key, entry.value) };
    }
    this.sections = checked;
  }
  read<T>(key: string, initial: () => T, binding: string | null = null, restore?: (value: unknown) => T): T {
    const entry = this.sections[key];
    if (entry && entry.binding === binding) {
      try {
        const value = restore ? restore(entry.value) : entry.value as T;
        this.sections[key] = { binding, value }; return value;
      } catch (error) { this.fail(error); }
    }
    const value = initial(); this.sections[key] = { binding, value }; return value;
  }
  capture(key: string, value: unknown, binding: string | null = null) {
    const prior = this.sections[key]; if (prior?.binding === binding && Object.is(prior.value, value)) return;
    this.sections[key] = { binding, value };
    if ((key === "images" || key === "workbench") && value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) {
      const items = (value as { items: { id: string }[] }).items;
      const ids = new Set(items.map(item => item.id));
      for (const savedKey of Object.keys(this.sections)) {
        const prefix = key === "images" ? "images:ocrDraft:" : savedKey.startsWith("workbench:projectDraft:") ? "workbench:projectDraft:" : "workbench:ocrDraft:";
        if (savedKey.startsWith(prefix) && !ids.has(savedKey.slice(prefix.length).split(":")[0])) delete this.sections[savedKey];
      }
    }
    if (key === "review:entries" && Array.isArray(value)) {
      const ids = new Set(value.map(entry => (entry as { review: { registration: { registrationId: string } } }).review.registration.registrationId));
      for (const savedKey of Object.keys(this.sections)) if (savedKey.startsWith("review:") && savedKey !== key && !ids.has(savedKey.split(":")[1])) delete this.sections[savedKey];
    }
    this.version += 1;
    this.update({ dirty: true }); this.schedule();
  }
  private schedule() { clearTimeout(this.timer); if (this.status.enabled && !this.status.error) this.timer = setTimeout(() => { void this.flush(); }, 700); }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (!this.status.enabled || !this.status.dirty || this.status.error) return;
    if (this.flight) return this.flight;
    const version = this.version, sections = { ...this.sections };
    this.update({ saving: true });
    this.flight = (async () => {
      try {
        const file = await encodeWorkspace(sections);
        this.record = await this.store.save(file, this.record.revision);
        this.update({ saving: false, savedAt: this.record.savedAt, dirty: this.version !== version, hasSaved: true, hasPrevious: Boolean(this.record.previous), notice: "Saved locally. Recovery does not start jobs." });
      } catch (error) { this.fail(error); }
      finally { this.flight = null; if (this.status.dirty) this.schedule(); }
    })();
    return this.flight;
  }
  async setEnabled(enabled: boolean) {
    clearTimeout(this.timer); if (!enabled) this.update({ enabled: false });
    try {
      await this.flight;
      this.record = await this.store.enable(enabled, this.record.revision);
      this.update({ enabled, error: "", dirty: enabled ? true : this.status.dirty, notice: enabled ? "Autosave is enabled on this device." : "Autosave is paused. The last saved copy is retained." });
      if (enabled) { this.version += 1; await this.flush(); } else clearTimeout(this.timer);
    } catch (error) { this.fail(error); }
  }
  async loadSaved(previous = false) {
    clearTimeout(this.timer); this.update({ enabled: false });
    try {
      await this.flight; const record = await this.store.read();
      const file = previous ? record.previous : record.file;
      if (!file) throw Error("No saved workspace copy is available.");
      await this.decode(file); this.record = record; this.version += 1;
      this.update({ generation: this.status.generation + 1, enabled: previous ? false : record.enabled, dirty: false, saving: false, savedAt: record.savedAt, error: "", notice: previous ? "Recovered the previous copy. Autosave is paused; export it or enable autosave explicitly." : "Loaded the latest saved workspace. No jobs were started." });
    } catch (error) { this.fail(error); }
  }
  async importFile(file: Blob) {
    const enabled = this.status.enabled; clearTimeout(this.timer); this.update({ enabled: false });
    try { await this.flight; await this.decode(file); this.version += 1; this.update({ generation: this.status.generation + 1, enabled, dirty: true, error: "", notice: "Workspace imported locally. No jobs were started." }); this.schedule(); }
    catch (error) { this.fail(error); }
  }
  exportFile() { return encodeWorkspace({ ...this.sections }); }
  savedFile() { return this.record.file; }
  async forget() {
    clearTimeout(this.timer); this.update({ enabled: false });
    try { clearTimeout(this.timer); await this.flight; this.record = await this.store.forget(this.record.revision); this.update({ enabled: false, dirty: true, savedAt: null, hasSaved: false, hasPrevious: false, error: "", notice: "Saved workspace copies removed. Your open workspace remains in this tab; export it if needed. Job records and dispatch claims are unchanged." }); }
    catch (error) { this.fail(error); }
  }
  dispose() { clearTimeout(this.timer); }
}
