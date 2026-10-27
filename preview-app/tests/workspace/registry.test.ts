// @vitest-environment node
import { expect, it } from "vitest";
import { WorkspaceRegistry } from "../../src/workspace/registry";
import { encodeWorkspace, decodeWorkspace } from "../../src/workspace/codec";
import { emptySave, conflictMessage, type SavedWorkspace, type WorkspaceStore } from "../../src/workspace/store";
class SharedStore implements WorkspaceStore {
  label = "owned fixture";
  record: SavedWorkspace = emptySave();
  fail = false;
  async read() { return this.record; }
  async save(file: Blob, expected: number) {
    if (this.fail) throw Error("Storage quota exceeded; previous save unchanged.");
    if (expected !== this.record.revision) throw Error(conflictMessage);
    return this.record = { revision: expected + 1, file, previous: this.record.file, enabled: true, savedAt: "2026-10-27T12:00:00Z" };
  }
  async enable(enabled: boolean, expected: number) { if (expected !== this.record.revision) throw Error(conflictMessage); return this.record = { ...this.record, revision: expected + 1, enabled }; }
  async forget(expected: number) { if (expected !== this.record.revision) throw Error(conflictMessage); return this.record = { ...emptySave(), revision: expected + 1 }; }
}
async function setup() { const store = new SharedStore(); store.record = { ...emptySave(), revision: 1, enabled: true, file: await encodeWorkspace({ "studio:draft": { binding: null, value: "old" } }) }; const registry = new WorkspaceRegistry(store); await registry.initialize(); return { registry, store }; }
it("pauses immediately while an earlier save is still finishing", async () => {
  const { registry, store } = await setup(); const save = store.save.bind(store); let release!: () => void;
  store.save = async (file, expected) => { await new Promise<void>(resolve => { release = resolve; }); return save(file, expected); };
  registry.capture("studio:draft", "edited"); const saving = registry.flush();
  await new Promise(resolve => setTimeout(resolve, 5));
  const pausing = registry.setEnabled(false);
  expect(registry.status.enabled).toBe(false);
  release(); await saving; await pausing; registry.dispose();
});
it("keeps another tab's confirmed revision and preserves the losing tab for export", async () => {
  const { registry: first, store } = await setup(); const second = new WorkspaceRegistry(store); await second.initialize();
  first.capture("studio:draft", "first tab"); await first.flush();
  second.capture("studio:draft", "second tab"); await second.flush();
  expect(second.status.error).toContain("Another tab"); expect(second.status.enabled).toBe(false);
  expect(await decodeWorkspace(store.record.file!)).toMatchObject({ "studio:draft": { value: "first tab" } });
  expect(await decodeWorkspace(await second.exportFile())).toMatchObject({ "studio:draft": { value: "second tab" } });
  first.dispose(); second.dispose();
});
it("leaves the confirmed copy intact on a quota failure and retains current edits", async () => {
  const { registry, store } = await setup(), before = store.record.file;
  store.fail = true; registry.capture("studio:draft", "unsaved latest"); await registry.flush();
  expect(store.record.file).toBe(before); expect(registry.status.error).toContain("quota");
  expect(await decodeWorkspace(await registry.exportFile())).toMatchObject({ "studio:draft": { value: "unsaved latest" } }); registry.dispose();
});
