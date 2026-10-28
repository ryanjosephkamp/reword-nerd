import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function violations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target.join(" ")).slice(0, 5),
  }));
}

for (const theme of ["dark", "light"] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    test("the landing page has no accessibility violations", async ({ page }) => {
      await page.goto("/");
      expect(await violations(page)).toEqual([]);
    });

    test("the text workspace has no accessibility violations", async ({ page }) => {
      await page.goto("/app/");
      expect(await violations(page)).toEqual([]);
      await page.getByRole("button", { name: "Try a sample document" }).click();
      await expect(page.getByRole("heading", { name: "urban-gardens.md" })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test("the images workspace has no accessibility violations", async ({ page }) => {
      await page.goto("/app/?mode=images");
      await page.getByRole("button", { name: "Try a sample image" }).click();
      await expect(page.getByRole("heading", { name: "garden-poster.png" })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  });
}
