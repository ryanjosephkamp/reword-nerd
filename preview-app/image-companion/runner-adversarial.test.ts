import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FIXTURE_CAPABILITY, HOST_DISCOVERY } from "./capabilities";
import { createImageFixture, type ImageFixture } from "./fixtures";
import { hash } from "./io";
import { exportJob, getStatus, nextAttempt, prepareJob, recordFailure, recordResult, type HostOutputReceipt, type ImageTicket } from "./runner";

const execution = { mode: "fixture", host: "deterministic-fixture", model: "none" } as const;
const roots: string[] = [];
let fixture: ImageFixture;
beforeAll(async () => { fixture = await createImageFixture(); });
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function setup() {
  const base = resolve("output/studio/image-companion-qa");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "adversarial-")); roots.push(root);
  const packagePath = join(root, "package.zip"), resultPath = join(root, "result.png"), receiptPath = join(root, "receipt.json"), job = join(root, "job");
  await writeFile(packagePath, fixture.packageBytes);
  await writeFile(resultPath, fixture.resultBytes);
  await prepareJob(packagePath, job, execution);
  const task = await nextAttempt(job, { capability: FIXTURE_CAPABILITY });
  await writeReceipt(receiptPath, task.ticket, fixture.resultBytes);
  return { root, packagePath, resultPath, receiptPath, job, task };
}

function receipt(ticket: ImageTicket, bytes: Uint8Array): HostOutputReceipt {
  return { schemaVersion: 1, ticketId: ticket.ticketId, referenceSha256: ticket.referenceSha256, promptSha256: ticket.promptSha256, outputSha256: hash(bytes), executor: "deterministic-fixture", model: "none", tool: null };
}
async function writeReceipt(path: string, ticket: ImageTicket, bytes: Uint8Array, overrides: Partial<HostOutputReceipt> = {}) {
  await writeFile(path, JSON.stringify({ ...receipt(ticket, bytes), ...overrides }));
}

