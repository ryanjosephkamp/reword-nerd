// Saving the workspace on this device (IndexedDB, opt-in) and as a portable file.
// The browser can store Blobs directly, so a save is one structured-clone write.
import { isWorkspacePart, makeZip, readZip } from "../engine/handoff/zip";
import { EMPTY_WORKSPACE, type WorkspaceData } from "./store";

const DB_NAME = "reword-nerd";
const STORE = "workspace";
const KEY = "current";
const REMEMBER_KEY = "reword-nerd:remember";
const FORMAT_VERSION = 1;

interface SavedRecord {
  version: number;
  savedAt: number;
  data: WorkspaceData;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? request.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("The save was cancelled."));
    });
  } finally {
    db.close();
  }
}

export function rememberEnabled(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) === "on";
  } catch {
    return false;
  }
}

export function setRememberEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(REMEMBER_KEY, "on");
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    // Private windows can refuse storage; the panel shows that saving isn't available.
  }
}

export async function saveOnDevice(data: WorkspaceData): Promise<number> {
  const savedAt = Date.now();
  const record: SavedRecord = { version: FORMAT_VERSION, savedAt, data };
  await withStore("readwrite", (store) => store.put(record, KEY));
  return savedAt;
}

export async function loadFromDevice(): Promise<{ data: WorkspaceData; savedAt: number } | null> {
  const record = await withStore<SavedRecord | undefined>("readonly", (store) => store.get(KEY));
  if (!record || record.version !== FORMAT_VERSION) return null;
  return { data: { ...EMPTY_WORKSPACE, ...record.data }, savedAt: record.savedAt };
}

export async function forgetOnDevice(): Promise<void> {
  await withStore("readwrite", (store) => store.delete(KEY));
}

/** Explains a failed save in words a person can act on. */
export function describeSaveError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "QuotaExceededError") {
    return "This browser is out of room for saved work. Export your workspace to keep it.";
  }
  return "This browser didn't allow saving. Export your workspace to keep it.";
}

// Portable files: workspace.json plus every Blob as its own entry, referenced by id.

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

async function toPortable(data: WorkspaceData) {
  const blobs: { path: string; data: Blob }[] = [];
  const encode = (value: unknown): Json => {
    if (value instanceof Blob) {
      const path = `files/${blobs.length}`;
      blobs.push({ path, data: value });
      return { $blob: path, type: value.type };
    }
    if (Array.isArray(value)) return value.map(encode);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
    }
    return value as Json;
  };
  return { json: encode(data), blobs };
}

export async function exportWorkspace(data: WorkspaceData): Promise<Blob> {
  const { json, blobs } = await toPortable(data);
  return makeZip([
    {
      path: "workspace.json",
      data: JSON.stringify({ app: "reword_nerd", version: FORMAT_VERSION, workspace: json }),
    },
    ...blobs,
  ]);
}

export async function importWorkspace(file: Blob): Promise<WorkspaceData> {
  const entries = await readZip(file, { want: isWorkspacePart });
  const index = entries.find((entry) => entry.path === "workspace.json");
  if (!index) throw new Error("This file isn't a reword_nerd workspace.");
  const parsed = JSON.parse(await index.data.text()) as {
    app?: string;
    version?: number;
    workspace?: Json;
  };
  if (parsed.app !== "reword_nerd" || parsed.version !== FORMAT_VERSION || !parsed.workspace) {
    throw new Error("This workspace file is from a different version of reword_nerd.");
  }
  const files = new Map(entries.map((entry) => [entry.path, entry.data]));
  const decode = (value: Json): unknown => {
    if (Array.isArray(value)) return value.map(decode);
    if (value && typeof value === "object") {
      if (typeof value.$blob === "string") {
        const blob = files.get(value.$blob);
        if (!blob) throw new Error("This workspace file is incomplete.");
        return new Blob([blob], { type: typeof value.type === "string" ? value.type : "" });
      }
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]));
    }
    return value;
  };
  return { ...EMPTY_WORKSPACE, ...(decode(parsed.workspace) as WorkspaceData) };
}
