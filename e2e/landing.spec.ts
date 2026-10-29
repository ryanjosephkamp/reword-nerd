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

test("the footer links to Ryan Kamp's sites and sponsorship", async ({ page }) => {
  await page.goto("/");
  const footer = page.locator(".site-footer");
  await expect(footer.getByRole("link", { name: "Ryan Kamp", exact: true })).toHaveAttribute(
    "href",
    "https://ryanjosephkamp.github.io/",
  );
  for (const [name, href] of [
    ["Ryan Kamp’s website", "https://ryanjosephkamp.github.io/"],
    ["Ryan Kamp on GitHub", "https://github.com/ryanjosephkamp/"],
    ["Ryan Kamp on LinkedIn", "https://www.linkedin.com/in/rjk1999"],
    ["Ryan Kamp on X", "https://x.com/ryanjosephkamp"],
    ["Ryan Kamp on YouTube", "https://m.youtube.com/@RyanJosephKamp"],
    ["Sponsor on GitHub", "https://github.com/sponsors/ryanjosephkamp"],
  ]) {
    await expect(footer.getByRole("link", { name })).toHaveAttribute("href", href);
  }
});

for (const path of ["/", "/app/", "/updates/"]) {
  test(`menus on ${path} start closed and the button opens and closes them`, async ({
    page,
    isMobile,
  }) => {
    await page.goto(path);
    for (const menu of await page.locator("[popover]").all()) await expect(menu).toBeHidden();
    // The app's phone header keeps this choice in the workspace menu instead.
    if (isMobile && path === "/app/") return;
    const button = page.getByRole("button", { name: "Appearance" });
    const menu = page.getByRole("dialog", { name: "Appearance" });
    await button.click();
    await expect(menu).toBeVisible();
    await button.click();
    await expect(menu).toBeHidden();
    await button.click();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await button.click();
    await page.mouse.click(5, 300);
    await expect(menu).toBeHidden();
  });
}

test("the appearance choice carries across every page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Appearance" }).click();
  const menu = page.getByRole("dialog", { name: "Appearance" });
  await menu.getByText("Light", { exact: true }).click();
  await menu.getByText("Moss", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "moss");
  await page.goto("/app/");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "moss");
  await page.goto("/updates/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByRole("dialog", { name: "Appearance" }).getByText("Dark", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
