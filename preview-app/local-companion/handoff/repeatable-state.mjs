import { open, readdir, link } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import {
  bounded,
  hash,
  validId,
  safeDirectory,
  verifySnapshot,
  MAX_HANDOFFS,
} from "./contract.mjs";

const MODE = "terminal-mode.json";
const BUDGET = "agent-test-dispatch-claim.json";
const hex = (x) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
export const claimName = (sequence) =>
  `terminal-claim-${String(sequence).padStart(4, "0")}.json`;
export async function durableFile(path, bytes) {
  // Publish only a fully written inode, without replacing an existing final name.
  // Retain owned pending files as interruption evidence; there is no cleanup job.
  const pending = join(
    dirname(path),
    `.${basename(path)}.${randomUUID()}.pending`,
  );
  const f = await open(pending, "wx", 0o400);
  try {
    await f.writeFile(bytes);
    await f.sync();
  } finally {
    await f.close();
  }
  await link(pending, path);
  const d = await open(dirname(path), "r");
  try {
    await d.sync();
  } finally {
    await d.close();
  }
}
async function optional(path, max = 8192) {
  try {
    return await bounded(path, max);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
export async function repeatableMode(
  root,
  { enable = false, testBudget = false } = {},
) {
  await safeDirectory(root);
  let raw = await optional(join(root, MODE));
  if (!raw && enable) {
    if ((await readdir(root)).length)
      throw Error(
        "Repeatable mode requires a fresh empty handoff state; legacy states cannot be upgraded",
      );
    const mode = {
      kind: "reword-terminal-mode",
      schemaVersion: 2,
      id: randomUUID(),
      mode: "explicit-repeatable",
      createdAt: new Date().toISOString(),
      agentTestBudget: testBudget ? 1 : null,
    };
    raw = Buffer.from(JSON.stringify(mode, null, 2));
    await durableFile(join(root, MODE), raw);
  }
  if (!raw) {
    if (testBudget)
      throw Error("Agent test budget requires new repeatable mode");
    return null;
  }
  const m = JSON.parse(raw);
  if (
    m.kind !== "reword-terminal-mode" ||
    m.schemaVersion !== 2 ||
    !validId(m.id) ||
    m.mode !== "explicit-repeatable" ||
    ![null, 1].includes(m.agentTestBudget)
  )
    throw Error("Unsupported terminal state mode");
  if (testBudget && m.agentTestBudget !== 1)
    throw Error(
      "Cannot add a test budget to an existing unbudgeted state; use a fresh state",
    );
  if (await optional(join(root, "terminal-dispatch-claim.json")))
    throw Error("Repeatable and legacy claims cannot be mixed");
  return m;
}

export async function readClaims(root, mode) {
  const names = (await readdir(root))
    .filter((n) => n.startsWith("terminal-claim-"))
    .sort();
  if (names.length > MAX_HANDOFFS)
    throw Error("Terminal history exceeds bound");
  const claims = [];
  for (let i = 0; i < names.length; i++) {
    if (names[i] !== claimName(i + 1))
      throw Error("Invalid or interrupted terminal claim sequence");
    const raw = await bounded(join(root, names[i]), 8192),
      c = JSON.parse(raw);
    if (
      c.kind !== "reword-terminal-dispatch" ||
      c.schemaVersion !== 2 ||
      c.stateId !== mode.id ||
      c.sequence !== i + 1 ||
      !validId(c.id) ||
      !validId(c.handoffId) ||
      !validId(c.requestId) ||
      !hex(c.snapshotSha256) ||
      !hex(c.promptSha256) ||
      !hex(c.referenceSha256) ||
      !hex(c.packageSha256) ||
      c.operation !== "codex-cli-image-task" ||
      c.acceptedByUser !== false ||
      c.automaticRetry !== false ||
      c.previousClaimSha256 !== (claims.at(-1)?.sha256 ?? null) ||
      claims.some(
        (p) =>
          p.intent.handoffId === c.handoffId ||
          p.intent.requestId === c.requestId,
      )
    )
      throw Error("Invalid terminal claim binding");
    claims.push({
      intent: c,
      raw,
      sha256: hash(raw),
      path: join(root, names[i]),
    });
  }
  return claims;
}

// Only a bound clean native completion releases the append-only active-task guard.
// Missing/partial/error/timeout records remain uncertain; no PID or elapsed-time inference.
export async function completionEvidence(root, claim) {
  try {
    const c = claim.intent,
      dir = join(root, c.handoffId);
    const { snapshot: s } = await verifySnapshot(dir, c.snapshotSha256);
    if (
      s.id !== c.handoffId ||
      s.requestId !== c.requestId ||
      s.promptSha256 !== c.promptSha256 ||
      s.referenceSha256 !== c.referenceSha256 ||
      s.packageSha256 !== c.packageSha256
    )
      throw Error("Dispatch/source binding mismatch");
    if (
      !claim.raw.equals(await bounded(join(dir, "dispatch-intent.json"), 8192))
    )
      throw Error("Dispatch receipt differs from claim");
    const start = JSON.parse(
      await bounded(join(dir, "native-start-claimed.json"), 8192),
    );
    const o = JSON.parse(await bounded(join(dir, "task-outcome.json"), 32768));
    for (const r of [start, o])
      if (
        r.dispatchId !== c.id ||
        r.handoffId !== c.handoffId ||
        r.snapshotSha256 !== c.snapshotSha256
      )
        throw Error("Completion identity mismatch");
    if (
      o.kind !== "reword-terminal-task-outcome" ||
      start.kind !== "reword-terminal-native-start" ||
      o.exit?.code !== 0 ||
      o.exit?.signal !== null ||
      o.reason !== null ||
      !o.taskCompleteEvent ||
      o.failedEvent ||
      o.taskDispatches !== 1 ||
      o.acceptedByUser !== false ||
      o.automaticRetry !== false ||
      !/^[0-9a-f-]{36}$/.test(o.taskId ?? "")
    )
      throw Error("Task has no definitive clean completion");
    const out = await bounded(
        join(dir, "native-stdout.jsonl"),
        40 * 1024 * 1024,
      ),
      err = await bounded(join(dir, "native-stderr.txt"), 40 * 1024 * 1024);
    const input = await bounded(join(dir, "native-input.json"), 32768),
      inputData = JSON.parse(input);
    if (
      o.raw?.input?.sha256 !== hash(input) ||
      o.raw.input.byteLength !== input.length ||
      inputData.stdinSha256 !== c.promptSha256 ||
      inputData.referenceSha256 !== c.referenceSha256
    )
      throw Error("Native input custody mismatch");
    for (const [bytes, info] of [
      [out, o.raw?.stdout],
      [err, o.raw?.stderr],
    ])
      if (info?.sha256 !== hash(bytes) || info?.byteLength !== bytes.length)
        throw Error("Completion raw-log custody mismatch");
    const events = out
      .toString("utf8")
      .split("\n")
      .filter((x) => x.trim())
      .map((x) => JSON.parse(x));
    const starts = events.filter((x) => x.type === "thread.started");
    if (
      starts.length !== 1 ||
      starts[0].thread_id !== o.taskId ||
      events.filter((x) => x.type === "turn.started").length !== 1 ||
      events.filter((x) => x.type === "turn.completed").length !== 1 ||
      events.at(-1)?.type !== "turn.completed" ||
      events.some((x) => ["turn.failed", "error"].includes(x.type))
    )
      throw Error("Native event sequence does not establish completion");
    return {
      complete: true,
      taskId: o.taskId,
      outcomeSha256: hash(await bounded(join(dir, "task-outcome.json"), 32768)),
    };
  } catch (e) {
    return {
      complete: false,
      reason:
        e.code === "ENOENT"
          ? "Task may be active or startup is uncertain; retained claim blocks another send"
          : e.message,
    };
  }
}
export async function repeatableStatus(root, mode) {
  const claims = await readClaims(root, mode),
    last = claims.at(-1);
  const evidence = last
    ? await completionEvidence(root, last)
    : { complete: true };
  const budgetClaim = await optional(join(root, BUDGET));
  // A reserved sequence consumes the agent budget even if its later budget write was interrupted.
  const budgetSpent =
    mode.agentTestBudget === 1 && (claims.length > 0 || Boolean(budgetClaim));
  return {
    claims,
    active: evidence.complete ? null : last.intent.handoffId,
    evidence,
    budgetSpent,
    available:
      evidence.complete && !budgetSpent && claims.length < MAX_HANDOFFS,
  };
}
export async function claimRepeatable(root, verified, intent) {
  const mode = await repeatableMode(root);
  if (!mode) throw Error("Repeatable state is not initialized");
  const state = await repeatableStatus(root, mode);
  const existing = state.claims.find(
    (c) =>
      c.intent.handoffId === verified.snapshot.id ||
      c.intent.requestId === verified.snapshot.requestId,
  );
  if (existing) {
    if (
      existing.intent.handoffId !== verified.snapshot.id ||
      existing.intent.requestId !== verified.snapshot.requestId ||
      existing.intent.snapshotSha256 !== verified.seal
    )
      throw Error("Conflicting dispatch request identity");
    return { duplicate: true, intent: existing.intent };
  }
  if (!state.available)
    throw Error(
      state.budgetSpent
        ? "The one-task agent-test budget is spent; no second task"
        : (state.evidence.reason ?? "Terminal handoff history is full"),
    );
  const c = {
    ...intent,
    schemaVersion: 2,
    stateId: mode.id,
    sequence: state.claims.length + 1,
    requestId: verified.snapshot.requestId,
    resendOf: verified.snapshot.resendOf ?? null,
    previousClaimSha256: state.claims.at(-1)?.sha256 ?? null,
  };
  const raw = Buffer.from(JSON.stringify(c, null, 2)),
    path = join(root, claimName(c.sequence));
  try {
    await durableFile(path, raw);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const winner = JSON.parse(await bounded(path, 8192));
    if (
      winner.handoffId === c.handoffId &&
      winner.snapshotSha256 === c.snapshotSha256 &&
      winner.requestId === c.requestId
    )
      return { duplicate: true, intent: winner };
    throw Error(
      "Another confirmed task claimed this state; no concurrent send",
      { cause: e },
    );
  }
  if (mode.agentTestBudget === 1)
    await durableFile(
      join(root, BUDGET),
      JSON.stringify(
        {
          kind: "reword-agent-test-dispatch-budget",
          schemaVersion: 1,
          stateId: mode.id,
          dispatchId: c.id,
          claimSha256: hash(raw),
          maxTaskDispatches: 1,
        },
        null,
        2,
      ),
    );
  return { duplicate: false, intent: c, raw, path };
}
export async function verifyCurrentClaim(root, path, intent, raw) {
  const mode = await repeatableMode(root);
  if (
    !mode ||
    intent.stateId !== mode.id ||
    path !== join(root, claimName(intent.sequence))
  )
    throw Error("Wrong repeatable dispatch claim location");
  const claims = await readClaims(root, mode),
    current = claims.at(-1);
  if (!current || !current.raw.equals(raw))
    throw Error("Stale native dispatch claim");
  if (mode.agentTestBudget === 1) {
    const b = JSON.parse(await bounded(join(root, BUDGET), 8192));
    if (
      b.kind !== "reword-agent-test-dispatch-budget" ||
      b.stateId !== mode.id ||
      b.dispatchId !== intent.id ||
      b.claimSha256 !== hash(raw) ||
      b.maxTaskDispatches !== 1
    )
      throw Error("Agent-test budget binding mismatch");
  }
}
