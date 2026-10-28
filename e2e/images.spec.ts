import { expect, test } from "@playwright/test";
import { zipContents } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/app/?mode=images");
  await page.getByRole("button", { name: "Try a sample image" }).click();
  await expect(page.getByRole("heading", { name: "garden-poster.png" })).toBeVisible();
});

test("an image gets a prompt for an image tool", async ({ page, isMobile }) => {
  if (isMobile) await page.getByRole("button", { name: "Hand off", exact: true }).click();
  await expect(page.locator(".prompt-card .prompt-preview")).toContainText(
    "Create a new image based on the attached reference image.",
  );
  await expect(
    page.getByRole("link", { name: "Copy prompt and open Grok Imagine" }),
  ).toHaveAttribute("href", "https://grok.com/imagine");
});

test("requested changes reach the prompt", async ({ page, isMobile }) => {
  if (isMobile) await page.getByRole("button", { name: "Hand off", exact: true }).click();
  await page.getByLabel("What should change?").fill("Make it an autumn scene.");
  await expect(page.locator(".prompt-card .prompt-preview")).toContainText(
    "Change only this: Make it an autumn scene.",
  );
});

test("Codex gets an image task folder", async ({ page, isMobile }) => {
  if (isMobile) await page.getByRole("button", { name: "Hand off", exact: true }).click();
  await page.getByRole("radio", { name: "Codex", exact: true }).check();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download task folder" }).click();
  const download = await downloading;
  const folder = download.suggestedFilename().replace(/\.zip$/, "");
  const files = await zipContents(download);
  expect(files.has(`${folder}/source/garden-poster.png`)).toBe(true);
  expect(files.get(`${folder}/prompts/garden-poster.md`)).toContain("faithful new rendering");
});
