import { expect, test } from "@playwright/test";

test("Image keeps its local links and keyboard focus orange without recoloring Text", async ({ page }) => {
  // This catches generic Image controls falling back to the Text teal interaction color.
  await page.goto("image/");
  await expect(page.getByRole("main", { name: "reword_nerd Image portal" })).toBeVisible();

  const textPortal = page.getByRole("link", { name: "TEXT" });
  const imagePortal = page.getByRole("link", { name: "IMAGE" });
  await page.getByRole("button", { name: "Info" }).click();
  const updates = page.getByRole("link", { name: "Updates" });
  const community = page.getByRole("link", { name: "Community" });
  await expect.poll(() => textPortal.evaluate((element) => getComputedStyle(element).color)).toBe("rgb(66, 232, 180)");
  await expect.poll(() => imagePortal.evaluate((element) => getComputedStyle(element).color)).toBe("rgb(255, 159, 28)");
  await expect.poll(() => updates.evaluate((element) => getComputedStyle(element).color)).toBe("rgb(255, 159, 28)");
  await expect.poll(() => community.evaluate((element) => getComputedStyle(element).color)).toBe("rgb(255, 159, 28)");

  const info = page.getByRole("button", { name: "Info", exact: true });
  await page.getByRole("button", { name: "Close Image info" }).click();
  await info.focus();
  await page.keyboard.press("Tab");
  const share = page.getByRole("button", { name: "Share" });
  await expect(share).toBeFocused();
  await expect.poll(() => share.evaluate((element) => getComputedStyle(element).outlineColor)).toBe("rgb(255, 159, 28)");
});
