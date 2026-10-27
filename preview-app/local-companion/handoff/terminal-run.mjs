import { verifyCurrentClaim, durableFile } from "./repeatable-state.mjs";
import { superviseNative } from "./terminal-supervision.mjs";
// Fixed terminal entry. Never accepts an executable, URL, shell command or task prompt from argv.
import { spawn } from "node:child_process";
import { open, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectReview } from "./review-launch.mjs";
import { bounded, hash, promptText, safeDirectory } from "./contract.mjs";
import { terminalExecArgs } from "./terminal-policy.mjs";
import {
  NATIVE_CODEX,
  checkTerminalRuntime,
  terminalEnv,
} from "./terminal-dispatch.mjs";
export async function runTerminal(dir, seal, claimPath) {
  dir = await safeDirectory(dir);
  const v = await inspectReview(dir, seal);
  const raw = await bounded(claimPath, 8192),
    intent = JSON.parse(raw);
  if (
    !raw.equals(await bounded(join(dir, "dispatch-intent.json"), 8192)) ||
    intent.kind !== "reword-terminal-dispatch" ||
    intent.handoffId !== v.snapshot.id ||
    intent.snapshotSha256 !== seal ||
    intent.promptSha256 !== hash(v.files["prompt.txt"]) ||
    intent.referenceSha256 !== hash(v.files["reference.png"]) ||
    intent.packageSha256 !== v.snapshot.packageSha256
  )
    throw Error("Dispatch intent binding mismatch");
  if (intent.schemaVersion === 2)
    await verifyCurrentClaim(dirname(dir), resolve(claimPath), intent, raw);
  else if (
    intent.schemaVersion !== 1 ||
    resolve(claimPath) !== join(dirname(dir), "terminal-dispatch-claim.json")
  )
    throw Error("Wrong dispatch claim location");
  const runtime = await checkTerminalRuntime();
  const start = {
    kind: "reword-terminal-native-start",
    handoffId: v.snapshot.id,
    snapshotSha256: seal,
    dispatchId: intent.id,
    startedAt: new Date().toISOString(),
    executor: runtime.executor,
    requestedModel: runtime.model,
    requestedEffort: runtime.effort,
    acceptedByUser: false,
  };
  await durableFile(
    join(dir, "native-start-claimed.json"),
    JSON.stringify(start, null, 2),
  );
  const args = terminalExecArgs(dir, {
    model: runtime.model,
    overrides: [
      'model_provider="openai"',
      'forced_login_method="chatgpt"',
      "analytics.enabled=false",
      "feedback.enabled=false",
    ],
  }).filter((x) => x !== "--ephemeral");
  await writeFile(
    join(dir, "native-input.json"),
    JSON.stringify(
      {
        args,
        executable: NATIVE_CODEX,
        stdinSha256: intent.promptSha256,
        referenceSha256: intent.referenceSha256,
        binarySha256: runtime.binarySha256,
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o400 },
  );
  const stdout = await open(join(dir, "native-stdout.jsonl"), "wx", 0o600),
    stderr = await open(join(dir, "native-stderr.txt"), "wx", 0o600);
  console.log(
    "\nREWORD NERD · CODEX CLI TASK\nOne task dispatch. Codex owns execution and review. No internal operation or cost cap. No automatic retry.\n",
  );
  console.log(
    "Frozen handoff: " +
      v.snapshot.id +
      "\nPrompt SHA-256: " +
      intent.promptSha256 +
      "\nReference SHA-256: " +
      intent.referenceSha256 +
      "\n",
  );
  const child = spawn(NATIVE_CODEX, args, {
    cwd: join(dir, "workspace"),
    env: terminalEnv(),
    stdio: ["pipe", stdout.fd, stderr.fd],
    detached: true,
  });
  const { reason, exit } = await superviseNative(child, {
    stdout,
    stderr,
    prompt: promptText(v.files["prompt.txt"]),
  });
  await stdout.sync();
  await stderr.sync();
  await stdout.close();
  await stderr.close();
  const out = await bounded(join(dir, "native-stdout.jsonl"), 40 * 1024 * 1024),
    err = await bounded(join(dir, "native-stderr.txt"), 40 * 1024 * 1024);
  const events = out
    .toString("utf8")
    .split("\n")
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  const thread = events.find((x) => x.type === "thread.started");
  const inputBytes = await bounded(join(dir, "native-input.json"), 32768);
  const result = {
    kind: "reword-terminal-task-outcome",
    handoffId: v.snapshot.id,
    snapshotSha256: seal,
    dispatchId: intent.id,
    finishedAt: new Date().toISOString(),
    exit,
    reason,
    taskId: thread?.thread_id ?? null,
    actualExecutor: runtime.executor,
    actualModel: null,
    actualEffort: null,
    requestedModel: runtime.model,
    requestedEffort: runtime.effort,
    taskDispatches: 1,
    diagnosticItemCount: events.filter((x) => x.item?.type === "error").length,
    taskCompleteEvent: events.some((x) => x.type === "turn.completed"),
    failedEvent: events.some(
      (x) => x.type === "turn.failed" || x.type === "error",
    ),
    generationSuccess: "not-inferred",
    acceptedByUser: false,
    automaticRetry: false,
    raw: {
      input: { sha256: hash(inputBytes), byteLength: inputBytes.length },
      stdout: { sha256: hash(out), byteLength: out.length },
      stderr: { sha256: hash(err), byteLength: err.length },
    },
    eventTypes: events.slice(0, 256).map((x) => x.type),
    observableItems: events
      .filter((x) => x.item)
      .slice(0, 128)
      .map((x) => ({
        type: x.item.type,
        status: x.item.status,
        id: x.item.id,
      })),
  };
  await durableFile(
    join(dir, "task-outcome.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(out.toString("utf8"));
  console.log(
    "\nTask ended. Result acceptance remains yours. Raw logs: " +
      dir +
      "\n" +
      JSON.stringify(result, null, 2),
  );
  return result;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  runTerminal(
    resolve(process.argv[2] ?? ""),
    process.argv[3] ?? "",
    process.argv[4] ?? "",
  ).catch((e) => {
    console.error("Dispatch stopped: " + JSON.stringify(e.message));
    process.exitCode = 1;
  });
