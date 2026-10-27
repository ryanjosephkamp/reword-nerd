import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkspaceStore } from "../workspace-store.mjs";
import { encodeWorkspace, decodeWorkspace } from "../../src/workspace/codec";

async function setup() { const root = await mkdtemp(join(tmpdir(), "reword-workspace-")); return { root, store: await createWorkspaceStore(root, { validate: decodeWorkspace }) }; }
describe("companion workspace snapshots", () => {
  it("restores a confirmed snapshot after restart without touching dispatch records", async () => {
    const { root, store } = await setup(); const file = await encodeWorkspace({ studio: { text: "Exact\r\n雪" } });
    await writeFile(join(root, "dispatch-claim.json"), "preserved");
    const first = await store.save(file, 0); expect(first.revision).toBe(1);
    const restarted = await createWorkspaceStore(root, { validate: decodeWorkspace });
    const saved = await restarted.read(); expect(await decodeWorkspace(saved.file!)).toEqual({ studio: { text: "Exact\r\n雪" } });
    await restarted.forget(saved.revision);
    expect(await readFile(join(root, "dispatch-claim.json"), "utf8")).toBe("preserved");
    expect((await restarted.read()).file).toBeNull();
  });
  it("rejects stale revisions and keeps the prior exact saved copy", async () => {
    const { store } = await setup(); const first = await encodeWorkspace({ studio: { text: "one" } }), second = await encodeWorkspace({ studio: { text: "two" } });
    await store.save(first, 0);
    await expect(store.save(second, 0)).rejects.toThrow(/another|revision|changed/i);
    await store.save(second, 1);
    const saved = await store.read(); expect(await decodeWorkspace(saved.previous!)).toEqual({ studio: { text: "one" } });
    expect(await decodeWorkspace(saved.file!)).toEqual({ studio: { text: "two" } });
  });
  it("rejects corrupt input and links without overwriting a good snapshot", async () => {
    const { root, store } = await setup(); const first = await encodeWorkspace({ studio: { text: "keep" } }); await store.save(first, 0);
    await expect(store.save(new Blob(["corrupt"]), 1)).rejects.toThrow();
    expect(await decodeWorkspace((await store.read()).file!)).toEqual({ studio: { text: "keep" } });
    await symlink(join(root, "dispatch-claim.json"), join(root, "workspace-1.rn-workspace"));
    await expect(store.save(first, 1)).rejects.toThrow(/unsafe|link/i);
    expect(await decodeWorkspace((await store.read()).file!)).toEqual({ studio: { text: "keep" } });
  });
});
