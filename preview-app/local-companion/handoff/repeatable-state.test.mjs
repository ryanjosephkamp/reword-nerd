import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  writeFile,
  readFile,
  symlink,
  chmod,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  repeatableMode,
  repeatableStatus,
  verifyCurrentClaim,
  claimName,
} from "./repeatable-state.mjs";
import { requestTerminalDispatch } from "./terminal-dispatch.mjs";
import { hash, verifySnapshot } from "./contract.mjs";
const parent = resolve("output/studio/repeatable-handoff/offline-state-tests");
await mkdir(parent, { recursive: true });
async function state(budget = false) {
  const root = await mkdtemp(join(parent, "case-"));
  const mode = await repeatableMode(root, { enable: true, testBudget: budget });
  return { root, mode };
}
async function handoff(a, resendOf = null) {
  const id = randomUUID(),
    dir = join(a.root, id);
  await mkdir(dir);
  await mkdir(join(dir, "workspace"));
  const files = {
    "package.zip": Buffer.from("owned synthetic package contract substitute"),
    "reference.png": Buffer.from("owned synthetic reference substitute"),
    "prompt.txt": Buffer.from("literal $& $$ $` $' 雪\n<script>inert</script>"),
    "saved-profile.json": Buffer.from("{}"),
  };
  const snapshot = {
    kind: "reword-outbound-handoff",
    schemaVersion: 1,
    id,
    requestId: randomUUID(),
    resendOf,
    sourceKind: "image",
    target: "codex-cli",
    operation: "terminal-launch-review",
    packageSha256: hash(files["package.zip"]),
    referenceSha256: hash(files["reference.png"]),
    promptSha256: hash(files["prompt.txt"]),
    acceptedByUser: false,
    artifacts: Object.fromEntries(
      Object.entries(files).map(([k, b]) => [
        k,
        { sha256: hash(b), byteLength: b.length },
      ]),
    ),
  };
  const raw = Buffer.from(JSON.stringify(snapshot));
  for (const [name, bytes] of Object.entries(files))
    await writeFile(join(dir, name), bytes);
  await writeFile(join(dir, "snapshot.json"), raw);
  const verified = { snapshot, files, dir, seal: hash(raw) };
  return {
    root: a.root,
    verified,
    expectedSeal: verified.seal,
    runner: resolve("local-companion/handoff/terminal-run.mjs"),
    enabled: true,
    repeatable: true,
    check: async () => ({
      executor: "OFFLINE SUBSTITUTE",
      model: "fixture",
      effort: "medium",
    }),
    openTerminal: async () => {},
  };
}
async function completed(a, overrides = {}) {
  const dir = a.verified.dir,
    intent = JSON.parse(await readFile(join(dir, "dispatch-intent.json")));
  const taskId = randomUUID();
  const out = Buffer.from(
      [
        { type: "thread.started", thread_id: taskId },
        { type: "turn.started" },
        {
          type: "item.completed",
          item: { type: "agent_message", text: "OFFLINE FIXTURE" },
        },
        { type: "turn.completed" },
      ]
        .map((x) => JSON.stringify(x))
        .join("\n") + "\n",
    ),
    err = Buffer.alloc(0);
  const binding = {
    handoffId: intent.handoffId,
    snapshotSha256: intent.snapshotSha256,
    dispatchId: intent.id,
  };
  const input = Buffer.from(
    JSON.stringify({
      stdinSha256: intent.promptSha256,
      referenceSha256: intent.referenceSha256,
    }),
  );
  await writeFile(join(dir, "native-input.json"), input);
  await writeFile(
    join(dir, "native-start-claimed.json"),
    JSON.stringify({ kind: "reword-terminal-native-start", ...binding }),
  );
  await writeFile(join(dir, "native-stdout.jsonl"), out);
  await writeFile(join(dir, "native-stderr.txt"), err);
  await writeFile(
    join(dir, "task-outcome.json"),
    JSON.stringify({
      kind: "reword-terminal-task-outcome",
      ...binding,
      taskId,
      exit: { code: 0, signal: null },
      reason: null,
      taskCompleteEvent: true,
      failedEvent: false,
      taskDispatches: 1,
      acceptedByUser: false,
      automaticRetry: false,
      raw: {
        input: { sha256: hash(input), byteLength: input.length },
        stdout: { sha256: hash(out), byteLength: out.length },
        stderr: { sha256: hash(err), byteLength: err.length },
      },
      ...overrides,
    }),
  );
}
test("two sequential confirmed sends and explicit resend preserve earlier bytes and claim chain", async () => {
  const a = await state(),
    first = await handoff(a);
  let launches = 0;
  first.openTerminal = async () => {
    launches++;
  };
  const one = await requestTerminalDispatch(first);
  assert.equal(
    (await repeatableStatus(a.root, a.mode)).active,
    first.verified.snapshot.id,
  );
  const original = await readFile(join(a.root, claimName(1)));
  await completed(first);
  const second = await handoff(a, first.verified.snapshot.id);
  second.openTerminal = first.openTerminal;
  const two = await requestTerminalDispatch(second);
  assert.equal(two.intent.resendOf, one.intent.handoffId);
  assert.equal(two.intent.previousClaimSha256, hash(original));
  assert.equal(two.intent.sequence, 2);
  assert.equal(launches, 2);
  assert.deepEqual(await readFile(join(a.root, claimName(1))), original);
  await completed(second);
  assert.equal((await repeatableStatus(a.root, a.mode)).available, true);
  const reopened = await repeatableMode(a.root, { enable: true });
  assert.equal(reopened.id, a.mode.id);
  assert.equal((await repeatableStatus(a.root, reopened)).claims.length, 2);
});
test("simultaneous identical requests launch once; conflicting concurrent sends never launch twice", async () => {
  const a = await state(),
    first = await handoff(a);
  let calls = 0;
  first.openTerminal = async () => {
    calls++;
  };
  const results = await Promise.all([
    requestTerminalDispatch(first),
    requestTerminalDispatch(first),
  ]);
  assert.equal(calls, 1);
  assert.equal(results.filter((x) => x.duplicate).length, 1);
  await completed(first);
  const b = await handoff(a),
    c = await handoff(a);
  b.openTerminal = c.openTerminal = first.openTerminal;
  const race = await Promise.allSettled([
    requestTerminalDispatch(b),
    requestTerminalDispatch(c),
  ]);
  assert.equal(race.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(calls, 2);
});
test("lost launch acknowledgement remains claimed across restart and duplicate request", async () => {
  const a = await state(),
    b = await handoff(a);
  let calls = 0;
  b.openTerminal = async () => {
    calls++;
    throw Error("OFFLINE lost acknowledgement");
  };
  await assert.rejects(requestTerminalDispatch(b), /uncertain/);
  assert.equal((await requestTerminalDispatch(b)).duplicate, true);
  const c = await handoff(a);
  await repeatableMode(a.root, { enable: true });
  await assert.rejects(requestTerminalDispatch(c), /uncertain/);
  assert.equal(calls, 1);
});
test("agent test budget is durable and independent of repeatable completion or restart flags", async () => {
  const a = await state(true),
    b = await handoff(a);
  await requestTerminalDispatch(b);
  await completed(b);
  assert.equal((await repeatableStatus(a.root, a.mode)).budgetSpent, true);
  const restarted = await repeatableMode(a.root, {
    enable: true,
    testBudget: false,
  });
  assert.equal(restarted.agentTestBudget, 1);
  await assert.rejects(
    requestTerminalDispatch(await handoff(a)),
    /budget is spent/,
  );
  const raw = await readFile(join(a.root, claimName(1)));
  await verifyCurrentClaim(
    a.root,
    join(a.root, claimName(1)),
    JSON.parse(raw),
    raw,
  );
  await chmod(join(a.root, "agent-test-dispatch-claim.json"), 0o600);
  await writeFile(join(a.root, "agent-test-dispatch-claim.json"), "{}");
  await assert.rejects(
    verifyCurrentClaim(
      a.root,
      join(a.root, claimName(1)),
      JSON.parse(raw),
      raw,
    ),
    /budget binding/,
  );
});
test("legacy/spent states cannot become repeatable and v2 cannot use legacy launch", async () => {
  const root = await mkdtemp(join(parent, "legacy-"));
  await writeFile(join(root, "terminal-dispatch-claim.json"), "{}");
  assert.equal(await repeatableMode(root), null);
  await assert.rejects(repeatableMode(root, { enable: true }), /fresh empty/);
  const a = await state();
  await assert.rejects(
    requestTerminalDispatch({ ...(await handoff(a)), repeatable: false }),
    /legacy single-use/,
  );
});
for (const [label, override] of [
  ["wrong task", { taskId: randomUUID() }],
  ["wrong dispatch", { dispatchId: randomUUID() }],
  ["wrong snapshot", { snapshotSha256: "0".repeat(64) }],
  ["timeout", { reason: "owned-task-timeout" }],
  ["nonzero exit", { exit: { code: 1, signal: null } }],
  ["failed event", { failedEvent: true }],
]) {
  test(label + " never releases the active guard", async () => {
    const a = await state(),
      b = await handoff(a);
    await requestTerminalDispatch(b);
    await completed(b, override);
    assert.equal((await repeatableStatus(a.root, a.mode)).available, false);
    await assert.rejects(requestTerminalDispatch(await handoff(a)));
  });
}
test("partial raw logs, source mutation, and symlinked receipt fail closed", async () => {
  const a = await state(),
    b = await handoff(a);
  await requestTerminalDispatch(b);
  await completed(b);
  await writeFile(
    join(b.verified.dir, "native-stdout.jsonl"),
    '{"type":"thread.started"',
  );
  assert.equal((await repeatableStatus(a.root, a.mode)).available, false);
  await completed(b);
  await writeFile(join(b.verified.dir, "reference.png"), "changed");
  await assert.rejects(
    verifySnapshot(b.verified.dir, b.verified.seal),
    /changed/,
  );
  assert.equal((await repeatableStatus(a.root, a.mode)).available, false);
  const c = await state();
  await symlink(
    join(b.verified.dir, "dispatch-intent.json"),
    join(c.root, claimName(1)),
  );
  await assert.rejects(repeatableStatus(c.root, c.mode));
});
test("wrong/stale request and out-of-sequence native launch rejected", async () => {
  const a = await state(),
    b = await handoff(a);
  await assert.rejects(
    requestTerminalDispatch({ ...b, expectedSeal: "0".repeat(64) }),
    /Stale/,
  );
  await requestTerminalDispatch(b);
  const raw = await readFile(join(a.root, claimName(1)));
  await completed(b);
  const c = await handoff(a);
  await requestTerminalDispatch(c);
  await assert.rejects(
    verifyCurrentClaim(
      a.root,
      join(a.root, claimName(1)),
      JSON.parse(raw),
      raw,
    ),
    /Stale/,
  );
  const sameRequest = await handoff(a);
  sameRequest.verified.snapshot.requestId = b.verified.snapshot.requestId;
  await assert.rejects(requestTerminalDispatch(sameRequest), /Conflicting/);
});
