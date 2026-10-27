import { LEGACY_CODEX_PATH } from "../runtime-paths.mjs";
import {
  repeatableMode,
  repeatableStatus,
  completionEvidence,
  claimName,
} from "./repeatable-state.mjs";
import { requestTerminalDispatch, NATIVE_SHA } from "./terminal-dispatch.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  realpath,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { loadImagePackage } from "../../image-companion/package.ts";
import { loadPackage } from "../../companion/package.ts";
import {
  hash,
  MAX_PROMPT,
  MAX_HANDOFFS,
  validId,
  safeDirectory,
  bounded,
  verifySnapshot,
  shQuote,
  unsafePromptControls,
} from "./contract.mjs";
const exec = promisify(execFile);
export const CODEX_PATH = LEGACY_CODEX_PATH;
const REVIEW_FILES = [
  "review-opened.json",
  "start-requested.json",
  "process-exit.json",
];
export async function createHandoffService(
  root,
  {
    reviewer,
    terminalRunner = null,
    terminalEnabled = false,
    terminalRepeatable = false,
    terminalTestBudget = false,
    terminalCheck,
    openTerminal = async (file) => {
      await exec("/usr/bin/open", ["-a", "Terminal", file], {
        timeout: 10000,
        maxBuffer: 8192,
      });
    },
  } = {},
) {
  root = resolve(root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await safeDirectory(root);
  const mode = await repeatableMode(root, {
    enable: terminalRepeatable,
    testBudget: terminalTestBudget,
  });
  if (mode && terminalEnabled)
    throw Error(
      "Use repeatable mode explicitly; legacy single-use option cannot execute v2 state",
    );
  const enabled = terminalEnabled || terminalRepeatable;
  let busy = false,
    capability;
  async function currentCapability(base) {
    if (mode) {
      const state = await repeatableStatus(root, mode);
      return {
        ...base,
        terminalMode: "explicit-repeatable",
        agentTestTaskLimit: mode.agentTestBudget,
        activeHandoffId: state.active,
        agentTestBudgetSpent: state.budgetSpent,
        terminalTaskAvailable:
          terminalRepeatable &&
          state.available &&
          base.terminalReviewAvailable &&
          base.codexSha256 === NATIVE_SHA,
        executionAvailable:
          terminalRepeatable &&
          state.available &&
          base.terminalReviewAvailable &&
          base.codexSha256 === NATIVE_SHA,
        reason: !terminalRepeatable
          ? "Review-only launch. Saved repeatable history is available; no task can start."
          : state.budgetSpent
            ? "The agent-test task budget is spent. No additional task can start."
            : state.active
              ? state.evidence.reason
              : mode.agentTestBudget === 1
                ? "One authorized test task remains. Its budget is durable across restarts."
                : "One task per explicit confirmation; one active task at a time. A resend consumes usage as a new task.",
      };
    }
    let used = false;
    try {
      await bounded(join(root, "terminal-dispatch-claim.json"), 8192);
      used = true;
    } catch (e) {
      if (e.code !== "ENOENT") used = true;
    }
    return {
      ...base,
      terminalTaskAvailable:
        terminalEnabled &&
        !used &&
        base.terminalReviewAvailable &&
        base.codexSha256 === NATIVE_SHA,
      executionAvailable:
        terminalEnabled &&
        !used &&
        base.terminalReviewAvailable &&
        base.codexSha256 === NATIVE_SHA,
      dispatchClaimed: used,
      reason: used
        ? "The single terminal task is already claimed. Review its retained history; this state cannot send a second task."
        : base.reason,
    };
  }
  async function discover() {
    if (capability) return currentCapability(capability);
    let supported = false,
      reason = "",
      version = null,
      codexSha256 = null;
    try {
      const v = await exec(CODEX_PATH, ["--version"], {
        timeout: 5000,
        maxBuffer: 8192,
      });
      version = v.stdout.trim();
      const help = await exec(CODEX_PATH, ["--help"], {
        timeout: 5000,
        maxBuffer: 24000,
      });
      supported =
        version === "codex-cli 0.153.4" &&
        help.stdout.includes("--image") &&
        process.platform === "darwin" &&
        Boolean(reviewer);
      if (supported) codexSha256 = hash(await readFile(CODEX_PATH));
      else
        reason =
          "This terminal launcher is tested only with macOS and Codex CLI 0.153.4.";
    } catch {
      reason =
        "The configured Codex CLI or local terminal review is unavailable.";
    }
    capability = {
      kind: "reword-outbound-handoff",
      schemaVersion: 1,
      target: "codex-cli",
      targetLabel: "Codex terminal",
      terminalReviewAvailable: supported,
      nativeDraftAvailable: false,
      automaticStartAvailable: false,
      executionAvailable: enabled,
      terminalTaskAvailable: enabled,
      startBlockedReason:
        "Task start requires an explicitly enabled local launcher. The default is review-only.",
      attachmentInput: "Official CLI --image (PNG); exact saved bytes retained",
      version,
      codexSha256,
      reason:
        (terminalEnabled
          ? "One explicit Codex CLI task is enabled for this local launch; no automatic retry or internal-operation cap."
          : reason) ||
        "Opens a local terminal review. Codex task start is unavailable; this is not a populated Codex draft.",
      claude: {
        available: false,
        reason:
          "Documented draft links accept prompt text, but do not establish reference-image attachment delivery. Claude Code has not been integrated or model-tested.",
      },
      resultReturn: false,
      location: root,
    };
    return currentCapability(capability);
  }
  async function read(id) {
    if (!validId(id)) throw Error("Invalid handoff identity");
    const dir = join(root, id);
    await safeDirectory(dir);
    const seal = JSON.parse(
      (await bounded(join(dir, "seal.json"), 4096)).toString(),
    );
    if (seal.id !== id) throw Error("Handoff seal identity mismatch");
    const v = await verifySnapshot(dir, seal.snapshotSha256);
    if (v.snapshot.id !== id) throw Error("Wrong handoff");
    return { ...v, dir, seal: seal.snapshotSha256 };
  }
  async function status(id) {
    const v = await read(id);
    let phase = "prepared",
      events = [];
    for (const name of [
      "launch-requested.json",
      ...REVIEW_FILES,
      "dispatch-intent.json",
      "native-start-claimed.json",
      "task-outcome.json",
    ]) {
      try {
        const e = JSON.parse(
          (await bounded(join(v.dir, name), 8192)).toString(),
        );
        if (
          e.handoffId !== id ||
          (e.snapshotSha256 && e.snapshotSha256 !== v.seal)
        )
          throw Error("Handoff event identity mismatch");
        events.push({ file: name, ...e });
        phase =
          name === "task-outcome.json"
            ? "task-ended-review-pending"
            : name === "native-start-claimed.json"
              ? "task-started-outcome-unknown"
              : name === "dispatch-intent.json"
                ? "task-dispatch-claimed"
                : name === "review-opened.json"
                  ? "terminal-review-open"
                  : name === "start-requested.json"
                    ? "user-started-outcome-unknown"
                    : name === "process-exit.json"
                      ? "harness-exited-outcome-unknown"
                      : "launch-requested-unconfirmed";
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    let boundaryNote = null;
    const dispatch = events.find((e) => e.file === "dispatch-intent.json");
    if (
      dispatch?.schemaVersion === 2 &&
      events.some((e) => e.file === "task-outcome.json")
    ) {
      const raw = await bounded(join(root, claimName(dispatch.sequence)), 8192);
      const evidence = await completionEvidence(root, {
        raw,
        intent: JSON.parse(raw),
      });
      if (!evidence.complete) {
        phase = "task-outcome-uncertain";
        boundaryNote = evidence.reason;
      }
    }
    return {
      ...v.snapshot,
      phase,
      boundaryNote,
      events,
      location: v.dir,
      snapshotSha256: v.seal,
      prompt: v.files["prompt.txt"].toString("utf8"),
      artifacts: [
        ...Object.keys(v.snapshot.artifacts),
        "snapshot.json",
        "handoff.zip",
        ...events
          .filter((e) =>
            [
              "dispatch-intent.json",
              "native-start-claimed.json",
              "task-outcome.json",
            ].includes(e.file),
          )
          .map((e) => e.file),
        ...(events.some((e) => e.file === "task-outcome.json")
          ? ["native-stdout.jsonl", "native-stderr.txt", "native-input.json"]
          : []),
      ],
      automaticStartAvailable: false,
    };
  }
  async function list() {
    const names = await readdir(root);
    const ids = names.filter(validId);
    if (ids.length > MAX_HANDOFFS) throw Error("Handoff history exceeds limit");
    const records = [];
    for (const id of ids) {
      try {
        records.push(await status(id));
      } catch (e) {
        records.push({
          id,
          phase: "incomplete-or-invalid",
          error: e.message,
          location: join(root, id),
          acceptedByUser: false,
        });
      }
    }
    return records;
  }
  async function prepare(bytes, kind, { requestId, resendOf = null } = {}) {
    if (busy) throw Error("A handoff operation is already in progress");
    if (
      !validId(requestId) ||
      !["image", "text"].includes(kind) ||
      (resendOf !== null && !validId(resendOf))
    )
      throw Error("Invalid handoff preparation request");
    if (bytes.length > (kind === "image" ? 24 : 8) * 1024 * 1024)
      throw Error("Package exceeds handoff limit");
    bytes = Buffer.from(bytes);
    busy = true;
    try {
      const cap = await discover();
      const pkg =
        kind === "image"
          ? await loadImagePackage(bytes)
          : await loadPackage(bytes);
      const prompt =
        kind === "image" ? pkg.prompt : pkg.workbook.oneShot.prompt;
      const promptBytes = Buffer.from(prompt);
      if (
        kind === "image" &&
        (Buffer.from(pkg.referenceBytes).readUInt32BE(16) > 2048 ||
          Buffer.from(pkg.referenceBytes).readUInt32BE(20) > 2048)
      )
        throw Error(
          "Exact-byte CLI handoff supports PNG dimensions up to 2048 per axis; manual export remains available.",
        );
      if (promptBytes.length > MAX_PROMPT || unsafePromptControls(prompt))
        throw Error(
          "This CLI handoff supports at most 64 KiB of prompt text without carriage returns or unsafe controls; the CLI normalizes CRLF. Manual export remains available.",
        );
      const existing = await list();
      const same = existing.find((x) => x.requestId === requestId);
      if (same) {
        if (
          same.packageSha256 !== pkg.packageSha256 ||
          same.sourceKind !== kind ||
          same.resendOf !== resendOf
        )
          throw Error("Conflicting handoff request identity");
        return same;
      }
      if (resendOf) {
        const previous = await read(resendOf);
        if (
          previous.snapshot.packageSha256 !== pkg.packageSha256 ||
          previous.snapshot.sourceKind !== kind
        )
          throw Error("Resend source does not match original handoff");
      } else {
        const duplicate = existing.find(
          (x) => x.packageSha256 === pkg.packageSha256 && x.sourceKind === kind,
        );
        if (duplicate) return duplicate;
      }
      if (existing.length >= MAX_HANDOFFS)
        throw Error(
          "This launch supports at most 16 handoffs. Preserve it and start a fresh companion.",
        );
      const id = randomUUID(),
        dir = join(root, id);
      const reference =
        kind === "image"
          ? Buffer.from(pkg.referenceBytes)
          : Buffer.from(pkg.sourceText);
      const artifacts = {
        "package.zip": Buffer.from(bytes),
        "prompt.txt": promptBytes,
        [kind === "image" ? "reference.png" : "reviewed-source.txt"]: reference,
        "saved-profile.json": Buffer.from(
          JSON.stringify(
            kind === "image"
              ? pkg.configuration
              : pkg.manifest.documents[0].model,
            null,
            2,
          ),
        ),
      };
      const s = {
        kind: "reword-outbound-handoff",
        schemaVersion: 1,
        id,
        requestId,
        resendOf,
        createdAt: new Date().toISOString(),
        sourceKind: kind,
        sourceIdentity: kind === "image" ? pkg.pairKey : pkg.documentKey,
        displayName: kind === "image" ? pkg.displayName : pkg.documentName,
        target: "codex-cli",
        operation: "terminal-launch-review",
        workflow:
          kind === "image"
            ? "canonical-image-reference-prompt"
            : "canonical-one-shot-text",
        packageSha256: pkg.packageSha256,
        referenceSha256: hash(reference),
        promptSha256: hash(promptBytes),
        acceptedByUser: false,
        actualExecutor: null,
        actualModel: null,
        generationOutcome: "not-started",
        artifacts: Object.fromEntries(
          Object.entries(artifacts).map(([name, b]) => [
            name,
            { sha256: hash(b), byteLength: b.length },
          ]),
        ),
        launcher: {
          codexPath: CODEX_PATH,
          codexSha256: cap.codexSha256,
          version: cap.version,
        },
      };
      const raw = Buffer.from(JSON.stringify(s, null, 2));
      await mkdir(dir, { mode: 0o700 });
      await mkdir(join(dir, "workspace"), { mode: 0o700 });
      for (const [name, b] of Object.entries(artifacts))
        await writeFile(join(dir, name), b, { flag: "wx", mode: 0o400 });
      await writeFile(join(dir, "snapshot.json"), raw, {
        flag: "wx",
        mode: 0o400,
      });
      await writeFile(
        join(dir, "seal.json"),
        JSON.stringify({ id, snapshotSha256: hash(raw) }),
        { flag: "wx", mode: 0o400 },
      );
      const zip = new JSZip();
      for (const [name, b] of Object.entries(artifacts)) zip.file(name, b);
      zip.file("snapshot.json", raw);
      zip.file(
        "README.txt",
        "Reword Nerd outbound handoff v1. Data-only export; no task is created by downloading. Original prompt/reference/package bytes are preserved. This is NOT an image result review bundle or acceptance record. Checksums establish consistency, not authorship.\n",
      );
      const exportBytes = await zip.generateAsync({
        type: "nodebuffer",
        compression: "STORE",
      });
      await writeFile(join(dir, "handoff.zip"), exportBytes, {
        flag: "wx",
        mode: 0o400,
      });
      await writeFile(
        join(dir, "bundle-seal.json"),
        JSON.stringify({
          id,
          snapshotSha256: hash(raw),
          sha256: hash(exportBytes),
          byteLength: exportBytes.length,
        }),
        { flag: "wx", mode: 0o400 },
      );
      return status(id);
    } finally {
      busy = false;
    }
  }
  async function launch(id, expectedSeal) {
    if (busy) throw Error("A handoff operation is already in progress");
    busy = true;
    try {
      const cap = await discover();
      if (!cap.terminalReviewAvailable) throw Error(cap.reason);
      const v = await read(id);
      if (v.seal !== expectedSeal) throw Error("Stale handoff review");
      const previous = await status(id);
      if (previous.events.some((x) => x.file === "launch-requested.json"))
        return previous;
      if (hash(await readFile(CODEX_PATH)) !== v.snapshot.launcher.codexSha256)
        throw Error("Installed Codex changed");
      if ((await realpath(reviewer)) !== resolve(reviewer))
        throw Error("Unsafe terminal reviewer");
      const command =
        "#!/bin/sh\nexec " +
        [process.execPath, reviewer, v.dir, v.seal].map(shQuote).join(" ") +
        "\n";
      await writeFile(join(v.dir, "launch.command"), command, {
        flag: "wx",
        mode: 0o700,
      });
      await writeFile(
        join(v.dir, "launch-requested.json"),
        JSON.stringify({
          handoffId: id,
          snapshotSha256: v.seal,
          kind: "os-terminal-launch-request",
          requestedAt: new Date().toISOString(),
          modelCalls: 0,
          automaticRetry: false,
        }),
        { flag: "wx", mode: 0o600 },
      );
      try {
        await openTerminal(join(v.dir, "launch.command"));
      } catch {
        throw Error(
          "Terminal launch outcome is uncertain. Inspect the retained handoff; it will not automatically launch again.",
        );
      }
      return status(id);
    } finally {
      busy = false;
    }
  }
  let inFlightDispatch = null;
  function dispatch(id, expectedSeal) {
    const key = `${id}:${expectedSeal}`;
    if (inFlightDispatch) {
      if (inFlightDispatch.key === key) return inFlightDispatch.run;
      return Promise.reject(Error("Another confirmation is in progress; tasks are never queued"));
    }
    const run = dispatchOnce(id, expectedSeal).finally(() => { inFlightDispatch = null; });
    inFlightDispatch = { key, run };
    return run;
  }
  async function dispatchOnce(id, expectedSeal) {
    if (busy) throw Error("A handoff operation is already in progress");
    busy = true;
    try {
      await requestTerminalDispatch({
        root,
        verified: await read(id),
        expectedSeal,
        runner: terminalRunner,
        enabled,
        repeatable: terminalRepeatable,
        check: terminalCheck,
        openTerminal,
      });
      return status(id);
    } finally {
      busy = false;
    }
  }
  async function artifact(id, name) {
    const v = await read(id);
    if (
      [
        "native-stdout.jsonl",
        "native-stderr.txt",
        "native-input.json",
      ].includes(name)
    ) {
      const outcome = JSON.parse(
        await bounded(join(v.dir, "task-outcome.json"), 32768),
      );
      if (outcome.handoffId !== id || outcome.snapshotSha256 !== v.seal)
        throw Error("Wrong task outcome");
      const raw = await bounded(join(v.dir, name), 40 * 1024 * 1024);
      if (
        name !== "native-input.json" &&
        hash(raw) !==
          outcome.raw[name === "native-stdout.jsonl" ? "stdout" : "stderr"]
            .sha256
      )
        throw Error("Task output changed");
      return raw;
    }
    if (
      [
        "dispatch-intent.json",
        "native-start-claimed.json",
        "task-outcome.json",
      ].includes(name)
    ) {
      const raw = await bounded(join(v.dir, name), 32768);
      const e = JSON.parse(raw);
      if (e.handoffId !== id || e.snapshotSha256 !== v.seal)
        throw Error("Wrong task receipt");
      return raw;
    }
    if (name === "snapshot.json") return bounded(join(v.dir, name), 128 * 1024);
    if (name === "handoff.zip") {
      const b = await bounded(join(v.dir, name), 40 * 1024 * 1024);
      const seal = JSON.parse(
        (await bounded(join(v.dir, "bundle-seal.json"), 4096)).toString(),
      );
      if (
        seal.id !== id ||
        seal.snapshotSha256 !== v.seal ||
        seal.sha256 !== hash(b) ||
        seal.byteLength !== b.length
      )
        throw Error("Portable handoff bundle changed");
      return b;
    }
    if (!Object.hasOwn(v.snapshot.artifacts, name))
      throw Error("Unknown handoff artifact");
    return v.files[name];
  }
  return { discover, list, prepare, launch, dispatch, artifact };
}
