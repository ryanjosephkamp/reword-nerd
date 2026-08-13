import { expect, test } from "@playwright/test";
import { asPayload, textFixture } from "./fixtures";

async function openWorkbench(page: import("@playwright/test").Page) {
  await page.goto("./");
  const quickStart = page.getByRole("dialog", { name: "Quick start" });
  if (await quickStart.isVisible()) await quickStart.getByRole("button", { name: "Close quick start" }).click();
}

test("desktop Preview Footer Dock stays contained, expands with Preview, and does not alter mobile actions", async ({ page }) => {
  // This catches a stacked/overlaying dock, horizontal overflow, or the desktop duplicate leaking into mobile.
  await page.setViewportSize({ width: 1586, height: 992 });
  await openWorkbench(page);
  await page.getByLabel("Add supported files").setInputFiles([asPayload(textFixture)]);
  await expect(page.getByLabel(`Extracted text for ${textFixture.name}`)).toHaveValue(/launch code is 314/u);

  const dock = page.getByRole("region", { name: "Package actions" });
  await expect(dock).toBeVisible();
  const preview = page.locator("#panel-preview");
  const content = page.locator("#panel-preview .preview-content");
  const build = dock.getByRole("button", { name: "BUILD PACKAGE" });
  const download = dock.getByRole("button", { name: "DOWNLOAD ZIP" });
  const [dockBox, previewBox, contentBox, buildBox, downloadBox] = await Promise.all([
    dock.boundingBox(),
    preview.boundingBox(),
    content.boundingBox(),
    build.boundingBox(),
    download.boundingBox(),
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
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const initialWidth = dockBox!.width;
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator(".workbench-grid")).toHaveClass(/settings-collapsed/u);
  await expect.poll(async () => (await dock.boundingBox())?.width ?? 0).toBeGreaterThan(initialWidth);

  await page.getByRole("button", { name: "Confirm review" }).click();
  await page.setViewportSize({ width: 320, height: 720 });
  await expect(dock).toHaveCount(0);
  await expect(page.getByRole("button", { name: "BUILD PACKAGE" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
