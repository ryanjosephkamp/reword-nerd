// Owned browser fixture. No model start exists in the terminal reviewer.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
const url = new URL(process.argv[2] ?? "http://invalid/");
if (
  url.protocol !== "http:" ||
  url.hostname !== "127.0.0.1" ||
  !url.port ||
  url.pathname !== "/" ||
  url.search ||
  url.hash
)
  throw Error("Select this test's owned loopback demo URL explicitly");
const origin = url.origin;
const openTerminal = process.argv.includes("--open-terminal-review");
const out = fs.mkdtempSync(
  path.resolve("output/studio/harness-handoff") + "/browser-",
);
const sha = (b) => createHash("sha256").update(b).digest("hex");
await build({
  entryPoints: ["image-companion/fixtures.ts"],
  outfile: path.join(out, "fixtures.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  logLevel: "silent",
});
const { createImageFixture } = await import(
  pathToFileURL(path.join(out, "fixtures.mjs")).href
);
const reference = Buffer.from((await createImageFixture()).referenceBytes);
const payload = Buffer.from("opaque metadata <script>notExecutable()</script>");
const box = Buffer.alloc(payload.length + 8);
box.writeUInt32BE(box.length, 0);
box.write("jumb", 4);
payload.copy(box, 8);
const chunk = Buffer.alloc(box.length + 12);
chunk.writeUInt32BE(box.length, 0);
chunk.write("caBX", 4);
box.copy(chunk, 8);
chunk.writeUInt32BE(
  crc32(chunk.subarray(4, chunk.length - 4)),
  chunk.length - 4,
);
const ref = Buffer.concat([
  reference.subarray(0, 33),
  chunk,
  reference.subarray(33),
]);
fs.writeFileSync(path.join(out, "outgoing-owned-reference.png"), ref);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
await context.route("**/*", (r) => {
  const url = r.request().url();
  return /^https?:/.test(url) && !url.startsWith(origin + "/")
    ? r.abort()
    : r.continue();
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(origin + "/?mode=images");
  await page
    .getByRole("region", { name: "Image workspace", exact: true })
    .waitFor();
  const start = page.getByRole("button", { name: "START LOCAL SESSION" });
  await start.waitFor({ state: "visible" });
  await start.click();
  await page
    .getByLabel("Add image files")
    .setInputFiles(path.join(out, "outgoing-owned-reference.png"));
  await page
    .getByRole("button", { name: "CONFIRM IMAGE SET", exact: true })
    .click();
  await page
    .getByRole("button", { name: "BUILD PACKAGE", exact: true })
    .click();
  await page
    .getByRole("button", { name: "DOWNLOAD ZIP", exact: true })
    .waitFor({ state: "visible" });
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "DOWNLOAD ZIP", exact: true }).click();
  const download = await downloadEvent;
  await download.saveAs(path.join(out, "browser-export.zip"));
  await page.screenshot({
    path: path.join(out, "images-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "Workspace modes" })
    .getByRole("button", { name: "Runs", exact: true })
    .click();
  const panel = page.getByRole("article", {
    name: "Send to harness",
    exact: true,
  });
  await panel.getByRole("checkbox", { name: /I reviewed this source/ }).check();
  await panel
    .getByRole("button", { name: "Review handoff", exact: true })
    .click();
  await panel
    .getByRole("region", { name: "Outgoing handoff review" })
    .waitFor();
  const records = await page.evaluate(async () => {
    const r = await fetch("/api/handoff/status");
    return (await r.json()).handoffs;
  });
  const record = records.find(
    (r) =>
      r.displayName === "outgoing-owned-reference.png" &&
      r.packageSha256 ===
        sha(fs.readFileSync(path.join(out, "browser-export.zip"))),
  );
  if (!record) throw Error("Missing handoff record");
  if (record.referenceSha256 !== sha(ref))
    throw Error("Reference custody mismatch");
  const image = panel.getByRole("img", { name: "Exact outgoing reference" });
  await image.waitFor();
  const rendered = await image.evaluate((i) => ({
    width: i.naturalWidth,
    height: i.naturalHeight,
  }));
  if (!rendered.width) throw Error("Preview did not decode");
  await panel
    .getByText("Read the exact outgoing prompt", { exact: true })
    .click();
  if ((await panel.locator("pre").textContent()) !== record.prompt)
    throw Error("Prompt render mismatch");
  const files = {};
  for (const name of [
    "reference.png",
    "prompt.txt",
    "package.zip",
    "handoff.zip",
    "snapshot.json",
  ]) {
    const event = page.waitForEvent("download");
    await panel.getByRole("link", { name, exact: true }).click();
    const d = await event;
    const file = path.join(out, "download-" + name);
    await d.saveAs(file);
    files[name] = {
      sha256: sha(fs.readFileSync(file)),
      byteLength: fs.statSync(file).size,
    };
  }
  if (
    files["reference.png"].sha256 !== sha(ref) ||
    files["package.zip"].sha256 !==
      sha(fs.readFileSync(path.join(out, "browser-export.zip")))
  )
    throw Error("Download custody mismatch");
  await panel.getByRole("checkbox", { name: /I checked the outgoing/ }).check();
  if (openTerminal)
    await panel
      .getByRole("button", { name: "Open terminal review", exact: true })
      .click();
  // This requests an actual OS terminal launch. Never press START in that terminal.
  if (openTerminal) {
    await page.waitForFunction(
      async (id) => {
        const r = await fetch("/api/handoff/status");
        return (await r.json()).handoffs.some(
          (x) => x.id === id && x.phase === "terminal-review-open",
        );
      },
      record.id,
      { timeout: 15000 },
    );
    await panel
      .getByText(/Target: Codex terminal. Status: terminal-review-open/)
      .waitFor();
  }
  const status = await page.evaluate(async () => {
    const r = await fetch("/api/handoff/status");
    return (await r.json()).handoffs;
  });
  if (
    openTerminal &&
    status.find((x) => x.id === record.id)?.phase !== "terminal-review-open"
  )
    throw Error("Missing terminal review acknowledgement");
  fs.writeFileSync(
    path.join(out, "browser-handoff-record.json"),
    JSON.stringify(status, null, 2),
  );
  await panel
    .locator("details")
    .filter({
      has: page.getByText("Read the exact outgoing prompt", { exact: true }),
    })
    .evaluate((e) => (e.open = false));
  await page.screenshot({
    path: path.join(out, "runs-desktop.png"),
    fullPage: true,
  });
  for (const mode of ["Text", "Images", "Projects", "Runs"]) {
    await page
      .getByRole("navigation", { name: "Workspace modes" })
      .getByRole("button", { name: mode, exact: true })
      .click();
    if (mode === "Projects") {
      const start = page.getByRole("button", { name: "START LOCAL SESSION" });
      if (await start.isVisible()) await start.click();
    }
    await page.screenshot({
      path: path.join(out, mode.toLowerCase() + "-mode.png"),
      fullPage: true,
    });
  }
  await panel
    .getByRole("region", { name: "Outgoing handoff review" })
    .waitFor();
  await page.keyboard.press("Control+k");
  if (await page.getByRole("dialog").count())
    throw Error("Inactive mode captured keyboard shortcut");
  const themes = [];
  for (const palette of ["graphite", "lime", "amber", "original"]) {
    await page.getByLabel("Color palette").selectOption(palette);
    for (const appearance of ["dark", "light"]) {
      if (
        (await page
          .locator(".unified-platform")
          .getAttribute("data-appearance")) !== appearance
      )
        await page
          .getByRole("button", { name: `Switch to ${appearance} appearance` })
          .click();
      themes.push({
        palette,
        appearance,
        color: await panel.evaluate(
          (e) => e.ownerDocument.defaultView.getComputedStyle(e).color,
        ),
      });
    }
  }
  await page.getByLabel("Color palette").selectOption("graphite");
  await page.getByRole("button", { name: "Switch to dark appearance" }).click();
  const widths = [];
  for (const width of [390, 320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    widths.push(
      await page.evaluate(() => ({
        width: globalThis.innerWidth,
        scrollWidth: globalThis.document.documentElement.scrollWidth,
      })),
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(out, "runs-mobile.png"),
    fullPage: true,
  });
  fs.writeFileSync(
    path.join(out, "browser-receipt.json"),
    JSON.stringify(
      {
        kind: "real-browser-to-terminal-launch-review",
        modelCalls: 0,
        imageCalls: 0,
        taskCreated: false,
        terminalReviewOpened: openTerminal,
        sourceSha256: sha(ref),
        recordId: record.id,
        downloads: files,
        modeStateRetained: true,
        rendered,
        widths,
        themes,
        pageErrors: errors,
        actualPhoneTest: false,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      out,
      recordId: record.id,
      terminalReviewOpened: openTerminal,
      taskCreated: false,
      modelCalls: 0,
    }),
  );
} catch (e) {
  await page.screenshot({
    path: path.join(out, "browser-failure.png"),
    fullPage: true,
  });
  fs.writeFileSync(
    path.join(out, "browser-failure.txt"),
    await page.locator("body").innerText(),
  );
  throw e;
} finally {
  await browser.close();
}
