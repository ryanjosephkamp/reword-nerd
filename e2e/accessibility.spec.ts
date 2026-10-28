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
      const editor = page.getByRole("textbox", { name: "Page: urban-gardens.md" });
      await editor.locator("p").first().click();
      await page.keyboard.type(" Edited.");
      await editor.blur();
      await page.getByRole("button", { name: /^Changes/ }).click();
      await expect(page.locator(".diff-table")).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test("every color palette has no accessibility violations", async ({ page }) => {
      for (const palette of ["harbor", "moss", "ember", "plum", "graphite"]) {
        await page.addInitScript((value) => {
          localStorage.setItem("reword-nerd:palette", value);
        }, palette);
        await page.goto("/app/");
        await page.getByRole("button", { name: "Try a sample document" }).click();
        await expect(page.getByRole("heading", { name: "urban-gardens.md" })).toBeVisible();
        expect(await violations(page), palette).toEqual([]);
      }
    });

    test("the menus have no accessibility violations", async ({ page, isMobile }) => {
      test.skip(isMobile, "The phone header keeps these in the workspace menu.");
      await page.goto("/app/");
      await page.getByRole("button", { name: "Try a sample document" }).click();
      await page.getByRole("button", { name: "Appearance" }).click();
      expect(await violations(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Page style" }).click();
      expect(await violations(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Download", exact: true }).click();
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
