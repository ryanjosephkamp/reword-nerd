import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { asPayload, markdownFixture, textFixture } from "./fixtures";

const screenshotDirectory = "output/playwright";

async function assertViewportContained(page: Page) {
  const containment = await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    clippedControls: Array.from(document.querySelectorAll<HTMLElement>("button, input, select, textarea"))
      .filter((element) => element.getClientRects().length > 0)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < -0.5 || rect.right > document.documentElement.clientWidth + 0.5;
      })
      .map((element) => element.getAttribute("aria-label") ?? element.textContent?.trim() ?? element.tagName),
  }));
  expect(containment).toEqual({ horizontal: true, clippedControls: [] });
}

test("captures the approved representative workbench at all native QA viewports", async ({ page }) => {
  // This catches responsive clipping and supplies fixed-size evidence for composition review.
  mkdirSync(screenshotDirectory, { recursive: true });
  await page.goto("/");
  await page.getByRole("dialog", { name: "Quick start" }).getByRole("button", { name: "Close quick start" }).click();
  await page.getByLabel("Add supported files").setInputFiles([asPayload(textFixture), asPayload(markdownFixture)]);
  const fileOptions = page.getByRole("listbox", { name: "Uploaded files" }).getByRole("option");
  await expect(fileOptions).toHaveCount(2);
  await fileOptions.filter({ hasText: textFixture.name }).click();
  await expect(page.getByLabel(`Extracted text for ${textFixture.name}`)).toHaveValue(/launch code is 314/);
  await page.getByRole("button", { name: "Confirm review" }).click();
  await fileOptions.filter({ hasText: markdownFixture.name }).click();
  await expect(page.getByLabel(`Extracted text for ${markdownFixture.name}`)).toHaveValue(/stable Markdown fact/);
  await page.getByLabel("Tone").selectOption("academic");

  const palette = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return ["canvas", "surface", "surface-raised", "border", "text", "muted", "ready", "review", "blocked"]
      .map((name) => style.getPropertyValue(`--color-${name}`).trim());
  });
  expect(palette).toEqual(["#090b10", "#11151d", "#171c25", "#303746", "#d7dde8", "#7f8a9d", "#42e8b4", "#f2b84b", "#ff667a"]);
  expect(await page.locator(".workbench").evaluate((element) => getComputedStyle(element).backgroundImage)).toBe("none");

  for (const [name, width, height] of [
    ["desktop-1586x992.png", 1586, 992],
    ["tablet-1024x768.png", 1024, 768],
    ["mobile-412x915.png", 412, 915],
    ["mobile-390x844.png", 390, 844],
    ["mobile-360x800.png", 360, 800],
    ["mobile-320x720.png", 320, 720],
  ] as const) {
    await page.setViewportSize({ width, height });
    if (width < 768) {
      await page.getByRole("tab", { name: "REVIEW" }).click();
      await expect(page.getByRole("tab", { name: "REVIEW" })).toHaveAttribute("aria-selected", "true");
    }
    if (width === 1024) {
      const overlap = await page.evaluate(() => {
        const modes = document.querySelector(".preview-mode-switch")!.getBoundingClientRect();
        const notice = document.querySelector(".review-notice")!.getBoundingClientRect();
        return Math.max(0, Math.min(modes.right, notice.right) - Math.max(modes.left, notice.left))
          * Math.max(0, Math.min(modes.bottom, notice.bottom) - Math.max(modes.top, notice.top));
      });
      expect(overlap).toBe(0);
    }
    await assertViewportContained(page);
    await page.screenshot({ path: `${screenshotDirectory}/${name}`, fullPage: false, animations: "disabled" });
  }
});