describe("image runner independent custody and interruption checks", () => {
  it("keeps a pending ticket stable and exports exact raw input, output, prompt and fixture identity", async () => {
    const h = await setup();
    expect(await nextAttempt(h.job)).toEqual(h.task);
    const saved = await recordResult(h.job, h.task.ticketPath, h.resultPath, h.receiptPath);
    expect(saved).toMatchObject({ idempotent: false, reviewRequired: true, result: { identicalToReference: false } });
    expect(await recordResult(h.job, h.task.ticketPath, h.resultPath, h.receiptPath)).toMatchObject({ idempotent: true });
    const status = await getStatus(h.job);
    expect(status).toMatchObject({ status: "awaiting-user-review", acceptedByUser: false, reviewRequired: true, execution });
    const out = join(h.root, "export");
    await exportJob(h.job, out);
    expect(new Uint8Array(await readFile(join(out, "package.zip")))).toEqual(fixture.packageBytes);
    expect(new Uint8Array(await readFile(join(out, "reference.png")))).toEqual(fixture.referenceBytes);
    expect(new Uint8Array(await readFile(join(out, "raw", `${h.task.ticket.ticketId}.png`)))).toEqual(fixture.resultBytes);
    expect(await readFile(join(out, "prompt.txt"))).toEqual(await readFile(h.task.promptPath));
    expect(JSON.parse(await readFile(join(out, "audit.json"), "utf8"))).toMatchObject({ reviewRequired: true, acceptedByUser: false });
  });

  it("rejects wrong-job and superseded tickets before accepting an output", async () => {
    const h = await setup(), other = await setup();
    await expect(recordResult(h.job, other.task.ticketPath, h.resultPath, h.receiptPath)).rejects.toMatchObject({ code: "WRONG_JOB" });
    const current = await nextAttempt(h.job, { retry: true, capability: FIXTURE_CAPABILITY });
    expect(current.ticket.ticketId).not.toBe(h.task.ticket.ticketId);
    await expect(recordResult(h.job, h.task.ticketPath, h.resultPath, h.receiptPath)).rejects.toMatchObject({ code: "STALE_TICKET" });
    await writeReceipt(h.receiptPath, current.ticket, fixture.resultBytes);
    await recordResult(h.job, current.ticketPath, h.resultPath, h.receiptPath);
    expect((await getStatus(h.job)).attempts.map(attempt => attempt.status)).toEqual(["superseded", "recorded"]);
  });

  it("rejects incorrect reference, prompt, output and fixture execution labels without consuming the ticket", async () => {
    const h = await setup();
    for (const field of ["referenceSha256", "promptSha256", "outputSha256"] as const) {
      await writeReceipt(h.receiptPath, h.task.ticket, fixture.resultBytes, { [field]: "0".repeat(64) });
      await expect(recordResult(h.job, h.task.ticketPath, h.resultPath, h.receiptPath)).rejects.toMatchObject({ code: "WRONG_OUTPUT" });
    }
    for (const overrides of [{ executor: "real model" }, { model: "claimed-provider" }, { tool: "image_gen.imagegen" }]) {
      await writeReceipt(h.receiptPath, h.task.ticket, fixture.resultBytes, overrides);
      await expect(recordResult(h.job, h.task.ticketPath, h.resultPath, h.receiptPath)).rejects.toMatchObject({ code: "EXECUTION_LABEL" });
    }
    expect((await getStatus(h.job)).status).toBe("pending");
    await writeReceipt(h.receiptPath, h.task.ticket, fixture.resultBytes);
    await expect(recordResult(h.job, h.task.ticketPath, h.resultPath, h.receiptPath)).resolves.toMatchObject({ idempotent: false });
  });

  it("rejects invalid PNGs and explicitly identifies an unchanged reference without accepting it for the user", async () => {
    const h = await setup();
    await writeFile(h.resultPath, "not an image");
    await expect(recordResult(h.job, h.task.ticketPath, h.resultPath, h.receiptPath)).rejects.toThrow(/PNG/u);
    expect((await getStatus(h.job)).status).toBe("pending");
    await writeFile(h.resultPath, fixture.referenceBytes);
    await writeReceipt(h.receiptPath, h.task.ticket, fixture.referenceBytes);
    expect(await recordResult(h.job, h.task.ticketPath, h.resultPath, h.receiptPath)).toMatchObject({ result: { identicalToReference: true }, reviewRequired: true });
    expect(await getStatus(h.job)).toMatchObject({ acceptedByUser: false, status: "awaiting-user-review" });
  });

  it("resumes after exact result bytes were saved before receipt/state persistence", async () => {
    const h = await setup();
    await writeFile(join(h.job, "results", `${h.task.ticket.ticketId}.png`), fixture.resultBytes, { flag: "wx" });
    await expect(recordResult(h.job, h.task.ticketPath, h.resultPath, h.receiptPath)).resolves.toMatchObject({ idempotent: false });
    expect((await getStatus(h.job)).status).toBe("awaiting-user-review");
  });

  it("refuses to overwrite conflicting orphan bytes during interruption recovery", async () => {
    const h = await setup();
    const orphan = join(h.job, "results", `${h.task.ticket.ticketId}.png`);
    await writeFile(orphan, fixture.referenceBytes, { flag: "wx" });
    await expect(recordResult(h.job, h.task.ticketPath, h.resultPath, h.receiptPath)).rejects.toThrow();
    expect(new Uint8Array(await readFile(orphan))).toEqual(fixture.referenceBytes);
    expect((await getStatus(h.job)).status).toBe("pending");
  });

  it("resumes when both immutable output files precede the state commit", async () => {
    const h = await setup();
    const pendingState = await readFile(join(h.job, "state.json"));
    await recordResult(h.job, h.task.ticketPath, h.resultPath, h.receiptPath);
    // Recreate the interruption boundary after image + metadata persisted but before state rename.
    await writeFile(join(h.job, "state.json"), pendingState);
    expect((await getStatus(h.job)).status).toBe("pending");
    await expect(recordResult(h.job, h.task.ticketPath, h.resultPath, h.receiptPath)).resolves.toMatchObject({ idempotent: false });
    expect((await getStatus(h.job)).status).toBe("awaiting-user-review");
  });

  it("rejects a replaced reference symlink without reading or changing its target", async () => {
    const h = await setup();
    const target = join(h.root, "reference-moved.png");
    await rename(join(h.job, "reference.png"), target);
    await symlink(target, join(h.job, "reference.png"));
    await expect(getStatus(h.job)).rejects.toMatchObject({ code: "FILE_LIMIT" });
    expect(new Uint8Array(await readFile(target))).toEqual(fixture.referenceBytes);
  });

  it("leaves a verifiably live lock owner untouched", async () => {
    const h = await setup();
    await mkdir(join(h.job, ".lock"));
    const owner = JSON.stringify({ pid: process.pid, token: "owned-test-lock" });
    await writeFile(join(h.job, ".lock", "owner.json"), owner);
    await expect(getStatus(h.job)).rejects.toMatchObject({ code: "JOB_BUSY" });
    expect(await readFile(join(h.job, ".lock", "owner.json"), "utf8")).toBe(owner);
  });

  it("retains prior outputs on revision and detects later tampering with superseded history", async () => {
    const h = await setup();
    await recordResult(h.job, h.task.ticketPath, h.resultPath, h.receiptPath);
    const revised = await nextAttempt(h.job, { revise: true, capability: FIXTURE_CAPABILITY });
    expect(revised.ticket.revision).toBe(2);
    expect(revised.ticket.priorResultHashes).toEqual([hash(fixture.resultBytes)]);
    const priorResult = join(h.job, "results", `${h.task.ticket.ticketId}.png`);
    expect(new Uint8Array(await readFile(priorResult))).toEqual(fixture.resultBytes);
    expect((await getStatus(h.job)).attempts[0]).toMatchObject({ status: "superseded", result: { sha256: hash(fixture.resultBytes) } });
    await writeFile(priorResult, fixture.referenceBytes);
    await expect(getStatus(h.job)).rejects.toMatchObject({ code: "CUSTODY" });
  });

  it("rejects impossible current statuses that would mislabel an already recorded output", async () => {
    const h = await setup();
    await recordResult(h.job, h.task.ticketPath, h.resultPath, h.receiptPath);
    const saved = JSON.parse(await readFile(join(h.job, "state.json"), "utf8"));
    for (const status of ["failed", "unsupported", "superseded"]) {
      const edited = structuredClone(saved);
      edited.attempts[0].status = status;
      await writeFile(join(h.job, "state.json"), JSON.stringify(edited));
      await expect(getStatus(h.job)).rejects.toMatchObject({ code: "CUSTODY" });
    }
  });

  it("allows one concurrent writer and never replaces the winning result", async () => {
    const h = await setup();
    const alternate = join(h.root, "alternate.png"), alternateReceipt = join(h.root, "alternate.json");
    await writeFile(alternate, fixture.referenceBytes);
    await writeReceipt(alternateReceipt, h.task.ticket, fixture.referenceBytes);
    const results = await Promise.allSettled([
      recordResult(h.job, h.task.ticketPath, h.resultPath, h.receiptPath),
      recordResult(h.job, h.task.ticketPath, alternate, alternateReceipt),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
    expect(["JOB_BUSY", "CONFLICTING_OUTPUT"]).toContain(rejected.reason.code);
    const state = await getStatus(h.job);
    expect(state.attempts).toHaveLength(1);
    expect(state.status).toBe("awaiting-user-review");
    expect([hash(fixture.referenceBytes), hash(fixture.resultBytes)]).toContain(state.attempts[0].result?.sha256);
  });

  it("keeps undiscovered/unauthorized host execution unsupported and failure recording preserves outcomes", async () => {
    const h = await setup();
    const hostJob = join(h.root, "host-job");
    await prepareJob(h.packagePath, hostJob, { mode: "host-assisted", host: "current-task", model: null });
    const task = await nextAttempt(hostJob, { capability: HOST_DISCOVERY });
    expect(task).toMatchObject({ status: "unsupported", toolInvocation: null });
    await writeReceipt(h.receiptPath, task.ticket, fixture.resultBytes, { executor: "current-task", model: null, tool: HOST_DISCOVERY.tool });
    await expect(recordResult(hostJob, task.ticketPath, h.resultPath, h.receiptPath)).rejects.toMatchObject({ code: "NOT_PENDING" });
    await recordFailure(h.job, h.task.ticketPath, "Local fixture execution interrupted.");
    expect(await recordFailure(h.job, h.task.ticketPath, "Local fixture execution interrupted.")).toMatchObject({ idempotent: true });
    expect((await getStatus(h.job)).status).toBe("failed");
  });
});
