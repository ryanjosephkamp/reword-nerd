import { expect, test } from "@playwright/test";

async function assertContained(page: import("@playwright/test").Page) {
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clippedControls: Array.from(document.querySelectorAll<HTMLElement>("a, button"))
      .filter((element) => element.getClientRects().length > 0)
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.left < 0 || bounds.right > document.documentElement.clientWidth;
      })
      .map((element) => element.textContent?.trim() ?? element.getAttribute("aria-label")),
  }));
  expect(layout.scrollWidth).toBe(layout.clientWidth);
  expect(layout.clippedControls).toEqual([]);
}

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

test("direct Updates archive and post reloads stay contained, accessible, same-origin, and session-free across release widths", async ({ page, baseURL }) => {
  // This covers the deployed static routes rather than a client-side transition, including narrow layouts where the Share control is easiest to clip.
  const externalRequests: string[] = [];
  const consoleErrors: string[] = [];
  const appOrigin = new URL(baseURL!).origin;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== appOrigin) externalRequests.push(request.url());
  });
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

  for (const [width, height] of [[320, 720], [360, 800], [390, 844], [412, 915], [768, 1024], [1440, 1000]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("updates/");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Updates", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "reword-nerd v0.7: Updates, feedback, and Share" })).toHaveAttribute("href", "/reword-nerd/updates/v0-7-0/");
    await expect(page.getByRole("navigation", { name: "Feedback links" }).getByRole("link", { name: "Report a bug" }))
      .toHaveAttribute("href", "https://github.com/ryanjosephkamp/reword-nerd/issues/new?template=bug_report.yml");
    await assertContained(page);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Updates", exact: true })).toBeVisible();
    await assertContained(page);
  }

  await page.goto("updates/v0-7-0/");
  await expect(page.getByRole("heading", { name: "reword-nerd v0.7: Updates, feedback, and Share" })).toBeVisible();
  await expect(page.locator("video")).toHaveAttribute("preload", "none");
  await expect(page.getByRole("link", { name: "Read the transcript" })).toHaveAttribute("href", "/reword-nerd/media/updates/v0-7-0/transcript.txt");
  await assertContained(page);
  await page.reload();
  await expect(page.locator("video")).toBeVisible();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.locator(".release-video-motion")).toBeHidden();
  await expect(page.locator(".release-video-poster img")).toBeVisible();
  await assertContained(page);

  for (const path of [
    "/reword-nerd/updates/feed.xml",
    "/reword-nerd/sitemap.xml",
    "/reword-nerd/media/updates/v0-7-0/release-update.mp4",
    "/reword-nerd/media/updates/v0-7-0/release-update.webm",
    "/reword-nerd/media/updates/v0-7-0/poster.webp",
    "/reword-nerd/media/updates/v0-7-0/transcript.txt",
  ]) expect((await page.request.get(new URL(path, baseURL!).href)).ok()).toBe(true);

  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  expect(externalRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("static archive Share copies its canonical URL when native Share is unavailable", async ({ page }) => {
  // A usable clipboard fallback must not quietly replace the clean archive URL with a session-derived location.
  await page.goto("updates/");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => { (window as typeof window & { copiedUrl?: string }).copiedUrl = value; } },
    });
  });
  const share = page.getByRole("button", { name: "Share" });
  await share.click();
  await expect(page.locator("#share-status")).toHaveText("Link copied.");
  expect(await page.evaluate(() => (window as typeof window & { copiedUrl?: string }).copiedUrl))
    .toBe("https://ryanjosephkamp.github.io/reword-nerd/updates/");
  await expect(page.getByRole("dialog", { name: "Share link" })).toHaveCount(0);
  await expect(share).toBeFocused();
});
