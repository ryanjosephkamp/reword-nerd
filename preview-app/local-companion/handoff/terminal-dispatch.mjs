import {
  claimRepeatable,
  durableFile,
  repeatableMode,
  readClaims,
} from "./repeatable-state.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { hash, bounded, shQuote } from "./contract.mjs";
export const NATIVE_CODEX =
  "/Applications/ChatGPT.app/Contents/Resources/codex";
export const NATIVE_SHA =
  "87a08119b8effa519f0ecb552dc98043f58a8200bf2ec5da60f76890c33e9c3a";
export const terminalEnv = () => ({
  ...Object.fromEntries(
    ["HOME", "TMPDIR", "USER", "LOGNAME", "LANG"]
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]]),
  ),
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
});
const exec = promisify(execFile);
export async function checkTerminalRuntime() {
  if (hash(await readFile(NATIVE_CODEX)) !== NATIVE_SHA)
    throw Error("Installed Codex differs from the offline-tested binary");
  const r = await exec(NATIVE_CODEX, ["login", "status"], {
    env: terminalEnv(),
    timeout: 15000,
    maxBuffer: 8192,
  });
  if (!/^Logged in using ChatGPT\s*$/.test((r.stdout + r.stderr).trim()))
    throw Error("Existing ChatGPT sign-in not confirmed; no dispatch");
  return {
    executor: "Codex CLI 0.153.4 / exec",
    model: "gpt-6-astra",
    effort: "medium",
    signInMethod: "ChatGPT",
    modelEvidence: "installed bundled catalog; actual run reported separately",
    binarySha256: NATIVE_SHA,
  };
}
export async function requestTerminalDispatch({
  root,
  verified,
  expectedSeal,
  runner,
  enabled,
  openTerminal,
  repeatable = false,
  check = checkTerminalRuntime,
}) {
  if (!enabled)
    throw Error("Terminal execution is unavailable in this companion launch");
  const { snapshot: s, files, dir, seal } = verified;
  if (seal !== expectedSeal) throw Error("Stale outgoing review");
  if (s.sourceKind !== "image")
    throw Error(
      "This increment dispatches one image task only; text connection is unchanged",
    );
  if (repeatable) {
    const mode = await repeatableMode(root);
    if (!mode) throw Error("Repeatable state is not initialized");
    const previous = (await readClaims(root, mode)).find(
      (c) => c.intent.handoffId === s.id || c.intent.requestId === s.requestId,
    );
    if (previous) {
      if (
        previous.intent.handoffId !== s.id ||
        previous.intent.requestId !== s.requestId ||
        previous.intent.snapshotSha256 !== seal
      )
        throw Error("Conflicting dispatch request identity");
      return { duplicate: true, intent: previous.intent };
    }
  }
  let claimPath = join(root, "terminal-dispatch-claim.json");
  if (!repeatable && (await repeatableMode(root)))
    throw Error("Repeatable state cannot use the legacy single-use launcher");
  if (!repeatable)
    try {
      const claim = JSON.parse(await bounded(claimPath, 8192));
      if (claim.handoffId === s.id && claim.snapshotSha256 === seal)
        return { duplicate: true };
      throw Error(
        "The single terminal dispatch is already claimed; no retry or second task",
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  const runtime = await check();
  if ((await realpath(runner)) !== resolve(runner))
    throw Error("Unsafe terminal runner");
  let intent = {
    kind: "reword-terminal-dispatch",
    schemaVersion: 1,
    id: randomUUID(),
    handoffId: s.id,
    snapshotSha256: seal,
    packageSha256: s.packageSha256,
    referenceSha256: hash(files["reference.png"]),
    promptSha256: hash(files["prompt.txt"]),
    createdAt: new Date().toISOString(),
    operation: "codex-cli-image-task",
    requestedRuntime: runtime,
    actualExecutor: null,
    actualModel: null,
    actualEffort: null,
    taskId: null,
    acceptedByUser: false,
    automaticRetry: false,
    internalOperationCap: null,
  };
  let raw;
  if (repeatable) {
    const claimed = await claimRepeatable(root, verified, intent);
    if (claimed.duplicate) return claimed;
    intent = claimed.intent;
    raw = claimed.raw;
    claimPath = claimed.path;
  } else {
    raw = Buffer.from(JSON.stringify(intent, null, 2));
    await durableFile(claimPath, raw);
  }
  await durableFile(join(dir, "dispatch-intent.json"), raw);
  const command =
    "#!/bin/sh\nexec " +
    [process.execPath, runner, dir, seal, claimPath].map(shQuote).join(" ") +
    "\n";
  await writeFile(join(dir, "dispatch.command"), command, {
    flag: "wx",
    mode: 0o700,
  });
  try {
    await openTerminal(join(dir, "dispatch.command"));
  } catch {
    throw Error(
      "Terminal startup is uncertain. The send remains claimed; it will not retry.",
    );
  }
  return { duplicate: false, intent };
}
