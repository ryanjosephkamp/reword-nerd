import { expect, test } from "@playwright/test";

import { asPayload, markdownFixture } from "./fixtures";

test("ORIGINAL stays inert and contained at every supported mobile width", async ({ page }) => {
  const externalRequests: string[] = [];
  await page.goto("./");
  const appOrigin = new URL(page.url()).origin;
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== appOrigin) externalRequests.push(request.url());
  });
  const quickStart = page.getByRole("dialog", { name: "Quick start" });
  if (await quickStart.isVisible()) await quickStart.getByRole("button", { name: "Close quick start" }).click();
  await page.getByLabel("Add supported files").setInputFiles(asPayload(markdownFixture));
  await expect(page.getByLabel(`Extracted text for ${markdownFixture.name}`)).toHaveValue(/stable Markdown fact/u);
  const sourceTabs = page.getByRole("tablist", { name: "Source view" });
  await expect(sourceTabs.getByRole("tab")).toHaveText(["EXTRACTED TEXT", "ORIGINAL"]);
  await sourceTabs.getByRole("tab", { name: "ORIGINAL" }).click();
  await expect(page.getByRole("heading", { name: "Browser fixture" })).toBeVisible();
  await expect(page.locator(".source-review a, .source-review img, .source-review iframe, .source-review object, .source-review embed")).toHaveCount(0);
  await expect(page.getByText("https://example.invalid/reference")).toBeVisible();

  for (const [width, height] of [[320, 720], [360, 800], [390, 844], [412, 915]] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole("tab", { name: "REVIEW" })).toHaveAttribute("aria-selected", "true");
    const containment = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clipped: Array.from(document.querySelectorAll<HTMLElement>("button, input, select, textarea"))
        .filter((element) => element.getClientRects().length > 0)
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < -0.5 || rect.right > document.documentElement.clientWidth + 0.5;
        }).map((element) => element.getAttribute("aria-label") ?? element.textContent?.trim()),
    }));
    expect(containment.scrollWidth).toBeLessThanOrEqual(containment.clientWidth);
    expect(containment.clipped).toEqual([]);
  }
  expect(externalRequests).toEqual([]);
});
