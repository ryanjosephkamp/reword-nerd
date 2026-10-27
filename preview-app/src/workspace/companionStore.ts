import { isLocalCompanionOrigin } from "../app/platform/localClient";
import { IndexedWorkspaceStore, emptySave, type WorkspaceStore } from "./store";
import { WORKSPACE_LIMITS } from "./codec";
const WORKSPACE_ENDPOINTS = Object.freeze({ meta: "/api/workspace/meta", file: "/api/workspace/file", previous: "/api/workspace/previous", save: "/api/workspace/save", enable: "/api/workspace/enable", forget: "/api/workspace/forget" });
type Action = keyof typeof WORKSPACE_ENDPOINTS;
interface Metadata { kind: "reword-workspace-store"; version: 1; session: string; revision: number; enabled: boolean; savedAt: string | null; hasFile: boolean; hasPrevious: boolean }
function validMeta(value: unknown): value is Metadata {
  const m = value as Metadata;
  return Boolean(m && m.kind === "reword-workspace-store" && m.version === 1 && /^[a-f0-9]{64}$/.test(m.session) && Number.isSafeInteger(m.revision) && m.revision >= 0 && typeof m.enabled === "boolean" && typeof m.hasFile === "boolean" && typeof m.hasPrevious === "boolean" && (m.savedAt === null || (typeof m.savedAt === "string" && Number.isFinite(Date.parse(m.savedAt)))));
}
async function request(action: Action, metadata?: Metadata, body?: Blob | string) {
  if (!isLocalCompanionOrigin(window.location) || !Object.hasOwn(WORKSPACE_ENDPOINTS, action)) throw Error("The companion's own local workspace UI is required.");
  const mutation = ["save", "enable", "forget"].includes(action);
  if (mutation && !validMeta(metadata)) throw Error("Invalid local workspace session.");
  if (body instanceof Blob && body.size > WORKSPACE_LIMITS.bytes) throw Error("Workspace save exceeds its byte limit.");
  return fetch(WORKSPACE_ENDPOINTS[action], { method: mutation ? "POST" : "GET", mode: "same-origin", credentials: "same-origin", redirect: "error", ...(action === "meta" ? { signal: AbortSignal.timeout(5000) } : {}), ...(mutation ? { headers: { "x-reword-session": metadata!.session, "x-reword-revision": String(metadata!.revision), "content-type": action === "save" ? "application/x-reword-nerd-workspace" : "application/json" }, body } : {}) });
}
async function checkedMetadata(response: Response) {
  const data: unknown = await response.json();
  if (!response.ok) throw Error((data as { error?: string }).error ?? "The local workspace request failed. Saved data is unchanged.");
  if (!validMeta(data)) throw Error("Unsupported local workspace storage response.");
  return data;
}
class CompanionWorkspaceStore implements WorkspaceStore {
  readonly label = "Companion-owned snapshots, available after a port change";
  private record = emptySave();
  constructor(private metadata: Metadata) {}
  async read() {
    this.metadata = await checkedMetadata(await request("meta"));
    const file = this.metadata.hasFile ? await this.file("file") : null, previous = this.metadata.hasPrevious ? await this.file("previous") : null;
    return this.record = { revision: this.metadata.revision, enabled: this.metadata.enabled, savedAt: this.metadata.savedAt, file, previous };
  }
  private async file(action: "file" | "previous") { const response = await request(action); if (!response.ok) throw Error("The saved companion workspace could not be read. Stored files are unchanged."); return response.blob(); }
  async save(file: Blob, expected: number) { if (expected !== this.metadata.revision) throw Error("The local workspace revision changed."); this.metadata = await checkedMetadata(await request("save", this.metadata, file)); return this.record = { revision: this.metadata.revision, enabled: true, savedAt: this.metadata.savedAt, file, previous: this.record.file ?? this.record.previous }; }
  async enable(enabled: boolean, expected: number) { if (expected !== this.metadata.revision) throw Error("The local workspace revision changed."); this.metadata = await checkedMetadata(await request("enable", this.metadata, JSON.stringify({ enabled }))); return this.record = { ...this.record, revision: this.metadata.revision, enabled }; }
  async forget(expected: number) { if (expected !== this.metadata.revision) throw Error("The local workspace revision changed."); this.metadata = await checkedMetadata(await request("forget", this.metadata, "{}")); return this.record = { ...emptySave(), revision: this.metadata.revision }; }
}
/** Only the current loopback page may select companion storage; static Pages never probes a daemon. */
export class DeviceWorkspaceStore implements WorkspaceStore {
  private selected: WorkspaceStore | null = null;
  private choosing: Promise<WorkspaceStore> | null = null;
  get label() { return this.selected?.label ?? "This browser on this device"; }
  private choose(): Promise<WorkspaceStore> {
    return this.choosing ??= (async () => {
      if (isLocalCompanionOrigin(window.location)) {
        let response: Response | undefined;
        try { response = await request("meta"); } catch { throw Error("Companion workspace storage is unavailable. Saved snapshots are unchanged; reconnect to this companion or export this tab before leaving."); }
        if (response && response.status !== 404 && response.headers.get("content-type")?.includes("application/json")) {
          const metadata = await checkedMetadata(response); return this.selected = new CompanionWorkspaceStore(metadata);
        }
      }
      return this.selected = new IndexedWorkspaceStore();
    })();
  }
  async read() { return (await this.choose()).read(); }
  async save(file: Blob, expected: number) { return (await this.choose()).save(file, expected); }
  async enable(enabled: boolean, expected: number) { return (await this.choose()).enable(enabled, expected); }
  async forget(expected: number) { return (await this.choose()).forget(expected); }
}
