// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import JSZip from "jszip";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseWorkbookProgressHtml,
  updateWorkbookResponse,
  createWorkbookProgress,
} from "../src/export/artifacts";
import { createFixturePackage } from "./fixtures";
import { loadPackage } from "./package";
import { prepareJob, nextStage, recordResponse, getStatus, exportJob } from "./runner";

const stages = ["decompose", "rewrite", "verify", "final"] as const;
type Stage = (typeof stages)[number];
let fixture: Uint8Array;
let scratch: string;
let packagePath: string;

beforeAll(async () => {
  fixture = await createFixturePackage();
  await mkdir(resolve("output/studio/runner-qa"), { recursive: true });
});

beforeEach(async () => {
  scratch = await mkdtemp(resolve("output/studio/runner-qa/case-"));
  packagePath = join(scratch, "selected-package.zip");
  await writeFile(packagePath, fixture);
});

afterEach(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

async function prepared(name = "job") {
  const path = join(scratch, name);
  await prepareJob(packagePath, path, { mode: "fixture" });
  return path;
}

async function ticketFor(
  job: string,
  stage?: Stage,
  options: { revise?: boolean; retry?: boolean } = {},
) {
  const request = await nextStage(job, {
    ...(stage ? { stage } : {}),
    ...options,
  });
  if (!request.ticketPath || !request.promptPath)
    throw new Error("Expected a pending stage ticket.");
  return { ticketPath: request.ticketPath, promptPath: request.promptPath };
}

async function responseFile(name: string, value: string | Uint8Array) {
  const path = join(scratch, `${name}.txt`);
  await writeFile(path, value);
  return path;
}

async function recordSyntheticStage(
  job: string,
  stage: Stage,
  value = `Synthetic state-test artifact for ${stage}.`,
) {
  const ticket = await ticketFor(job, stage);
  const path = await responseFile(`${stage}-${Date.now()}`, value);
  return {
    ticket,
    path,
    status: await recordResponse(job, ticket.ticketPath, path),
  };
}

function centralDirectory(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes);
  const end = buffer.length - 22;
  if (buffer.readUInt32LE(end) !== 0x06054b50)
    throw new Error("Expected the fixture's ordinary ZIP end record.");
  const start = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt32LE(start) !== 0x02014b50)
    throw new Error("Expected the fixture's central directory.");
  return { buffer, end, start };
}

describe("companion package trust boundary", () => {
  it("rejects a central/local filename mismatch before accepting the package", async () => {
    const { buffer, start } = centralDirectory(fixture);
    const local = buffer.readUInt32LE(start + 42);
    buffer[local + 30] = buffer[local + 30] === 88 ? 89 : 88;
    await expect(loadPackage(buffer)).rejects.toThrow();
  });

  it("rejects duplicate central entries even when they reference the same valid local bytes", async () => {
    const { buffer, start, end } = centralDirectory(fixture);
    const entryLength =
      46 +
      buffer.readUInt16LE(start + 28) +
      buffer.readUInt16LE(start + 30) +
      buffer.readUInt16LE(start + 32);
    const duplicate = buffer.subarray(start, start + entryLength);
    const rewrittenEnd = Buffer.from(buffer.subarray(end));
    rewrittenEnd.writeUInt16LE(rewrittenEnd.readUInt16LE(8) + 1, 8);
    rewrittenEnd.writeUInt16LE(rewrittenEnd.readUInt16LE(10) + 1, 10);
    rewrittenEnd.writeUInt32LE(rewrittenEnd.readUInt32LE(12) + entryLength, 12);
    await expect(
      loadPackage(Buffer.concat([buffer.subarray(0, end), duplicate, rewrittenEnd])),
    ).rejects.toThrow();
  });

  it("rejects a modified prompt even if an attacker recomputes its manifest hash", async () => {
    const archive = await JSZip.loadAsync(fixture);
    const manifest = JSON.parse(await archive.file("manifest.json")!.async("string"));
    const record = manifest.documents[0].prompts.rewrite;
    const altered = `${await archive.file(record.path)!.async("string")}\nUnapproved extra prompt instruction.\n`;
    archive.file(record.path, altered, { createFolders: false });
    record.sha256 = createHash("sha256").update(altered).digest("hex");
    archive.file("manifest.json", JSON.stringify(manifest), {
      createFolders: false,
    });
    await expect(
      loadPackage(
        await archive.generateAsync({
          type: "uint8array",
          compression: "DEFLATE",
        }),
      ),
    ).rejects.toThrow(/canonical/u);
  });

  it("bounds decompression by the declared expanded size before interpreting artifacts", async () => {
    const archive = new JSZip();
    archive.file("payload.bin", "x".repeat(64 * 1024), {
      createFolders: false,
    });
    const { buffer, start } = centralDirectory(
      await archive.generateAsync({
        type: "uint8array",
        compression: "DEFLATE",
      }),
    );
    const local = buffer.readUInt32LE(start + 42);
    buffer.writeUInt32LE(1, start + 24);
    buffer.writeUInt32LE(1, local + 22);
    await expect(loadPackage(buffer)).rejects.toThrow(/exceeds its declared expanded size/u);
  });
});

