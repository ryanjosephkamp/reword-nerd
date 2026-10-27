import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import JSZip from "jszip";
const out = "output/studio/image-connection/browser";
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
test("real browser image export to offline preparation preserves exact bytes and mode state; no generation controls", async ({
  page,
  context,
}) => {
  test.skip(
    process.env.REWORD_IMAGE_PREPARATION !== "1",
    "Requires an explicitly owned review-only local companion with a fresh image slot",
  );
  test.setTimeout(90000);
  mkdirSync(out, { recursive: true });
  const errors: string[] = [],
    external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.protocol.startsWith("http") && u.hostname !== "127.0.0.1") {
      external.push(u.href);
      return r.abort();
    }
    return r.continue();
  });
  await page.goto("/?mode=runs");
  const panel = page.getByRole("article", { name: "Local image preparation" });
  await expect(panel).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Prepare locally — no generation" }),
  ).toBeDisabled();
  const modes = page.getByRole("navigation", { name: "Workspace modes" });
  await modes.getByRole("button", { name: "Images", exact: true }).click();
  const start = page.getByRole("button", { name: "START LOCAL SESSION" });
  if (await start.isVisible()) await start.click();
  const reference = readFileSync(
    "output/studio/image-connection/fixture/export/reference.png",
  );
  await page.getByLabel("Add image files").setInputFiles({
    name: "owned-no-model.png",
    mimeType: "image/png",
    buffer: reference,
  });
  await page.getByRole("button", { name: "CONFIRM IMAGE SET" }).click();
  await page
    .getByRole("button", { name: "BUILD PACKAGE", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "DOWNLOAD ZIP", exact: true }),
  ).toBeEnabled();
  const packageHash = await page.locator(".image-package-hash").textContent();
  const e = page.waitForEvent("download");
  await page.getByRole("button", { name: "DOWNLOAD ZIP", exact: true }).click();
  await (await e).saveAs(out + "/browser-package.zip");
  const bytes = readFileSync(out + "/browser-package.zip");
  expect(hash(bytes)).toBe(packageHash);
  const zip = await JSZip.loadAsync(bytes);
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  await page.screenshot({ path: out + "/images-desktop.png", fullPage: true });
  await modes.getByRole("button", { name: "Runs", exact: true }).click();
  await expect(panel.getByText(/1 image\(s\)/)).toBeVisible();
  const confirm = panel.getByRole("checkbox");
  await confirm.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  await expect(
    panel.getByRole("button", { name: "Prepare locally — no generation" }),
  ).toBeFocused();
  await panel
    .getByRole("button", { name: "Prepare locally — no generation" })
    .click();
  await expect(
    panel.getByRole("heading", {
      name: "Prepared locally · execution blocked",
    }),
  ).toBeVisible();
  const status = await (await page.request.get("/api/image/status")).json();
  expect(status.job.packageSha256).toBe(packageHash);
  expect(status.job.attempts[0].status).toBe("unsupported");
  expect(status.job.acceptedByUser).toBe(false);
  expect(status.job.attempts[0].ticket.capability.smokeAuthorized).toBe(false);
  for (const name of [
    "package.zip",
    "reference.png",
    "prompt.txt",
    "audit.json",
    "review.html",
  ]) {
    const d = page.waitForEvent("download");
    await panel.getByRole("link", { name, exact: true }).click();
    await (await d).saveAs(out + "/" + name);
  }
  expect(readFileSync(out + "/package.zip")).toEqual(bytes);
  expect(readFileSync(out + "/reference.png")).toEqual(reference);
  expect(hash(readFileSync(out + "/prompt.txt"))).toBe(status.job.promptSha256);
  const audit = JSON.parse(readFileSync(out + "/audit.json", "utf8"));
  expect(audit.acceptedByUser).toBe(false);
  expect(audit.state.attempts[0].result).toBeNull();
  for (const mode of ["Text", "Images", "Projects", "Runs"]) {
    await modes.getByRole("button", { name: mode, exact: true }).click();
    if (await start.isVisible()) await start.click();
  }
  await expect(
    panel.getByRole("heading", {
      name: "Prepared locally · execution blocked",
    }),
  ).toBeVisible();
  await modes.getByRole("button", { name: "Images", exact: true }).click();
  await expect(page.locator(".image-package-hash")).toHaveText(packageHash!);
  await page.getByRole("button", { name: "SELECTED [0]", exact: true }).click();
  await page
    .getByLabel("Focused requested changes", { exact: true })
    .fill(
      "<script>window.__imageExecuted=true</script>\nSynthetic edit after preparation",
    );
  await modes.getByRole("button", { name: "Runs", exact: true }).click();
  await expect(
    panel.getByText(/prepared job remains independent/),
  ).toBeVisible();
  expect(
    (await (await page.request.get("/api/image/status")).json()).job,
  ).toEqual(status.job);
  await panel.scrollIntoViewIfNeeded();
  await panel.screenshot({ path: out + "/runs-desktop.png" });
  const colors = [];
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
      colors.push({
        palette,
        appearance,
        color: await panel.evaluate((e) => getComputedStyle(e).color),
      });
    }
  }
  await page.getByLabel("Color palette").selectOption("graphite");
  await page.getByRole("button", { name: "Switch to dark appearance" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await panel.screenshot({ path: out + "/runs-mobile.png" });
  expect(
    await page.evaluate(() => Object.hasOwn(window, "__imageExecuted")),
  ).toBe(false);
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(
    panel.getByRole("heading", {
      name: "Prepared locally · execution blocked",
    }),
  ).toBeVisible();
  await expect(
    panel.getByText(/prepared job remains independent/),
  ).toBeVisible();
  const standalone = await context.newPage();
  await standalone.goto(pathToFileURL(resolve(out + "/review.html")).href);
  await expect(standalone.getByRole("img").first()).toBeVisible();
  expect(
    await standalone
      .locator("img")
      .first()
      .evaluate((e: HTMLImageElement) => e.naturalWidth),
  ).toBe(320);
  await standalone.screenshot({
    path: out + "/standalone.png",
    fullPage: true,
  });
  await standalone.close();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  writeFileSync(
    out + "/receipt.json",
    JSON.stringify(
      {
        label: "Owned synthetic offline browser preparation, no model calls",
        packageSha256: packageHash,
        referenceSha256: hash(reference),
        promptSha256: status.job.promptSha256,
        schemaVersion: manifest.schemaVersion,
        jobId: status.job.jobId,
        ticketId: status.job.attempts[0].ticket.ticketId,
        unsupported: true,
        acceptedByUser: false,
        exactDownloads: true,
        modeRetention: true,
        stalePackageIndependent: true,
        keyboard: true,
        mobileWidth: 390,
        colors,
        externalRequests: external,
        pageErrors: errors,
        newModelCalls: 0,
        newImageCalls: 0,
      },
      null,
      2,
    ),
  );
});
