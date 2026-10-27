import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCustomProfile } from "../src/domain/profiles";
import { DEFAULT_SETTINGS } from "../src/domain/settings";
import { parseWorkbookProgressHtml } from "../src/export/artifacts";
import { createFixturePackage, FIXTURE_SOURCE } from "./fixtures";
import { loadPackage } from "./package";
import { exportJob, getStatus, nextStage, prepareJob, recordResponse } from "./runner";

const stages = ["decompose", "rewrite", "verify", "final"] as const;
type Stage = typeof stages[number];
const markers = [
  "<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>",
  "<<<INSERT_STAGE_2_REWRITE_RESPONSE>>>",
  "<<<INSERT_STAGE_3_VERIFICATION_RESPONSE>>>",
] as const;
const unsafeTokens = [...markers, "$&", "$$", "$`", "$'"];
let fixture: Uint8Array;
let scratch: string;

beforeAll(async () => {
  fixture = await createFixturePackage();
  await mkdir(resolve("output/.runner-hydration-tests"), { recursive: true });
});
beforeEach(async () => {
  scratch = await mkdtemp(resolve("output/.runner-hydration-tests/case-"));
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function prepared() {
  const selected = join(scratch, "selected.zip");
  await writeFile(selected, fixture);
  const job = join(scratch, "job");
  await prepareJob(selected, job, { mode: "fixture" });
  return job;
}

async function ticketFor(job: string, stage: Stage) {
  const ticket = await nextStage(job, { stage });
  if (!ticket.ticketPath || !ticket.promptPath) throw new Error("Expected a prepared stage ticket.");
  return { ticketPath: ticket.ticketPath, promptPath: ticket.promptPath };
}

async function acceptSafeStage(job: string, stage: Stage) {
  const ticket = await ticketFor(job, stage);
  const inbox = join(job, "inbox", `${stage}-safe.txt`);
  await writeFile(inbox, `Synthetic ${stage} artifact with preserved café and whitespace.  \r\n`);
  await recordResponse(job, ticket.ticketPath, inbox);
}

describe("canonical marker collisions before job creation", () => {
  const collisions = ["source", "custom requirements", "custom profile"]
    .flatMap((location) => markers.map((marker) => ({ location, marker })));

  it.each(collisions)("preserves $location containing $marker in a newly rendered package", async ({ location, marker }) => {
    const bytes = await createFixturePackage({
      ...(location === "source" ? { text: `${FIXTURE_SOURCE}\nLiteral ${marker} in the source.\n` } : {}),
      ...(location === "custom requirements" ? { settings: { ...DEFAULT_SETTINGS, customRequirements: `Preserve ${marker} literally.` } } : {}),
      ...(location === "custom profile" ? { profile: createCustomProfile(`Model ${marker}`, null) } : {}),
    });
    const selected = join(scratch, "collision.zip");
    const job = join(scratch, "must-not-exist");
    await writeFile(selected, bytes);
    await expect(loadPackage(bytes)).resolves.toHaveProperty("sourceText");
    await expect(prepareJob(selected, job, { mode: "fixture" })).resolves.toBeDefined();
    expect(await readFile(selected)).toEqual(Buffer.from(bytes));
  });
});

describe("literal prerequisite-response custody", () => {
  it("preserves all tokens through all four stages without recursive substitution", async () => {
    const job = await prepared();
    const responses: Partial<Record<Stage, string>> = {};
    for (const stage of stages) {
      const ticket = await ticketFor(job, stage);
      const prompt = await readFile(ticket.promptPath, "utf8");
      for (const prior of stages.slice(0, stages.indexOf(stage))) expect(prompt).toContain(responses[prior]);
      const content = `\uFEFF  ${stage} café\r\n${unsafeTokens.join("\r\n")}\r\n  `;
      responses[stage] = content;
      const inbox = join(job, "inbox", `${stage}-literal.txt`);
      await writeFile(inbox, content);
      await expect(recordResponse(job, ticket.ticketPath, inbox)).resolves.toHaveProperty("idempotent", false);
      await expect(recordResponse(job, ticket.ticketPath, inbox)).resolves.toHaveProperty("idempotent", true);
    }
    const destination = join(scratch, "export");
    await exportJob(job, destination);
    const loaded = await loadPackage(fixture);
    const progress = parseWorkbookProgressHtml(loaded.workbook, await readFile(join(destination, "workbook-progress.html"), "utf8"));
    for (const stage of stages) expect(progress.responses[stage]).toBe(responses[stage]);
    expect(await readFile(join(destination, "final.md"), "utf8")).toBe(responses.final);
    expect((await getStatus(job)).complete).toBe(true);
  });
});

describe("manual final-stage literal output", () => {
  it("preserves marker strings and replacement tokens verbatim in final export and workbook progress", async () => {
    const job = await prepared();
    for (const stage of stages.slice(0, 3)) await acceptSafeStage(job, stage);
    const ticket = await ticketFor(job, "final");
    const final = `\uFEFF# Literal token reference 🌱\r\n\r\n${unsafeTokens.join("\r\n")}\r\nTrailing spaces stay.  \r\n`;
    const inbox = join(job, "inbox", "final-verbatim.txt");
    await writeFile(inbox, final);
    await expect(recordResponse(job, ticket.ticketPath, inbox)).resolves.toHaveProperty("idempotent", false);
    const destination = join(scratch, "export");
    await exportJob(job, destination);
    expect(await readFile(inbox, "utf8")).toBe(final);
    expect(await readFile(join(destination, "final.md"), "utf8")).toBe(final);
    const loaded = await loadPackage(fixture);
    const progress = parseWorkbookProgressHtml(loaded.workbook, await readFile(join(destination, "workbook-progress.html"), "utf8"));
    expect(progress.responses.final).toBe(final);
    expect((await getStatus(job)).complete).toBe(true);
  });
});

it("loads a preserved real pre-fix export without changing original bytes", async () => {
  const bytes = await readFile(resolve("companion/testdata/pre-hydration-fix.zip"));
  const loaded = await loadPackage(bytes);
  expect(loaded.workbook.promptBundle.manualBindings).toBeDefined();
  expect(bytes).toEqual(await readFile(resolve("companion/testdata/pre-hydration-fix.zip")));
});
