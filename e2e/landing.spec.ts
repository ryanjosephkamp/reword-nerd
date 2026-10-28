import { expect, test } from "@playwright/test";

test("the landing page leads to the app", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Rewrite anything");
  await page.getByRole("link", { name: "Rewrite text" }).click();
  await expect(page).toHaveURL(/\/app\/$/);
  await expect(page.getByRole("button", { name: "Add files" })).toBeVisible();
});

test("the updates page lists releases", async ({ page }) => {
  await page.goto("/updates/");
  await expect(page.getByRole("heading", { name: "Updates" })).toBeVisible();
  await expect(page.getByText("Earlier releases")).toBeVisible();
});

test("the landing page fits the narrowest phones", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
