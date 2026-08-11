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
  ] as const) {
    await page.setViewportSize({ width, height });
    if (width < 768) {
      await page.getByRole("tab", { name: "PREVIEW" }).click();
      await expect(page.getByRole("tab", { name: "PREVIEW" })).toHaveAttribute("aria-selected", "true");
    }
    await assertViewportContained(page);
    await page.screenshot({ path: `${screenshotDirectory}/${name}`, fullPage: false, animations: "disabled" });
  }
});
