import { expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createService } from "../server.mjs";
import { encodeWorkspace, decodeWorkspace } from "../../src/workspace/codec";

it("protects workspace endpoints and recovers across companion ports without starting a host", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "reword-workspace-http-"))), dist = join(root, "dist"); await mkdir(dist); await writeFile(join(dist, "index.html"), "owned fixture");
  let calls = 0; const hostFactory = async () => { calls++; throw Error("No host call permitted"); };
  const first = await createService({ root, dist, hostFactory });
  const origin = new URL(first.url).origin;
  const metaResponse = await fetch(origin + "/api/workspace/meta"); if (metaResponse.status !== 200) await first.close(); expect(metaResponse.status).toBe(200);
  const meta = await metaResponse.json(); expect(meta.kind).toBe("reword-workspace-store");
  const file = await encodeWorkspace({ studio: { text: "Saved between ports.\r\n雪" } });
  const headers = { origin, "x-reword-session": meta.session, "x-reword-revision": String(meta.revision), "content-type": "application/x-reword-nerd-workspace" };
  expect((await fetch(origin + "/api/workspace/save", { method: "POST", headers: { ...headers, origin: "https://example.invalid" }, body: file })).status).toBe(400);
  expect((await fetch(origin + "/api/workspace/save", { method: "POST", headers: { ...headers, "x-reword-session": "0".repeat(64) }, body: file })).status).toBe(400);
  const saved = await fetch(origin + "/api/workspace/save", { method: "POST", headers, body: file }); expect(saved.status).toBe(200);
  await first.close();
  const restarted = await createService({ root, dist, hostFactory });
  try {
    const next = new URL(restarted.url).origin, m = await (await fetch(next + "/api/workspace/meta")).json();
    expect(m.hasFile).toBe(true); expect(m.enabled).toBe(true);
    expect(await decodeWorkspace(await (await fetch(next + "/api/workspace/file")).blob())).toEqual({ studio: { text: "Saved between ports.\r\n雪" } });
    await writeFile(join(root, "owned-claim.json"), "keep");
    const forgotten = await fetch(next + "/api/workspace/forget", { method: "POST", headers: { origin: next, "x-reword-session": m.session, "x-reword-revision": String(m.revision), "content-type": "application/json" }, body: "{}" });
    expect(forgotten.status).toBe(200); expect(await readFile(join(root, "owned-claim.json"), "utf8")).toBe("keep"); expect(calls).toBe(0);
  } finally { await restarted.close(); }
});