test("captures the built package preview without responsive clipping", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("dialog", { name: "Quick start" }).getByRole("button", { name: "Close quick start" }).click();
  await page.getByLabel("Add supported files").setInputFiles([asPayload(textFixture)]);
  await expect(page.getByLabel(`Extracted text for ${textFixture.name}`)).toHaveValue(/launch code is 314/);
  await page.getByRole("button", { name: "Confirm review" }).click();
  await page.getByRole("button", { name: "BUILD PACKAGE" }).click();
  await expect(page.getByRole("heading", { name: "PACKAGE PREVIEW" })).toBeFocused();

  for (const [name, width, height] of [
    ["package-desktop-1586x992.png", 1586, 992],
    ["package-mobile-320x720.png", 320, 720],
  ] as const) {
    await page.setViewportSize({ width, height });
    if (width < 768) await page.getByRole("tab", { name: "REVIEW" }).click();
    await assertViewportContained(page);
    const oneShotCopy = page.getByRole("button", { name: "COPY ONE-SHOT PROMPT" });
    await expect(oneShotCopy).toHaveCount(1);
    await page.screenshot({ path: `${screenshotDirectory}/${name}`, fullPage: false, animations: "disabled" });
    const manualTab = page.getByRole("tab", { name: "MANUAL" });
    if (await manualTab.getAttribute("aria-selected") !== "true") await manualTab.click();
    const response = page.getByRole("textbox", { name: "Stage 1 — Decompose model response" });
    if (await response.inputValue() !== "Visual review analysis") await response.fill("Visual review analysis");
    const rewrite = page.getByRole("textbox", { name: "Editable Stage 2 — Rewrite prompt" });
    await rewrite.scrollIntoViewIfNeeded();
    await expect(rewrite).toBeVisible();
    if (width < 768) {
      const unobscuredHeight = await rewrite.evaluate((element) => {
        const control = element.getBoundingClientRect();
        const scroller = document.querySelector(".preview-content")!.getBoundingClientRect();
        const sticky = document.querySelector(".package-preview-controls")!.getBoundingClientRect();
        const exportPanel = document.querySelector(".preview-panel > .export-panel")!.getBoundingClientRect();
        return Math.max(0, Math.min(control.bottom, scroller.bottom, exportPanel.top)
          - Math.max(control.top, scroller.top, sticky.bottom));
      });
      expect(unobscuredHeight).toBeGreaterThanOrEqual(100);
    }
    await assertViewportContained(page);
    await page.screenshot({ path: `${screenshotDirectory}/${name.replace("package-", "manual-progress-")}`, fullPage: false, animations: "disabled" });
    if (width < 768) await expect(page.getByRole("tab", { name: "SETTINGS" })).toBeVisible();
  }
});

test("captures first visit, empty Review, and reachable Settings bottom at portrait QA widths", async ({ page }) => {
  mkdirSync(screenshotDirectory, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.screenshot({ path: `${screenshotDirectory}/quick-start-390x844.png`, fullPage: false, animations: "disabled" });
  await page.getByRole("dialog", { name: "Quick start" }).getByRole("button", { name: "Close quick start" }).click();
  await page.getByRole("tab", { name: "REVIEW" }).click();
  await page.screenshot({ path: `${screenshotDirectory}/empty-review-390x844.png`, fullPage: false, animations: "disabled" });

  for (const [width, height] of [[320, 720], [360, 800], [390, 844], [412, 915]] as const) {
    await page.setViewportSize({ width, height });
    await page.getByRole("tab", { name: "SETTINGS" }).click();
    const panel = page.getByRole("tabpanel", { name: "SETTINGS" });
    const reset = page.getByRole("button", { name: "Reset saved preferences" });
    const geometryBefore = await panel.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY,
    }));
    expect(geometryBefore.scrollHeight).toBeGreaterThan(geometryBefore.clientHeight);
    expect(geometryBefore.overflowY).toMatch(/auto|scroll/u);
    await reset.scrollIntoViewIfNeeded();
    const geometryAfter = await reset.evaluate((element) => {
      const control = element.getBoundingClientRect();
      const navigation = document.querySelector(".mobile-tabs")!.getBoundingClientRect();
      return { controlBottom: control.bottom, navigationTop: navigation.top };
    });
    expect(geometryAfter.controlBottom).toBeLessThanOrEqual(geometryAfter.navigationTop + 0.5);
    await assertViewportContained(page);
    await page.screenshot({
      path: `${screenshotDirectory}/settings-bottom-${width}x${height}.png`,
      fullPage: false,
      animations: "disabled",
    });
  }
});
