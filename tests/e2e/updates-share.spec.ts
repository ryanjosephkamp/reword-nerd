import { expect, test } from "@playwright/test";

test("static Updates content and its optional same-origin Share module keep URLs canonical", async ({ page, baseURL }) => {
  // The pipeline test separately proves no-JavaScript usefulness; this catches an external service call or sharing browser session state.
  const externalRequests: string[] = [];
  const appOrigin = new URL(baseURL!).origin;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== appOrigin) externalRequests.push(request.url());
  });

  await page.goto("updates/v0-7-0/");
  await expect(page.getByRole("heading", { name: "reword-nerd v0.7: Updates, feedback, and Share" })).toBeVisible();
  await expect(page.getByLabel("Feedback links").getByRole("link", { name: "Report a bug" })).toHaveAttribute("href", "https://github.com/ryanjosephkamp/reword-nerd/issues/new?template=bug_report.yml");
  const share = page.getByRole("button", { name: "Share" });
  await expect(share).toHaveAttribute("data-share-url", "https://ryanjosephkamp.github.io/reword-nerd/updates/v0-7-0/");

  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: (payload: ShareData) => { (window as typeof window & { sharedPayload?: ShareData }).sharedPayload = payload; return Promise.resolve(); },
    });
  });
  await share.click();
  await expect(page.locator("#share-status")).toHaveText("Link shared.");
  expect(await page.evaluate(() => (window as typeof window & { sharedPayload?: ShareData }).sharedPayload)).toEqual({
    title: "reword-nerd v0.7: Updates, feedback, and Share",
    url: "https://ryanjosephkamp.github.io/reword-nerd/updates/v0-7-0/",
  });

  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } });
    Object.defineProperty(document, "execCommand", { configurable: true, value: () => false });
  });
  await share.click();
  const fallback = page.getByRole("dialog", { name: "Share link" });
  const url = fallback.getByRole("textbox", { name: "Share URL" });
  await expect(url).toHaveValue("https://ryanjosephkamp.github.io/reword-nerd/updates/v0-7-0/");
  await expect(url).toBeFocused();
  await expect(url).toHaveJSProperty("selectionStart", 0);
  await fallback.getByRole("button", { name: "Close" }).click();
  await expect(share).toBeFocused();
  expect(externalRequests).toEqual([]);
});
