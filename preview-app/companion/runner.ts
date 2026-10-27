import { constants } from "node:fs";
import { mkdir, lstat, open, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { resolve, join, basename, dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { loadPackage } from "./package";
import {
  createWorkbookProgress,
  updateWorkbookResponse,
  renderWorkbookProgressHtml,
  parseWorkbookProgressHtml,
} from "../src/export/artifacts";
import { renderReview } from "./review";

export const STAGES = ["decompose", "rewrite", "verify", "final"] as const;
export type Stage = (typeof STAGES)[number];
export const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_STATE_BYTES = 4 * 1024 * 1024;
const MAX_ATTEMPTS_PER_STAGE = 64;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export interface Execution {
  mode: "fixture" | "host-assisted";
  host?: string;
  model?: string;
}
export interface Ticket {
  schemaVersion: 1;
  jobId: string;
  packageSha256: string;
  documentKey: string;
  sourceSha256: string;
  revision: number;
  stage: Stage;
  attempt: number;
  ticketId: string;
  promptSha256: string;
  canonicalPromptSha256: string;
  priorResponseHashes: Partial<Record<Stage, string>>;
}
interface Recorded {
  ticket: Ticket;
  responsePath: string;
  responseSha256: string;
  recordedAt: string;
}
interface Active {
  ticket: Ticket;
  ticketPath: string;
  promptPath: string;
}
interface State {
  schemaVersion: 1;
  jobId: string;
  packageSha256: string;
  documentKey: string;
  sourceSha256: string;
  documentName: string;
  revision: number;
  createdAt: string;
  execution: Execution;
  attempts: Record<Stage, number>;
  accepted: Partial<Record<Stage, Recorded>>;
  history: Recorded[];
  active: Active | null;
}
export class RunnerError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "RunnerError";
  }
}
function fail(code: string, message: string): never {
  throw new RunnerError(code, message);
}
const hash = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const isStage = (stage: unknown): stage is Stage => STAGES.includes(stage as Stage);
const exactUtf8 = (bytes: Uint8Array) =>
  new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);

