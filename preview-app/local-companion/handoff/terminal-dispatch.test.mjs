import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { requestTerminalDispatch } from "./terminal-dispatch.mjs";
import { terminalExecArgs, terminalPolicy } from "./terminal-policy.mjs";
import { hash } from "./contract.mjs";
const root = resolve("output/studio/terminal-dispatch-tests");
await mkdir(root, { recursive: true });
async function fixture() {
  const dir = await mkdtemp(join(root, "case-"));
  const id = randomUUID();
  const work = join(dir, id);
  await mkdir(work);
  const files = {
    "prompt.txt": Buffer.from("Literal $& $$ $` $' 雪\n"),
    "reference.png": Buffer.from("owned input bytes"),
  };
  const snapshot = { id, sourceKind: "image", packageSha256: "a".repeat(64) };
  const verified = { dir: work, seal: "b".repeat(64), snapshot, files };
  return {
    root: dir,
    verified,
    expectedSeal: verified.seal,
    runner: resolve("local-companion/handoff/terminal-run.mjs"),
    enabled: true,
    openTerminal: async () => {},
    check: async () => ({
      executor: "OFFLINE FIXTURE",
      model: "fixture",
      effort: "medium",
    }),
  };
}
test("disabled and stale requests cannot claim or launch", async () => {
  const a = await fixture();
  await assert.rejects(
    requestTerminalDispatch({ ...a, enabled: false }),
    /unavailable/,
  );
  await assert.rejects(
    requestTerminalDispatch({ ...a, expectedSeal: "x" }),
    /Stale/,
  );
  await assert.rejects(
    readFile(join(a.root, "terminal-dispatch-claim.json")),
    /ENOENT/,
  );
});
test("one immutable intent precedes launch and preserves exact input hashes", async () => {
  const a = await fixture();
  let calls = 0;
  a.openTerminal = async () => {
    calls++;
    const i = JSON.parse(
      await readFile(join(a.root, "terminal-dispatch-claim.json")),
    );
    assert.equal(i.referenceSha256, hash(a.verified.files["reference.png"]));
    assert.equal(i.promptSha256, hash(a.verified.files["prompt.txt"]));
    assert.equal(i.acceptedByUser, false);
    assert.equal(i.actualModel, null);
  };
  await requestTerminalDispatch(a);
  await requestTerminalDispatch(a);
  assert.equal(calls, 1);
  const before = await readFile(join(a.root, "terminal-dispatch-claim.json"));
  await assert.rejects(
    requestTerminalDispatch({
      ...a,
      verified: {
        ...a.verified,
        snapshot: { ...a.verified.snapshot, id: randomUUID() },
      },
    }),
    /already claimed/,
  );
  assert.deepEqual(
    await readFile(join(a.root, "terminal-dispatch-claim.json")),
    before,
  );
});
test("uncertain OS startup remains claimed and does not retry", async () => {
  const a = await fixture();
  let calls = 0;
  a.openTerminal = async () => {
    calls++;
    throw Error("offline simulated lost ack");
  };
  await assert.rejects(requestTerminalDispatch(a), /uncertain/);
  assert.equal((await requestTerminalDispatch(a)).duplicate, true);
  assert.equal(calls, 1);
});
test("sign-in rejection makes zero launches", async () => {
  const a = await fixture();
  a.check = async () => {
    throw Error("ChatGPT sign-in unavailable");
  };
  a.openTerminal = async () => assert.fail("launch");
  await assert.rejects(requestTerminalDispatch(a), /sign-in/);
  await assert.rejects(
    readFile(join(a.root, "terminal-dispatch-claim.json")),
    /ENOENT/,
  );
});
test("ordinary arguments cannot select shell, URL or arbitrary executable; stdin is canonical data", () => {
  const d = "/owned/handoff";
  const a = terminalExecArgs(d);
  assert.equal(a[0], "exec");
  assert.equal(a.at(-1), "-");
  assert.equal(a.at(-2), "--");
  assert.equal(a[a.indexOf("--image") + 1], join(d, "reference.png"));
  assert(a.includes("--ignore-user-config"));
  assert(a.includes("--ignore-rules"));
  assert(!a.includes("--full-auto"));
  const p = terminalPolicy(d);
  assert(p.includes("features.code_mode_host=false"));
  assert(p.includes("features.shell_tool=false"));
  assert(p.includes("features.image_generation=true"));
  assert(
    p.includes(
      'features.code_mode={enabled=false,direct_only_tool_namespaces=["image_gen"]}',
    ),
  );
  assert(p.includes("permissions.reword_image.network.enabled=false"));
});
test("text source remains unavailable in this image-only launch policy", async () => {
  const a = await fixture();
  a.verified.snapshot.sourceKind = "text";
  await assert.rejects(requestTerminalDispatch(a), /image task only/);
});
