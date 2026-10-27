// Additional actual-UI tests with owned source only. No terminal/task start.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
const url = new URL(process.argv[2] ?? "http://invalid/");
if (
  url.protocol !== "http:" ||
  url.hostname !== "127.0.0.1" ||
  !url.port ||
  url.pathname !== "/" ||
  url.search ||
  url.hash
)
  throw Error("Select the owned demo URL");
const out = fs.mkdtempSync(
  path.resolve("output/studio/harness-handoff") + "/browser-edge-",
);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
await context.route("**/*", (r) =>
  /^https?:/.test(r.request().url()) &&
  !r
    .request()
    .url()
    .startsWith(url.origin + "/")
    ? r.abort()
    : r.continue(),
);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const source =
  "Owned LF source.\n$& $$ $` $'\n雪 😀\n<script>window.handoffInjected=true</script>\n\n";
const reviewed = source + "Explicitly reviewed addition.\n";
try {
  await page.goto(url.href);
  await page
    .getByLabel("Import documents")
    .setInputFiles({
      name: "handoff-owned.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(source),
    });
  await page
    .locator(".studio-document-item")
    .filter({ hasText: "handoff owned" })
    .getByRole("button")
    .first()
    .click();
  await page.getByRole("button", { name: "Edit source", exact: true }).click();
  await page.getByLabel("Document source", { exact: true }).fill(reviewed);
  await page
    .getByRole("button", { name: "Review complete", exact: true })
    .click();
  const mode = async (label) =>
    page
      .getByRole("navigation", { name: "Workspace modes" })
      .getByRole("button", { name: label, exact: true })
      .click();
  await mode("Runs");
  const panel = page.getByRole("article", {
    name: "Send to harness",
    exact: true,
  });
  await panel.getByRole("combobox").selectOption("text");
  await panel.getByRole("checkbox", { name: /I reviewed this source/ }).check();
  await panel
    .getByRole("button", { name: "Review handoff", exact: true })
    .click();
  await panel
    .getByRole("region", { name: "Outgoing handoff review" })
    .waitFor();
  const status = async () =>
    page.evaluate(async () => {
      const r = await fetch("/api/handoff/status");
      return (await r.json()).handoffs;
    });
  const a = (await status()).find((x) => x.displayName === "handoff-owned.md");
  if (!a || !a.prompt.includes(reviewed) || a.referenceSha256 !== sha(reviewed))
    throw Error("Text canonical/source mismatch");
  const downloaded = {};
  for (const name of ["package.zip", "reviewed-source.txt", "prompt.txt"]) {
    const pending = page.waitForEvent("download");
    await panel.getByRole("link", { name, exact: true }).click();
    const d = await pending;
    const file = path.join(out, name);
    await d.saveAs(file);
    downloaded[name] = {
      sha256: sha(fs.readFileSync(file)),
      byteLength: fs.statSync(file).size,
    };
  }
  if (
    fs.readFileSync(path.join(out, "reviewed-source.txt"), "utf8") !==
      reviewed ||
    fs.readFileSync(path.join(out, "prompt.txt"), "utf8") !== a.prompt
  )
    throw Error("Exact text download failed");
  await panel
    .getByRole("button", { name: "Review handoff", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Review handoff", exact: true })
    .waitFor();
  await page.waitForFunction(async () => {
    const r = await fetch("/api/handoff/status");
    return (
      (await r.json()).handoffs.filter(
        (x) => x.displayName === "handoff-owned.md",
      ).length === 1
    );
  });
  await panel.getByRole("checkbox", { name: /I checked the outgoing/ }).check();
  await mode("Text");
  await page.getByRole("button", { name: "Edit source", exact: true }).click();
  await page
    .getByLabel("Document source", { exact: true })
    .fill("Changed after the frozen handoff.");
  await page
    .getByRole("button", { name: "Review complete", exact: true })
    .click();
  await mode("Runs");
  if (
    !(await panel
      .getByRole("button", { name: "Open terminal review" })
      .isDisabled())
  )
    throw Error("Stale source allowed launch");
  await panel.getByText(/current source differs/).waitFor();
  if ((await status()).find((x) => x.id === a.id).prompt !== a.prompt)
    throw Error("Old prompt overwritten");
  if (await page.evaluate(() => Object.hasOwn(globalThis, "handoffInjected")))
    throw Error("Hostile source executed");
  await panel.screenshot({ path: path.join(out, "text-stale-review.png") });
  // A valid PNG within the existing validator's 4096 limit but over the native default resize boundary.
  function chunk(type, data) {
    const b = Buffer.alloc(data.length + 12);
    b.writeUInt32BE(data.length);
    b.write(type, 4);
    data.copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, b.length - 4)), b.length - 4);
    return b;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2049);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  const raw = Buffer.alloc(2049 * 3 + 1, 190);
  raw[0] = 0;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  fs.writeFileSync(path.join(out, "owned-width-2049.png"), png);
  const p = await context.newPage();
  await p.goto(url.origin + "/?mode=images");
  await p.getByRole("button", { name: "START LOCAL SESSION" }).click();
  await p
    .getByLabel("Add image files")
    .setInputFiles(path.join(out, "owned-width-2049.png"));
  await p
    .getByRole("button", { name: "CONFIRM IMAGE SET", exact: true })
    .click();
  await p.getByRole("button", { name: "BUILD PACKAGE", exact: true }).click();
  await p.getByRole("button", { name: "DOWNLOAD ZIP", exact: true }).waitFor();
  const dp = p.waitForEvent("download");
  await p.getByRole("button", { name: "DOWNLOAD ZIP", exact: true }).click();
  await (await dp).saveAs(path.join(out, "width-2049-manual-package.zip"));
  await p
    .getByRole("navigation", { name: "Workspace modes" })
    .getByRole("button", { name: "Runs", exact: true })
    .click();
  const hp = p.getByRole("article", { name: "Send to harness" });
  await hp.getByRole("checkbox", { name: /I reviewed this source/ }).check();
  await hp.getByRole("button", { name: "Review handoff", exact: true }).click();
  await hp.getByRole("alert").filter({ hasText: "2048" }).waitFor();
  if ((await status()).some((x) => x.displayName === "owned-width-2049.png"))
    throw Error("Unsupported image created handoff");
  await hp.screenshot({ path: path.join(out, "dimension-rejection.png") });
  fs.writeFileSync(
    path.join(out, "receipt.json"),
    JSON.stringify(
      {
        kind: "owned-ui-edge-cases",
        realModelCalls: 0,
        originalSourceSha256: sha(source),
        reviewedSourceSha256: sha(reviewed),
        id: a.id,
        downloaded,
        canonicalPromptExact: true,
        repeatIdempotent: true,
        sourceEditPreservedOldSnapshot: true,
        staleLaunchDisabled: true,
        scriptDataInert: true,
        valid2049PngManualExported: true,
        cliResizeBoundaryRejectedBeforeHandoff: true,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ out, pass: true }));
} catch (e) {
  await page.screenshot({
    path: path.join(out, "failure.png"),
    fullPage: true,
  });
  fs.writeFileSync(
    path.join(out, "failure.txt"),
    await page.locator("body").innerText(),
  );
  throw e;
} finally {
  await browser.close();
}
