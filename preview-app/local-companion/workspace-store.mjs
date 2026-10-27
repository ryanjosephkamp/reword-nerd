import { mkdir, lstat, open, readFile, rename, unlink, rmdir } from "node:fs/promises";
import { join, resolve } from "node:path";
const MAX_BYTES = 512 * 1024 * 1024;
const empty = () => ({ revision: 0, enabled: false, slot: null, previousSlot: null, savedAt: null });
const conflict = "Another tab or window changed the saved workspace. Autosave is paused. Export this tab or load the latest saved copy before continuing.";
async function regular(path, max) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max) throw Error("Unsafe workspace file or size limit.");
  return readFile(path);
}
async function destination(path) {
  try { const stat = await lstat(path); if (stat.isSymbolicLink() || !stat.isFile()) throw Error("Unsafe workspace link or destination."); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
async function atomic(path, bytes) {
  await destination(path); let owned = false;
  try {
    const file = await open(path + ".next", "wx", 0o600); owned = true;
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await destination(path); await rename(path + ".next", path); owned = false;
    const parent = await open(resolve(path, ".."), "r"); try { await parent.sync(); } finally { await parent.close(); }
  } finally { if (owned) await unlink(path + ".next").catch(() => {}); }
}
/** Fixed-purpose storage. Dispatch claims and job files have a separate lifecycle. */
export async function createWorkspaceStore(root, { validate } = {}) {
  root = resolve(root); await mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await lstat(root); if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("Unsafe workspace storage directory.");
  const metaPath = join(root, "workspace.json"), slotPath = slot => join(root, `workspace-${slot}.rn-workspace`);
  async function metadata() {
    let m;
    try { m = JSON.parse((await regular(metaPath, 4096)).toString()); }
    catch (error) { if (error.code === "ENOENT") return empty(); throw error; }
    if (!m || Object.keys(m).sort().join(",") !== "enabled,previousSlot,revision,savedAt,slot" || !Number.isSafeInteger(m.revision) || m.revision < 0 || typeof m.enabled !== "boolean" || ![null, 0, 1].includes(m.slot) || ![null, 0, 1].includes(m.previousSlot) || (m.savedAt !== null && (typeof m.savedAt !== "string" || !Number.isFinite(Date.parse(m.savedAt))))) throw Error("Invalid workspace metadata. Saved files are unchanged.");
    return m;
  }
  async function file(slot) { return slot === null ? null : new Blob([await regular(slotPath(slot), MAX_BYTES)], { type: "application/x-reword-nerd-workspace" }); }
  async function read() { const m = await metadata(); return { revision: m.revision, enabled: m.enabled, savedAt: m.savedAt, file: await file(m.slot), previous: await file(m.previousSlot) }; }
  async function change(expected, transform, after = async () => {}) {
    if (!Number.isSafeInteger(expected) || expected < 0) throw Error("Invalid workspace revision.");
    const guard = join(root, "workspace-write-lock");
    try { await mkdir(guard, { mode: 0o700 }); } catch (error) { if (error.code === "EEXIST") throw Error("A workspace write is active or interrupted. Saved data is preserved; inspect the workspace lock before another save.", { cause: error }); throw error; }
    try {
      const old = await metadata(); if (old.revision !== expected) throw Error(conflict);
      const next = await transform(old); await atomic(metaPath, JSON.stringify(next)); await after(); return read();
    } finally { await rmdir(guard); }
  }
  return {
    label: "Companion-owned workspace snapshots (independent of the browser port)",
    metadata, file, read,
    async save(blob, expected) {
      if (!(blob instanceof Blob) || blob.size > MAX_BYTES || !validate) throw Error("Invalid or oversized workspace snapshot.");
      await validate(blob);
      return change(expected, async old => {
        const slot = old.slot === 0 ? 1 : 0;
        await atomic(slotPath(slot), Buffer.from(await blob.arrayBuffer()));
        return { revision: old.revision + 1, enabled: true, slot, previousSlot: old.slot, savedAt: new Date().toISOString() };
      });
    },
    enable(enabled, expected) { if (typeof enabled !== "boolean") throw Error("Invalid workspace preference."); return change(expected, old => ({ ...old, revision: old.revision + 1, enabled })); },
    forget(expected) {
      return change(expected, old => ({ ...empty(), revision: old.revision + 1 }), async () => {
        for (const slot of [0, 1]) { const path = slotPath(slot); await destination(path); await unlink(path).catch(error => { if (error.code !== "ENOENT") throw error; }); }
      });
    },
  };
}