describe("companion response and persisted-state boundary", () => {
  it("preserves an existing job and an existing export directory", async () => {
    const job = await prepared();
    const state = await readFile(join(job, "state.json"));
    await expect(prepareJob(packagePath, job)).rejects.toThrow();
    expect(await readFile(join(job, "state.json"))).toEqual(state);
    const exported = join(scratch, "existing-export");
    await mkdir(exported);
    await writeFile(join(exported, "keep.txt"), "Do not overwrite this unrelated artifact.");
    await expect(exportJob(job, exported)).rejects.toThrow();
    expect(await readdir(exported)).toEqual(["keep.txt"]);
    expect(await readFile(join(exported, "keep.txt"), "utf8")).toBe(
      "Do not overwrite this unrelated artifact.",
    );
  });

  it("leaves a live owner's lock untouched and resumes after that owner releases it", async () => {
    const job = await prepared();
    const lockDir = join(job, ".lock");
    const owner = JSON.stringify({
      pid: process.pid,
      token: "synthetic-live-owner",
    });
    await mkdir(lockDir);
    await writeFile(join(lockDir, "owner.json"), owner);
    await expect(nextStage(job)).rejects.toThrow(/owns this job/u);
    expect(await readFile(join(lockDir, "owner.json"), "utf8")).toBe(owner);
    await rm(lockDir, { recursive: true });
    await expect(nextStage(job)).resolves.toHaveProperty("ticketPath");
  });

  it("refuses an unverifiable interrupted lock without deleting its contents", async () => {
    const job = await prepared();
    const lockDir = join(job, ".lock");
    await mkdir(lockDir);
    await writeFile(join(lockDir, "owner.json"), "incomplete interrupted write");
    await expect(nextStage(job)).rejects.toThrow(/could not be verified/u);
    expect(await readFile(join(lockDir, "owner.json"), "utf8")).toBe(
      "incomplete interrupted write",
    );
  });

  it("refuses linked job, artifact, and response paths without writing to their targets", async () => {
    const job = await prepared();
    const linkedJob = join(scratch, "linked-job");
    await symlink(job, linkedJob, "dir");
    await expect(nextStage(linkedJob)).rejects.toThrow();
    const ticket = await ticketFor(job);
    const response = await responseFile("real-response", "Synthetic response behind a link.");
    const linkedResponse = join(scratch, "linked-response.txt");
    await symlink(response, linkedResponse);
    await expect(recordResponse(job, ticket.ticketPath, linkedResponse)).rejects.toThrow();
    expect(await readFile(response, "utf8")).toBe("Synthetic response behind a link.");
    const target = join(scratch, "unrelated-responses");
    await mkdir(target);
    await rm(join(job, "responses"), { recursive: true });
    await symlink(target, join(job, "responses"), "dir");
    await expect(recordResponse(job, ticket.ticketPath, response)).rejects.toThrow();
    expect(await readdir(target)).toEqual([]);
  });

  it("detects corruption of the preserved selected package", async () => {
    const job = await prepared();
    const bytes = Buffer.from(fixture);
    bytes[0] ^= 1;
    await writeFile(join(job, "package.zip"), bytes);
    await expect(getStatus(job)).rejects.toThrow();
    expect(await readFile(packagePath)).toEqual(Buffer.from(fixture));
  });

  it("detects modified pending prompt bytes without accepting their response", async () => {
    const job = await prepared();
    const request = await ticketFor(job);
    await writeFile(request.promptPath, "A modified instruction outside the canonical package.");
    await expect(nextStage(job)).rejects.toThrow(/prompt was modified/u);
    await expect(
      recordResponse(
        job,
        request.ticketPath,
        await responseFile("modified-prompt", "Synthetic response."),
      ),
    ).rejects.toThrow(/prompt was modified/u);
    expect(await readdir(join(job, "responses"))).toEqual([]);
  });

  it("detects modified accepted response bytes instead of hydrating a new downstream prompt", async () => {
    const job = await prepared();
    await recordSyntheticStage(job, "decompose");
    const state = JSON.parse(await readFile(join(job, "state.json"), "utf8"));
    await writeFile(join(job, state.accepted.decompose.responsePath), "An unrecorded edit.");
    await expect(nextStage(job)).rejects.toThrow(/recorded response has changed/u);
  });

  it("rejects a pending ticket with a foreign identity even when its stored copy agrees", async () => {
    const job = await prepared();
    const request = await ticketFor(job);
    const statePath = join(job, "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.active.ticket.jobId = "different-job-identity";
    await writeFile(statePath, JSON.stringify(state));
    await writeFile(request.ticketPath, JSON.stringify(state.active.ticket));
    await expect(nextStage(job)).rejects.toThrow();
    await expect(
      recordResponse(
        job,
        request.ticketPath,
        await responseFile("corrupt-active", "Synthetic response."),
      ),
    ).rejects.toThrow();
    expect(await readdir(join(job, "responses"))).toEqual([]);
  });

  it("does not issue a later stage before its prerequisite responses exist", async () => {
    const job = await prepared();
    await expect(nextStage(job, { stage: "rewrite" })).rejects.toThrow();
    await expect(nextStage(job, { stage: "verify" })).rejects.toThrow();
    await expect(nextStage(job, { stage: "final" })).rejects.toThrow();
  });

  it("reopens one stable pending ticket after the runner module reloads", async () => {
    const job = await prepared();
    const initial = await ticketFor(job);
    expect(await ticketFor(job)).toEqual(initial);
    const before = await getStatus(job);
    vi.resetModules();
    const resumed = await import("./runner");
    const next = await resumed.nextStage(job);
    expect(next.ticketPath).toBe(initial.ticketPath);
    expect(next.promptPath).toBe(initial.promptPath);
    expect(await resumed.getStatus(job)).toEqual(before);
  });

  it("rejects a ticket from a different job even when source and prompts match", async () => {
    const first = await prepared("first");
    const second = await prepared("second");
    await ticketFor(first);
    const foreign = await ticketFor(second);
    const response = await responseFile("foreign", "Synthetic fixture response.");
    const before = await getStatus(first);
    await expect(recordResponse(first, foreign.ticketPath, response)).rejects.toThrow();
    expect(await getStatus(first)).toEqual(before);
  });

  it("rejects altered stage metadata instead of recording a response under the requested name", async () => {
    const job = await prepared();
    const request = await ticketFor(job);
    const forged = JSON.parse(await readFile(request.ticketPath, "utf8"));
    forged.stage = "final";
    const forgedPath = join(scratch, "forged-ticket.json");
    await writeFile(forgedPath, JSON.stringify(forged));
    await expect(
      recordResponse(job, forgedPath, await responseFile("forged", "Synthetic fixture response.")),
    ).rejects.toThrow();
  });

  it("makes duplicate accepted responses idempotent and rejects conflicting reuse", async () => {
    const job = await prepared();
    const accepted = await recordSyntheticStage(job, "decompose");
    const before = await getStatus(job);
    expect((await recordResponse(job, accepted.ticket.ticketPath, accepted.path)).idempotent).toBe(
      true,
    );
    expect(await getStatus(job)).toEqual(before);
    await expect(
      recordResponse(
        job,
        accepted.ticket.ticketPath,
        await responseFile("conflict", "Different response for the same ticket."),
      ),
    ).rejects.toThrow();
    expect(await getStatus(job)).toEqual(before);
  });

  it("supersedes an explicitly retried ticket and refuses its late response", async () => {
    const job = await prepared();
    const first = await ticketFor(job);
    const replacement = await ticketFor(job, "decompose", { retry: true });
    expect(replacement.ticketPath).not.toBe(first.ticketPath);
    await expect(
      recordResponse(job, first.ticketPath, await responseFile("late", "Late fixture response.")),
    ).rejects.toThrow();
    await recordResponse(
      job,
      replacement.ticketPath,
      await responseFile("current", "Current fixture response."),
    );
    await expect(nextStage(job, { stage: "rewrite" })).resolves.toHaveProperty("ticketPath");
  });

  it("retains old artifacts but rejects downstream responses after an upstream revision", async () => {
    const job = await prepared();
    const first = await recordSyntheticStage(job, "decompose", "First synthetic inventory.");
    const rewrite = await recordSyntheticStage(job, "rewrite", "First synthetic rewrite.");
    const oldVerify = await ticketFor(job, "verify");
    const revised = await ticketFor(job, "decompose", { revise: true });
    const invalidated = await getStatus(job);
    expect(invalidated.stages.find((item) => item.stage === "rewrite")).toMatchObject({
      status: "stale",
      previousResponseStale: true,
    });
    expect(invalidated.responseHistory.map((item) => item.status)).toEqual(["stale", "stale"]);
    await recordResponse(
      job,
      revised.ticketPath,
      await responseFile("revised", "Revised synthetic inventory."),
    );
    await expect(
      recordResponse(
        job,
        oldVerify.ticketPath,
        await responseFile("stale-verify", "Verification of the obsolete rewrite."),
      ),
    ).rejects.toThrow();
    await expect(nextStage(job, { stage: "verify" })).rejects.toThrow();
    const newRewrite = await ticketFor(job, "rewrite");
    expect(await readFile(newRewrite.promptPath, "utf8")).toContain("Revised synthetic inventory.");
    expect(await readFile(first.ticket.ticketPath, "utf8")).not.toBe("");
    expect(await readFile(rewrite.ticket.ticketPath, "utf8")).not.toBe("");
    const current = await getStatus(job);
    expect(current.responseHistory.map((item) => item.status)).toEqual([
      "stale",
      "stale",
      "current",
    ]);
    expect(current.stages.find((item) => item.stage === "rewrite")).toMatchObject({
      status: "awaiting-response",
      previousResponseStale: true,
    });
    for (const old of current.responseHistory.filter((item) => item.status === "stale")) {
      const retained = await readFile(join(job, old.responsePath));
      expect(createHash("sha256").update(retained).digest("hex")).toBe(old.responseSha256);
    }
  });

  it("detects changed stale response bytes while keeping the replacement pending", async () => {
    const job = await prepared();
    await recordSyntheticStage(job, "decompose", "Original inventory retained as evidence.");
    const original = (await getStatus(job)).responseHistory[0];
    const retainedPath = join(job, original.responsePath);
    const originalBytes = await readFile(retainedPath);
    const replacement = await ticketFor(job, "decompose", { revise: true });
    await writeFile(retainedPath, "Changed stale response.");
    await expect(getStatus(job)).rejects.toMatchObject({ code: "RESPONSE_CHANGED" });
    await expect(nextStage(job)).rejects.toMatchObject({ code: "RESPONSE_CHANGED" });
    await writeFile(retainedPath, originalBytes);
    expect((await nextStage(job)).ticketPath).toBe(replacement.ticketPath);
    expect((await getStatus(job)).responseHistory[0].status).toBe("stale");
  });

  it.each([
    ["empty", "  \r\n\t  "],
    ["invalid UTF-8", new Uint8Array([0xc3, 0x28])],
    ["over the response limit", "x".repeat(1024 * 1024 + 1)],
  ])("rejects %s response bytes without advancing the job", async (_name, value) => {
    const job = await prepared();
    const request = await ticketFor(job);
    const before = await getStatus(job);
    await expect(
      recordResponse(job, request.ticketPath, await responseFile("invalid", value)),
    ).rejects.toThrow();
    expect(await getStatus(job)).toEqual(before);
  });

  it("keeps exact Unicode and whitespace through canonical hydration and standalone workbook export", async () => {
    const job = await prepared();
    const loaded = await loadPackage(fixture);
    let expected = createWorkbookProgress(loaded.workbook);
    const responses: Record<Stage, string> = {
      decompose: "\uFEFF\tSynthetic inventory: café, 東京, 😀.\r\nKeep these exact bytes.  \r\n",
      rewrite: "\nSynthetic rewrite — naïve / Ελληνικά.  \n\n",
      verify: "\tSynthetic verification: retained whitespace.\r\n",
      final:
        "<<<FINAL_DOCUMENT>>>\r\n# Synthetic final document\r\n\r\nUnicode: café, 東京, 😀.  \r\n<<<END_FINAL_DOCUMENT>>>\r\n<<<FIDELITY_AUDIT>>>\r\nLiteral marker-like text is part of this manual-stage document.\r\n<<<END_FIDELITY_AUDIT>>>\r\n",
    };
    for (const stage of stages) {
      const request = await ticketFor(job, stage);
      expect(await readFile(request.promptPath, "utf8")).toBe(expected.manual.prompts[stage].text);
      await recordResponse(job, request.ticketPath, await responseFile(stage, responses[stage]));
      expected = updateWorkbookResponse(loaded.workbook, expected, stage, responses[stage]);
    }
    await expect(nextStage(job)).resolves.toHaveProperty("complete", true);
    const exported = join(scratch, "exported");
    await exportJob(job, exported);
    const htmlFiles = (await readdir(exported)).filter((name) => name.endsWith(".html"));
    const candidates = await Promise.all(
      htmlFiles.map((name) => readFile(join(exported, name), "utf8")),
    );
    const workbook = candidates.find((html) => html.includes('id="workbook-data"'));
    expect(workbook).toBeDefined();
    const parsed = parseWorkbookProgressHtml(loaded.workbook, workbook!);
    for (const stage of stages) expect(parsed.responses[stage]).toBe(responses[stage]);
    expect(parsed.manual.prompts).toEqual(expected.manual.prompts);
    expect(await readFile(join(exported, "final.md"), "utf8")).toBe(responses.final);
    expect(Buffer.from(await readFile(packagePath))).toEqual(Buffer.from(fixture));
  });
});