async function readBounded(path: string, limit: number): Promise<Buffer> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > limit)
    fail("FILE_LIMIT", `${basename(path)} must be a regular file no larger than ${limit} bytes.`);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit)
      fail("FILE_LIMIT", `${basename(path)} must be a regular file no larger than ${limit} bytes.`);
    const bytes = await handle.readFile();
    if (bytes.byteLength > limit) fail("FILE_LIMIT", "File grew beyond its allowed size.");
    return bytes;
  } finally {
    await handle.close();
  }
}
async function directory(path: string) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    fail("UNSAFE_PATH", "Job and artifact directories must not be symbolic links.");
}
async function artifactPath(root: string, relative: string): Promise<string> {
  if (!/^(tickets|responses)\/[a-zA-Z0-9._-]+$/.test(relative))
    fail("UNSAFE_PATH", "Invalid internal artifact path.");
  await directory(join(root, relative.split("/")[0]));
  return join(root, relative);
}
async function immutable(path: string, data: string | Uint8Array) {
  await writeFile(path, data, { flag: "wx", mode: 0o600 });
}
async function save(root: string, state: State) {
  const temp = join(root, `.state-${randomUUID()}.tmp`);
  await immutable(temp, JSON.stringify(state, null, 2) + "\n");
  await rename(temp, join(root, "state.json"));
}
async function lock<T>(root: string, work: () => Promise<T>): Promise<T> {
  await directory(root);
  const path = join(root, ".lock");
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const recovery = join(root, ".lock-recovery");
    try {
      await mkdir(recovery, { mode: 0o700 });
    } catch (guardError) {
      if ((guardError as NodeJS.ErrnoException).code !== "EEXIST") throw guardError;
      fail(
        "JOB_BUSY",
        "A lock recovery guard exists. Retry later; inspect an interrupted recovery before removing its guard.",
      );
    }
    try {
      // Serialize recovery, then re-read: another command may have acquired a new lock.
      await directory(path);
      let owner: { pid: number };
      try {
        owner = JSON.parse(exactUtf8(await readBounded(join(path, "owner.json"), 1024)));
      } catch {
        fail(
          "JOB_BUSY",
          "A job lock exists. Its owner could not be verified; inspect it before recovery.",
        );
      }
      if (!Number.isSafeInteger(owner!.pid) || owner!.pid < 1)
        fail("JOB_BUSY", "Invalid lock owner.");
      try {
        process.kill(owner!.pid, 0);
        fail("JOB_BUSY", "Another runner command owns this job.");
      } catch (check) {
        if ((check as NodeJS.ErrnoException).code !== "ESRCH") throw check;
      }
      // Remove only this job's known stale lock after proving its owner exited.
      await unlink(join(path, "owner.json"));
      await rmdir(path);
      await mkdir(path, { mode: 0o700 });
    } finally {
      await rmdir(recovery);
    }
  }
  const token = randomUUID();
  await immutable(join(path, "owner.json"), JSON.stringify({ pid: process.pid, token }));
  try {
    return await work();
  } finally {
    const owner = JSON.parse(exactUtf8(await readBounded(join(path, "owner.json"), 1024)));
    if (owner.token === token) {
      await unlink(join(path, "owner.json"));
      await rmdir(path);
    }
  }
}
async function load(root: string) {
  await directory(root);
  const state = JSON.parse(
    exactUtf8(await readBounded(join(root, "state.json"), MAX_STATE_BYTES)),
  ) as State;
  if (
    state.schemaVersion !== 1 ||
    typeof state.jobId !== "string" ||
    !UUID.test(state.jobId) ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 1 ||
    !state.accepted ||
    !Array.isArray(state.history) ||
    state.history.length > STAGES.length * MAX_ATTEMPTS_PER_STAGE ||
    !state.attempts ||
    !["fixture", "host-assisted"].includes(state.execution?.mode)
  )
    fail("STATE_INVALID", "Unsupported or invalid job state.");
  if (
    !STAGES.every(
      (stage) =>
        Number.isSafeInteger(state.attempts[stage]) &&
        state.attempts[stage] >= 0 &&
        state.attempts[stage] <= MAX_ATTEMPTS_PER_STAGE,
    )
  )
    fail("STATE_INVALID", "Invalid stage attempt counters.");
  const pkg = await loadPackage(await readBounded(join(root, "package.zip"), 8 * 1024 * 1024));
  if (
    pkg.packageSha256 !== state.packageSha256 ||
    pkg.documentKey !== state.documentKey ||
    pkg.sourceSha256 !== state.sourceSha256 ||
    pkg.documentName !== state.documentName
  )
    fail(
      "PACKAGE_CHANGED",
      "The preserved package or its source identity changed. Create a new job from a reviewed package.",
    );
  const historyIds = new Set<string>();
  const recordedText = new Map<string, string>();
  for (const recorded of state.history) {
    const ticket = recorded?.ticket;
    if (
      !ticket ||
      !isStage(ticket.stage) ||
      ticket.schemaVersion !== 1 ||
      !UUID.test(ticket.ticketId) ||
      historyIds.has(ticket.ticketId) ||
      ticket.jobId !== state.jobId ||
      ticket.packageSha256 !== state.packageSha256 ||
      ticket.documentKey !== state.documentKey ||
      ticket.sourceSha256 !== state.sourceSha256 ||
      !Number.isSafeInteger(ticket.revision) ||
      ticket.revision < 1 ||
      ticket.revision > state.revision ||
      !Number.isSafeInteger(ticket.attempt) ||
      ticket.attempt < 1 ||
      ticket.attempt > state.attempts[ticket.stage] ||
      ticket.canonicalPromptSha256 !== hash(pkg.workbook.promptBundle.manual[ticket.stage])
    )
      fail("STATE_INVALID", "Invalid retained response identity.");
    historyIds.add(ticket.ticketId);
    const stem = `${ticket.stage}-r${ticket.revision}-a${ticket.attempt}-${ticket.ticketId}`;
    const storedTicket = JSON.parse(
      exactUtf8(await readBounded(await artifactPath(root, `tickets/${stem}.json`), 16384)),
    );
    if (!isDeepStrictEqual(storedTicket, ticket))
      fail("TICKET_CHANGED", "A retained response ticket was modified.");
    if (
      hash(await readBounded(await artifactPath(root, `tickets/${stem}.md`), 4 * 1024 * 1024)) !==
      ticket.promptSha256
    )
      fail("PROMPT_CHANGED", "A retained prompt was modified.");
    const response = exactUtf8(
      await readBounded(await artifactPath(root, recorded.responsePath), MAX_RESPONSE_BYTES),
    );
    if (hash(response) !== recorded.responseSha256)
      fail("RESPONSE_CHANGED", "A recorded response has changed. Preserve it and inspect the job.");
    recordedText.set(ticket.ticketId, response);
  }
  let progress = createWorkbookProgress(pkg.workbook);
  let gap = false;
  for (const stage of STAGES) {
    const recorded = state.accepted[stage];
    if (!recorded) {
      gap = true;
      continue;
    }
    if (gap) fail("STATE_INVALID", "Accepted stages must form a complete prefix.");
    if (
      recorded.ticket.schemaVersion !== 1 ||
      !UUID.test(recorded.ticket.ticketId) ||
      recorded.ticket.stage !== stage ||
      recorded.ticket.jobId !== state.jobId ||
      recorded.ticket.packageSha256 !== state.packageSha256 ||
      recorded.ticket.documentKey !== state.documentKey ||
      recorded.ticket.sourceSha256 !== state.sourceSha256
    )
      fail("STATE_INVALID", "A recorded stage belongs to a different source or job.");
    if (!state.history.some((item) => isDeepStrictEqual(item, recorded)))
      fail("STATE_INVALID", "An accepted response is missing from its retained history.");
    const response = recordedText.get(recorded.ticket.ticketId)!;
    const expectedPrompt = progress.manual.prompts[stage].text;
    if (
      hash(expectedPrompt) !== recorded.ticket.promptSha256 ||
      hash(pkg.workbook.promptBundle.manual[stage]) !== recorded.ticket.canonicalPromptSha256
    )
      fail("STATE_INVALID", "A response no longer matches the exact canonical stage input.");
    if (
      !isDeepStrictEqual(
        recorded.ticket.priorResponseHashes,
        Object.fromEntries(
          STAGES.slice(0, STAGES.indexOf(stage)).map((previous) => [
            previous,
            state.accepted[previous]!.responseSha256,
          ]),
        ),
      )
    )
      fail("STATE_INVALID", "A response has stale prerequisites.");
    progress = updateWorkbookResponse(pkg.workbook, progress, stage, response);
  }
  if (state.active) {
    const stage = STAGES.find((item) => !state.accepted[item]);
    const ticket = state.active.ticket;
    if (
      !stage ||
      !ticket ||
      ticket.schemaVersion !== 1 ||
      !UUID.test(ticket.ticketId) ||
      ticket.stage !== stage ||
      ticket.jobId !== state.jobId ||
      ticket.packageSha256 !== state.packageSha256 ||
      ticket.sourceSha256 !== state.sourceSha256 ||
      ticket.documentKey !== state.documentKey ||
      ticket.revision !== state.revision ||
      ticket.attempt !== state.attempts[stage] ||
      ticket.promptSha256 !== hash(progress.manual.prompts[stage].text) ||
      ticket.canonicalPromptSha256 !== hash(pkg.workbook.promptBundle.manual[stage]) ||
      !isDeepStrictEqual(
        ticket.priorResponseHashes,
        Object.fromEntries(
          STAGES.slice(0, STAGES.indexOf(stage)).map((prior) => [
            prior,
            state.accepted[prior]!.responseSha256,
          ]),
        ),
      )
    )
      fail("STATE_INVALID", "The active ticket does not match the exact current job and stage.");
    const stem = `${stage}-r${state.revision}-a${ticket.attempt}-${ticket.ticketId}`;
    if (
      state.active.ticketPath !== `tickets/${stem}.json` ||
      state.active.promptPath !== `tickets/${stem}.md`
    )
      fail("STATE_INVALID", "The active ticket artifact paths do not match its identity.");
    const stored = JSON.parse(
      exactUtf8(await readBounded(await artifactPath(root, state.active.ticketPath), 16384)),
    );
    if (!isDeepStrictEqual(stored, ticket))
      fail("TICKET_CHANGED", "The prepared ticket was modified.");
    if (
      hash(
        await readBounded(await artifactPath(root, state.active.promptPath), 4 * 1024 * 1024),
      ) !== ticket.promptSha256
    )
      fail("PROMPT_CHANGED", "The prepared prompt was modified.");
  }
  return { state, pkg, progress };
}
function status(state: State) {
  const next = STAGES.find((stage) => !state.accepted[stage]) ?? null;
  const responseHistory = state.history.map((recorded) => ({
    stage: recorded.ticket.stage,
    revision: recorded.ticket.revision,
    attempt: recorded.ticket.attempt,
    ticketId: recorded.ticket.ticketId,
    responsePath: recorded.responsePath,
    responseSha256: recorded.responseSha256,
    recordedAt: recorded.recordedAt,
    status:
      state.accepted[recorded.ticket.stage]?.ticket.ticketId === recorded.ticket.ticketId
        ? "current"
        : "stale",
  }));
  return {
    jobId: state.jobId,
    documentName: state.documentName,
    documentKey: state.documentKey,
    revision: state.revision,
    execution: state.execution,
    packageSha256: state.packageSha256,
    sourceSha256: state.sourceSha256,
    stages: STAGES.map((stage) => {
      const previousResponseStale =
        !state.accepted[stage] && responseHistory.some((item) => item.stage === stage);
      return {
        stage,
        status: state.accepted[stage]
          ? "response-recorded"
          : state.active?.ticket.stage === stage
            ? "awaiting-response"
            : stage === next
              ? "ready"
              : previousResponseStale
                ? "stale"
                : "blocked",
        previousResponseStale,
        attempts: state.attempts[stage],
        responseSha256: state.accepted[stage]?.responseSha256,
      };
    }),
    responseHistory,
    nextStage: next,
    complete: next === null,
    reviewRequired: true,
    retainedResponseCount: state.history.length,
  };
}
export async function prepareJob(
  packagePath: string,
  jobDir: string,
  execution: Execution = { mode: "host-assisted", host: "unknown", model: "unknown" },
) {
  if (!["fixture", "host-assisted"].includes(execution.mode))
    fail("EXECUTION_INVALID", "Unknown execution mode.");
  if (
    [execution.host, execution.model].some(
      (value) => value !== undefined && (typeof value !== "string" || value.length > 256),
    )
  )
    fail("EXECUTION_INVALID", "Host and model labels must be strings of at most 256 characters.");
  const bytes = await readBounded(resolve(packagePath), 8 * 1024 * 1024);
  const pkg = await loadPackage(bytes);
  const root = resolve(jobDir);
  await directory(dirname(root));
  await mkdir(root, { mode: 0o700 }); // EEXIST intentionally preserves every existing job.
  for (const dir of ["tickets", "responses", "inbox"])
    await mkdir(join(root, dir), { mode: 0o700 });
  await immutable(join(root, "package.zip"), bytes);
  const state: State = {
    schemaVersion: 1,
    jobId: randomUUID(),
    packageSha256: pkg.packageSha256,
    documentKey: pkg.documentKey,
    sourceSha256: pkg.sourceSha256,
    documentName: pkg.documentName,
    revision: 1,
    createdAt: new Date().toISOString(),
    execution: {
      ...execution,
      host: execution.host ?? "unknown",
      model: execution.model ?? "unknown",
    },
    attempts: { decompose: 0, rewrite: 0, verify: 0, final: 0 },
    accepted: {},
    history: [],
    active: null,
  };
  await save(root, state);
  return status(state);
}
export async function inspectPackage(packagePath: string) {
  return loadPackage(await readBounded(resolve(packagePath), 8 * 1024 * 1024));
}
export async function getStatus(jobDir: string) {
  return status((await load(resolve(jobDir))).state);
}
export async function nextStage(
  jobDir: string,
  options: { stage?: Stage; revise?: boolean; retry?: boolean } = {},
) {
  const root = resolve(jobDir);
  return lock(root, async () => {
    const loaded = await load(root);
    const { state, pkg } = loaded;
    let { progress } = loaded;
    if (options.stage !== undefined && !isStage(options.stage))
      fail("INVALID_STAGE", "Unknown stage.");
    if (options.revise && options.retry) fail("INVALID_OPTIONS", "Choose revise or retry.");
    if (options.revise) {
      if (!options.stage || !state.accepted[options.stage])
        fail("INVALID_REVISION", "Revision requires an already recorded stage.");
      for (const stage of STAGES.slice(STAGES.indexOf(options.stage))) delete state.accepted[stage];
      state.revision += 1;
      state.active = null;
      progress = createWorkbookProgress(pkg.workbook);
      for (const stage of STAGES) {
        const recorded = state.accepted[stage];
        if (recorded)
          progress = updateWorkbookResponse(
            pkg.workbook,
            progress,
            stage,
            exactUtf8(
              await readBounded(
                await artifactPath(root, recorded.responsePath),
                MAX_RESPONSE_BYTES,
              ),
            ),
          );
      }
    }
    const stage = STAGES.find((item) => !state.accepted[item]);
    if (!stage) {
      if (options.stage) fail("STAGE_COMPLETE", "Use --revise to revise a recorded stage.");
      return { complete: true as const };
    }
    if (options.stage && options.stage !== stage)
      fail("WRONG_STAGE", `The next runnable stage is ${stage}.`);
    if (state.active && !options.retry) {
      const path = await artifactPath(root, state.active.promptPath);
      if (hash(await readBounded(path, 4 * 1024 * 1024)) !== state.active.ticket.promptSha256)
        fail("PROMPT_CHANGED", "The prepared prompt was modified.");
      const stored = JSON.parse(
        exactUtf8(await readBounded(await artifactPath(root, state.active.ticketPath), 16384)),
      );
      if (!isDeepStrictEqual(stored, state.active.ticket))
        fail("TICKET_CHANGED", "The prepared ticket was modified.");
      return {
        ticket: state.active.ticket,
        ticketPath: join(root, state.active.ticketPath),
        promptPath: path,
      };
    }
    const prompt = progress.manual.prompts[stage];
    if (!prompt.copyEnabled || prompt.stale)
      fail("STAGE_BLOCKED", "Stage prerequisites are unavailable or stale.");
    if (state.attempts[stage] >= MAX_ATTEMPTS_PER_STAGE)
      fail(
        "ATTEMPT_LIMIT",
        "This stage reached its 64-attempt limit. Preserve the job and start a new one if necessary.",
      );
    const ticket: Ticket = {
      schemaVersion: 1,
      jobId: state.jobId,
      packageSha256: state.packageSha256,
      documentKey: state.documentKey,
      sourceSha256: state.sourceSha256,
      revision: state.revision,
      stage,
      attempt: ++state.attempts[stage],
      ticketId: randomUUID(),
      promptSha256: hash(prompt.text),
      canonicalPromptSha256: hash(pkg.workbook.promptBundle.manual[stage]),
      priorResponseHashes: Object.fromEntries(
        STAGES.slice(0, STAGES.indexOf(stage)).map((previous) => [
          previous,
          state.accepted[previous]!.responseSha256,
        ]),
      ),
    };
    const stem = `${stage}-r${state.revision}-a${ticket.attempt}-${ticket.ticketId}`;
    const active = { ticket, ticketPath: `tickets/${stem}.json`, promptPath: `tickets/${stem}.md` };
    await immutable(await artifactPath(root, active.promptPath), prompt.text);
    await immutable(
      await artifactPath(root, active.ticketPath),
      JSON.stringify(ticket, null, 2) + "\n",
    );
    state.active = active;
    await save(root, state);
    return {
      ticket,
      ticketPath: join(root, active.ticketPath),
      promptPath: join(root, active.promptPath),
    };
  });
}
export async function recordResponse(jobDir: string, ticketPath: string, responsePath: string) {
  const root = resolve(jobDir);
  return lock(root, async () => {
    const { state, progress } = await load(root);
    const ticket = JSON.parse(exactUtf8(await readBounded(resolve(ticketPath), 16384))) as Ticket;
    const responseBytes = await readBounded(resolve(responsePath), MAX_RESPONSE_BYTES);
    const response = exactUtf8(responseBytes);
    if (!response.trim()) fail("EMPTY_RESPONSE", "A stage response must contain text.");
    if (!isStage(ticket.stage)) fail("INVALID_TICKET", "Unknown stage in response ticket.");
    const current = state.accepted[ticket.stage];
    if (
      current &&
      isDeepStrictEqual(current.ticket, ticket) &&
      current.responseSha256 === hash(responseBytes)
    )
      return { ...status(state), idempotent: true };
    if (!state.active || !isDeepStrictEqual(ticket, state.active.ticket))
      fail(
        "STALE_TICKET",
        "The ticket is stale, belongs to another job, or is not the active stage.",
      );
    if (hash(progress.manual.prompts[ticket.stage].text) !== ticket.promptSha256)
      fail("STALE_INPUT", "The stage input changed.");
    const prepared = await readBounded(
      await artifactPath(root, state.active.promptPath),
      4 * 1024 * 1024,
    );
    if (hash(prepared) !== ticket.promptSha256)
      fail("PROMPT_CHANGED", "The prepared prompt was modified.");
    const storedTicket = JSON.parse(
      exactUtf8(await readBounded(await artifactPath(root, state.active.ticketPath), 16384)),
    );
    if (!isDeepStrictEqual(ticket, storedTicket))
      fail("TICKET_CHANGED", "The prepared ticket was modified.");
    const relative = `responses/${ticket.stage}-r${ticket.revision}-a${ticket.attempt}-${ticket.ticketId}-${randomUUID()}.txt`;
    await immutable(await artifactPath(root, relative), responseBytes);
    const recorded: Recorded = {
      ticket,
      responsePath: relative,
      responseSha256: hash(responseBytes),
      recordedAt: new Date().toISOString(),
    };
    state.accepted[ticket.stage] = recorded;
    state.history.push(recorded);
    state.active = null;
    await save(root, state);
    return { ...status(state), idempotent: false };
  });
}
export async function exportJob(jobDir: string, outDir: string) {
  const root = resolve(jobDir);
  return lock(root, async () => {
    const { state, pkg, progress } = await load(root);
    const output = resolve(outDir);
    await directory(dirname(output));
    await mkdir(output, { mode: 0o700 }); // Never overwrite a previous export.
    const workbookHtml = renderWorkbookProgressHtml(pkg.workbook, progress);
    if (!isDeepStrictEqual(parseWorkbookProgressHtml(pkg.workbook, workbookHtml), progress))
      fail("WORKBOOK_ROUNDTRIP", "Workbook progress did not round-trip.");
    const rawFinal = progress.responses.final;
    const stageRecords = STAGES.map((stage) => ({
      stage,
      prompt: progress.manual.prompts[stage].text,
      response: progress.responses[stage],
    }));
    const receipt = {
      schemaVersion: 1,
      ...status(state),
      executionMode: state.execution.mode === "fixture" ? "fixture" : "host",
      createdAt: state.createdAt,
      exportedAt: new Date().toISOString(),
      finalParsing: "manual-final-verbatim",
      finalParsingNote:
        "The canonical final stage returns only the document. It is preserved verbatim; verification is separate.",
      finalAccepted: false,
      workbookRoundTrip: "passed",
      sourceCodeBase: "94cce9ff6b0aee752da80f1ef7ac1c60c6928533",
      scope:
        "One reviewed schema-6 TXT/Markdown file package. No live Studio import, provider adapter or image execution.",
      acceptedStages: state.accepted,
      retention:
        "Local job persists until the user removes it; explicit exports are separate. The chosen host has its own content handling.",
    };
    const files: Record<string, string> = {
      "workbook-progress.html": workbookHtml,
      "final.md": rawFinal,
      "source.md": pkg.sourceText,
      "execution-receipt.json": JSON.stringify(receipt, null, 2) + "\n",
      "verification-response.txt": progress.responses.verify,
      "review.html": renderReview({
        documentName: pkg.documentName,
        sourceText: pkg.sourceText,
        finalText: rawFinal,
        stages: stageRecords,
        receipt,
      }),
    };
    for (const stage of STAGES) files[`${stage}-response.txt`] = progress.responses[stage];
    for (const [name, content] of Object.entries(files))
      await immutable(join(output, name), content);
    const hashes =
      Object.entries(files)
        .map(([name, content]) => `${hash(content)}  ${name}`)
        .join("\n") + "\n";
    await immutable(join(output, "SHA256SUMS.txt"), hashes);
    return {
      output,
      reviewPath: join(output, "review.html"),
      workbookPath: join(output, "workbook-progress.html"),
      finalPath: join(output, "final.md"),
      receiptPath: join(output, "execution-receipt.json"),
      complete: status(state).complete,
      reviewRequired: true,
    };
  });
}
