// Actual product UI and dispatcher with an OFFLINE completion substitute. Zero model calls.
import { chromium } from "playwright";
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { hash } from "./contract.mjs";
import { terminalExecArgs } from "./terminal-policy.mjs";
const parent = resolve("output/studio/repeatable-handoff");
await mkdir(parent, { recursive: true });
const out = await mkdtemp(join(parent, "browser-offline-"));
await build({
  entryPoints: ["local-companion/handoff/test-entry.mjs"],
  outfile: join(out, "entry.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  logLevel: "silent",
  plugins: [
    {
      name: "raw",
      setup(b) {
        b.onResolve({ filter: /\?raw$/ }, (a) => ({
          path: resolve(a.resolveDir, a.path.slice(0, -4)),
          namespace: "raw",
        }));
        b.onLoad({ filter: /.*/, namespace: "raw" }, async (a) => ({
          contents: `export default ${JSON.stringify(await readFile(a.path, "utf8"))}`,
          loader: "js",
        }));
      },
    },
  ],
});
const m = await import(pathToFileURL(join(out, "entry.mjs")).href);
const fixture = await m.createImageFixture();
await writeFile(join(out, "owned-offline.png"), fixture.referenceBytes);
let launches = 0,
  finish = true;
const service = await m.createService({
  root: join(out, "state"),
  dist: resolve("dist"),
  handoffReviewer: resolve("local-companion/handoff/review-launch.mjs"),
  terminalRunner: resolve("local-companion/handoff/terminal-run.mjs"),
  terminalRepeatable: true,
  handoffTerminalCheck: async () => ({
    executor: "OFFLINE SUBSTITUTED TASK",
    model: "fixture",
    effort: "medium",
  }),
  handoffOpenTerminal: async (file) => {
    launches++;
    const dir = dirname(file),
      intent = JSON.parse(await readFile(join(dir, "dispatch-intent.json")));
    const verified = await m.inspectReview(dir, intent.snapshotSha256);
    assert.equal(hash(verified.files["prompt.txt"]), intent.promptSha256);
    assert.equal(hash(verified.files["reference.png"]), intent.referenceSha256);
    if (!finish) return; // Deliberately retained uncertainty, never provider execution.
    const taskId = randomUUID(),
      binding = {
        handoffId: intent.handoffId,
        snapshotSha256: intent.snapshotSha256,
        dispatchId: intent.id,
      };
    const input = Buffer.from(
      JSON.stringify({
        args: terminalExecArgs(dir),
        stdinSha256: intent.promptSha256,
        referenceSha256: intent.referenceSha256,
        executor: "OFFLINE SUBSTITUTE",
      }),
    );
    const stdout = Buffer.from(
        [
          { type: "thread.started", thread_id: taskId },
          { type: "turn.started" },
          {
            type: "item.completed",
            item: {
              type: "agent_message",
              text: "OFFLINE FIXTURE: no image generated",
            },
          },
          { type: "turn.completed" },
        ]
          .map((x) => JSON.stringify(x))
          .join("\n") + "\n",
      ),
      stderr = Buffer.alloc(0);
    for (const [name, b] of [
      ["native-input.json", input],
      ["native-stdout.jsonl", stdout],
      ["native-stderr.txt", stderr],
    ])
      await writeFile(join(dir, name), b, { flag: "wx" });
    await writeFile(
      join(dir, "native-start-claimed.json"),
      JSON.stringify({
        kind: "reword-terminal-native-start",
        ...binding,
        executor: "OFFLINE SUBSTITUTE",
      }),
      { flag: "wx" },
    );
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
        actualExecutor: "OFFLINE SUBSTITUTE — NO MODEL",
        raw: Object.fromEntries(
          [
            ["input", input],
            ["stdout", stdout],
            ["stderr", stderr],
          ].map(([n, b]) => [n, { sha256: hash(b), byteLength: b.length }]),
        ),
      }),
      { flag: "wx" },
    );
  },
});
const origin = new URL(service.url).origin;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/*", (r) =>
  /^https?:/.test(r.request().url()) &&
  !r
    .request()
    .url()
    .startsWith(origin + "/")
    ? r.abort()
    : r.continue(),
);
try {
  await page.goto(origin + "/?mode=images");
  await page
    .getByRole("button", { name: "START LOCAL SESSION", exact: true })
    .click();
  await page
    .getByLabel("Add image files")
    .setInputFiles(join(out, "owned-offline.png"));
  await page
    .getByRole("button", { name: "CONFIRM IMAGE SET", exact: true })
    .click();
  await page
    .getByRole("button", { name: "BUILD PACKAGE", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review in Runs", exact: true })
    .click();
  const panel = page.getByRole("article", {
    name: "Send to harness",
    exact: true,
  });
  await panel.getByRole("checkbox", { name: /I reviewed this source/ }).check();
  await panel
    .getByRole("button", { name: "Review handoff", exact: true })
    .click();
  const confirmation = panel.getByRole("checkbox", {
    name: /I checked the outgoing/,
  });
  const start = panel.getByRole("button", {
    name: "Start one Codex terminal task",
    exact: true,
  });
  assert(await start.isDisabled());
  await confirmation.check();
  await start.focus();
  await page.keyboard.press("Enter");
  await panel.getByText(/Status: task-ended-review-pending/).waitFor();
  assert.equal(launches, 1);
  const getState = () =>
    page.evaluate(async () => ({
      ...(await (await fetch("/api/handoff/status")).json()),
      cap: await (await fetch("/api/handoff/capabilities")).json(),
    }));
  let state = await getState();
  const first = state.handoffs[0];
  const duplicateResults = await page.evaluate(
    async ({ id, seal, token }) =>
      Promise.all(
        [0, 1].map(async () => {
          const r = await fetch("/api/handoff/dispatch", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-reword-session": token,
            },
            body: JSON.stringify({ id, snapshotSha256: seal }),
          });
          return { status: r.status, data: await r.json() };
        }),
      ),
    { id: first.id, seal: first.snapshotSha256, token: state.cap.session },
  );
  assert(
    duplicateResults.every(
      (r) => r.status === 200 && r.data.handoff.id === first.id,
    ),
  );
  assert.equal(launches, 1);
  await panel
    .getByRole("button", {
      name: "Prepare explicit resend for review",
      exact: true,
    })
    .click();
  await panel.getByText(/Status: prepared/).waitFor();
  assert(await start.isDisabled());
  await confirmation.check();
  await start.click();
  await panel.getByText(/Status: task-ended-review-pending/).waitFor();
  assert.equal(launches, 2);
  state = await getState();
  const second = state.handoffs.find((r) => r.resendOf === first.id);
  assert(second);
  assert.notEqual(second.id, first.id);
  assert.equal(second.promptSha256, first.promptSha256);
  assert.equal(second.referenceSha256, first.referenceSha256);
  const downloads = {};
  for (const name of [
    "reference.png",
    "prompt.txt",
    "package.zip",
    "task-outcome.json",
  ]) {
    const p = page.waitForEvent("download");
    await panel.getByRole("link", { name, exact: true }).click();
    const d = await p;
    await d.saveAs(join(out, name));
    const b = await readFile(join(out, name));
    downloads[name] = { sha256: hash(b), byteLength: b.length };
  }
  assert.equal(downloads["reference.png"].sha256, first.referenceSha256);
  assert.equal(downloads["prompt.txt"].sha256, first.promptSha256);
  const widths = [];
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    widths.push(
      await page.evaluate(() => ({
        width: globalThis.innerWidth,
        scrollWidth: globalThis.document.documentElement.scrollWidth,
      })),
    );
  }
  assert(widths.every((w) => w.width === w.scrollWidth));
  await page.screenshot({
    path: join(out, "repeatable-mobile.png"),
    fullPage: true,
  });
  for (const mode of ["Text", "Images", "Projects", "Runs"]) {
    await page
      .getByRole("navigation", { name: "Workspace modes" })
      .getByRole("button", { name: mode, exact: true })
      .click();
    await page.screenshot({
      path: join(out, mode.toLowerCase() + ".png"),
      fullPage: true,
    });
  }
  assert(await confirmation.isChecked());
  assert.equal((await getState()).handoffs.length, 2);
  await page.keyboard.press("Control+k");
  assert.equal(await page.getByRole("dialog").count(), 0);
  finish = false;
  await panel
    .getByRole("button", {
      name: "Prepare explicit resend for review",
      exact: true,
    })
    .click();
  await panel.getByText(/Status: prepared/).waitFor();
  await confirmation.check();
  await start.click();
  await panel.getByText(/Status: task-dispatch-claimed/).waitFor();
  await page.waitForFunction(async () => {
    const c = await (await fetch("/api/handoff/capabilities")).json();
    return !c.terminalTaskAvailable && Boolean(c.activeHandoffId);
  });
  assert.equal(launches, 3);
  await page.reload();
  state = await getState();
  assert.equal(state.handoffs.length, 3);
  assert.equal(launches, 3);
  assert.equal(state.cap.terminalTaskAvailable, false);
  assert.equal(errors.length, 0);
  const receipt = {
    kind: "offline-repeatable-product-fixture",
    modelCalls: 0,
    realTaskDispatches: 0,
    substituteLaunches: launches,
    completedSubstitutes: 2,
    uncertainSubstitutes: 1,
    duplicateRequestsDidNotLaunch: true,
    resendLineage: second.resendOf,
    downloadCustody: downloads,
    widths,
    modeRetention: true,
    reloadNoLaunch: true,
    errors,
    out,
  };
  await writeFile(join(out, "receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
} catch (e) {
  await page.screenshot({ path: join(out, "failure.png"), fullPage: true });
  await writeFile(
    join(out, "failure-dom.txt"),
    (await page.locator("body").innerText()).slice(0, 40000),
  );
  throw e;
} finally {
  await browser.close();
  await service.close();
}
