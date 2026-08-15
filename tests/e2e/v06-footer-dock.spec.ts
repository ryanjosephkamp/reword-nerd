import { expect, test, type Download, type Page } from "@playwright/test";
import JSZip from "jszip";

import { asPayload, textFixture } from "./fixtures";

async function openWorkbench(page: Page) {
  await page.goto("./");
  const quickStart = page.getByRole("dialog", { name: "Quick start" });
  if (await quickStart.isVisible()) await quickStart.getByRole("button", { name: "Close quick start" }).click();
}

async function readyTextDocument(page: Page) {
  await page.getByLabel("Add supported files").setInputFiles([asPayload(textFixture)]);
  await expect(page.getByLabel(`Extracted text for ${textFixture.name}`)).toHaveValue(/launch code is 314/u);
  await page.getByRole("button", { name: "Confirm review" }).click();
}

async function downloadBytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test("desktop Preview Footer Dock stays contained and drives schema-v6 build and download", async ({ page }) => {
  await page.setViewportSize({ width: 1586, height: 992 });
  await openWorkbench(page);
  await readyTextDocument(page);

  const dock = page.getByRole("region", { name: "Package actions" });
  const preview = page.locator("#panel-preview");
  const content = page.locator("#panel-preview .preview-content");
  const build = dock.getByRole("button", { name: "BUILD PACKAGE" });
  const download = dock.getByRole("button", { name: "DOWNLOAD ZIP" });
  const [dockBox, previewBox, contentBox, buildBox, downloadBox] = await Promise.all([
    dock.boundingBox(), preview.boundingBox(), content.boundingBox(), build.boundingBox(), download.boundingBox(),
  ]);
  expect(dockBox).not.toBeNull();
  expect(previewBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(buildBox).not.toBeNull();
  expect(downloadBox).not.toBeNull();
  const uploadControlsBox = await page.locator(".upload-drop-zone").boundingBox();
  expect(uploadControlsBox).not.toBeNull();
  expect(uploadControlsBox!.x + uploadControlsBox!.width).toBeLessThanOrEqual(previewBox!.x);
  expect(Math.abs(buildBox!.y - downloadBox!.y)).toBeLessThanOrEqual(2);
  expect(buildBox!.x + buildBox!.width).toBeLessThan(downloadBox!.x);
  expect(dockBox!.x).toBeGreaterThanOrEqual(previewBox!.x);
  expect(dockBox!.x + dockBox!.width).toBeLessThanOrEqual(previewBox!.x + previewBox!.width + 1);
  expect(contentBox!.y + contentBox!.height).toBeLessThanOrEqual(dockBox!.y + 1);
  await expectNoHorizontalOverflow(page);

  await build.click();
  await expect(page.getByRole("heading", { name: "PACKAGE PREVIEW" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "RUNBOOK" })).toHaveAttribute("aria-selected", "true");
  await expect(build).toBeDisabled();
  await expect(download).toBeEnabled();
  await expect(dock.locator(".export-dock-message")).toContainText(/ready|built|download/iu);
  const pending = page.waitForEvent("download");
  await download.click();
  const archive = await JSZip.loadAsync(await downloadBytes(await pending), { checkCRC32: true });
  expect(JSON.parse(await archive.file("manifest.json")!.async("string"))).toMatchObject({
    schemaVersion: 6,
    package: { version: "0.8.0" },
  });

  const initialWidth = dockBox!.width;
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator(".workbench-grid")).toHaveClass(/settings-collapsed/u);
  await expect.poll(async () => (await dock.boundingBox())?.width ?? 0).toBeGreaterThan(initialWidth);
  await expectNoHorizontalOverflow(page);
});

test("tablet uses the Settings drawer and mobile retains local build/download actions without the desktop dock", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openWorkbench(page);
  await readyTextDocument(page);
  await expect(page.getByRole("region", { name: "Package actions" })).toHaveCount(0);
  await page.getByRole("button", { name: "Settings" }).click();
  const drawer = page.getByRole("dialog", { name: "Parameters" });
  await expect(drawer).toBeVisible();
  const tabletBuild = drawer.getByRole("button", { name: "BUILD PACKAGE" });
  await expect(tabletBuild).toBeEnabled();
  await expectNoHorizontalOverflow(page);
  await drawer.getByRole("button", { name: "Close settings" }).click();

  for (const [width, height] of [[412, 915], [390, 844], [360, 800], [320, 720]] as const) {
    await page.setViewportSize({ width, height });
    await page.getByRole("tab", { name: "REVIEW" }).click();
    await expect(page.getByRole("region", { name: "Package actions" })).toHaveCount(0);
    const build = page.getByRole("button", { name: "BUILD PACKAGE" });
    await expect(build).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }

  await page.getByRole("button", { name: "BUILD PACKAGE" }).click();
  await expect(page.getByRole("heading", { name: "PACKAGE PREVIEW" })).toBeFocused();
  const mobileDownload = page.getByRole("button", { name: "DOWNLOAD ZIP" });
  await expect(mobileDownload).toBeVisible();
  await expect(mobileDownload).toBeEnabled();
  const pending = page.waitForEvent("download");
  await mobileDownload.click();
  expect((await pending).suggestedFilename()).toMatch(/^reword-nerd-text-prompt-package-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.zip$/u);
  await expectNoHorizontalOverflow(page);
});
