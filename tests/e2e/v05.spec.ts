import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { asPayload, textFixture } from "./fixtures";

const screenshotDirectory = "output/playwright/v05";

async function gotoApp(page: Page) {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("response", (response) => { if (response.status() >= 400) browserErrors.push(`${response.status()} ${response.url()}`); });
  const response = await page.goto("./");
  if (await page.locator("#root").evaluate((root) => root.childElementCount === 0)) {
    const scriptSource = await page.locator('script[type="module"][src]').getAttribute("src");
    const scriptResponse = scriptSource ? await page.request.get(new URL(scriptSource, page.url()).href) : null;
    const scriptResult = scriptResponse ? `${scriptResponse.status()} ${scriptResponse.headers()["content-type"] ?? "unknown"}` : "missing";
    throw new Error(`Application did not mount at ${page.url()} (navigation status ${response?.status() ?? "unknown"}; script ${scriptSource ?? "missing"} result ${scriptResult}; errors ${JSON.stringify(browserErrors)}).`);
  }
}

async function dismissQuickStart(page: Page) {
  const quickStart = page.getByRole("dialog", { name: "Quick start" });
  if (await quickStart.isVisible()) await quickStart.getByRole("button", { name: "Close quick start" }).click();
}

async function openWorkbench(page: Page) {
  await gotoApp(page);
  await expect(page.getByRole("main", { name: "reword_nerd workbench" })).toBeVisible();
  await dismissQuickStart(page);
}

async function buildTextPackage(page: Page) {
  await page.getByLabel("Add supported files").setInputFiles([asPayload(textFixture)]);
  await expect(page.getByLabel(`Extracted text for ${textFixture.name}`)).toHaveValue(/launch code is 314/u);
  await page.getByRole("button", { name: "Confirm review" }).click();
  await page.getByRole("button", { name: "BUILD PACKAGE" }).click();
  await expect(page.getByRole("heading", { name: "PACKAGE PREVIEW" })).toBeFocused();
}

async function assertMediaResponse(page: Page, src: string, contentType: RegExp) {
  const response = await page.request.get(new URL(src, page.url()).href);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toMatch(contentType);
}

async function assertContained(page: Page) {
  const result = await page.evaluate(() => ({
    pageWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clipped: Array.from(document.querySelectorAll<HTMLElement>("button, input, select, textarea"))
      .filter((element) => element.getClientRects().length > 0)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < -0.5 || rect.right > document.documentElement.clientWidth + 0.5;
      })
      .map((element) => element.getAttribute("aria-label") ?? element.textContent?.trim() ?? element.tagName),
  }));
  expect(result.scrollWidth).toBeLessThanOrEqual(result.pageWidth);
  expect(result.clipped).toEqual([]);
}

test("Quick Start and Help use lazy local demo media with transcripts and reduced-motion posters", async ({ page }) => {
  const requestedPaths: string[] = [];
  page.on("request", (request) => requestedPaths.push(new URL(request.url()).pathname));
  await gotoApp(page);
  const quickStart = page.getByRole("dialog", { name: "Quick start" });
  const overview = quickStart.getByLabel("reword_nerd overview demonstration");
  await expect(overview).toHaveAttribute("controls", "");
  expect(await overview.evaluate((video) => (video as HTMLVideoElement).muted)).toBe(true);
  await expect(overview).toHaveAttribute("playsinline", "");
  await expect(overview).toHaveAttribute("preload", "none");
  const overviewPoster = await overview.getAttribute("poster");
  const overviewWebm = await overview.locator('source[type="video/webm"]').getAttribute("src");
  const overviewMp4 = await overview.locator('source[type="video/mp4"]').getAttribute("src");
  expect(overviewPoster).toBeTruthy();
  expect(overviewWebm).toBeTruthy();
  expect(overviewMp4).toBeTruthy();

  const applicationScript = await page.locator('script[type="module"][src]').evaluateAll((scripts) => (
    scripts.map((script) => script.getAttribute("src")).find((src) => /(?:src\/main\.tsx|assets\/index-[^/]+\.js)$/u.test(src ?? ""))
  ));
  const basePath = new URL(applicationScript!, page.url()).pathname.replace(/(?:assets\/[^/]+|src\/main\.tsx)$/u, "");
  for (const source of [overviewPoster!, overviewWebm!, overviewMp4!]) {
    expect(new URL(source, page.url()).origin).toBe(new URL(page.url()).origin);
    expect(new URL(source, page.url()).pathname).toMatch(new RegExp(`^${basePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}media/demo/`, "u"));
  }
  await assertMediaResponse(page, overviewPoster!, /image\/webp/u);
  await assertMediaResponse(page, overviewWebm!, /video\/webm/u);
  await assertMediaResponse(page, overviewMp4!, /video\/mp4/u);
  await expect(quickStart.getByText("Video unavailable?")).toBeVisible();
  await quickStart.getByText("Read transcript").click();
  await expect(quickStart.getByText(/Choose the model profile and rewrite settings/u)).toBeVisible();
  await quickStart.getByRole("button", { name: "Close quick start" }).click();

  await page.getByRole("button", { name: "Help", exact: true }).click();
  const help = page.getByRole("dialog", { name: "Help and workflow guide" });
  await expect(help.getByLabel("Settings demonstration")).toHaveCount(0);
  expect(requestedPaths.some((path) => /\/media\/demo\/(?:settings|review|package)(?:-poster)?\.(?:webp|webm|mp4)$/u.test(path))).toBe(false);
  await help.getByRole("button", { name: "WATCH SETTINGS DEMO" }).click();
  const settingsDemo = help.getByLabel("Settings demonstration");
  await expect(settingsDemo).toBeVisible();
  await expect(help.getByLabel("Review demonstration")).toHaveCount(0);
  await expect(help.getByLabel("Package demonstration")).toHaveCount(0);
  await settingsDemo.evaluate((video) => { (video as HTMLVideoElement).currentTime = 1; });
  await help.getByRole("button", { name: "WATCH REVIEW DEMO" }).click();
  await expect(help.getByLabel("Settings demonstration")).toHaveCount(0);
  await expect(help.getByLabel("Review demonstration")).toBeVisible();
  await expect(help.getByLabel("Package demonstration")).toHaveCount(0);
  await help.getByRole("button", { name: "WATCH PACKAGE DEMO" }).click();
  await expect(help.getByLabel("Settings demonstration")).toHaveCount(0);
  await expect(help.getByLabel("Review demonstration")).toHaveCount(0);
  const packageDemo = help.getByLabel("Package demonstration");
  await expect(packageDemo).toBeVisible();
  const packageSource = await packageDemo.locator('source[type="video/webm"]').getAttribute("src");
  expect(new URL(packageSource!, page.url()).origin).toBe(new URL(page.url()).origin);
  await help.getByRole("button", { name: "Close help" }).click();
  await page.getByRole("button", { name: "Help", exact: true }).click();
  const reopenedHelp = page.getByRole("dialog", { name: "Help and workflow guide" });
  await expect(reopenedHelp.getByLabel("Settings demonstration")).toHaveCount(0);
  await expect(reopenedHelp.getByLabel("Review demonstration")).toHaveCount(0);
  await expect(reopenedHelp.getByLabel("Package demonstration")).toHaveCount(0);
});

test("reduced motion replaces demo playback with the local static poster", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoApp(page);
  const quickStart = page.getByRole("dialog", { name: "Quick start" });
  await expect(quickStart.getByLabel("reword_nerd overview demonstration")).toHaveCount(0);
  const poster = quickStart.getByRole("img", { name: "reword_nerd overview demonstration poster" });
  await expect(poster).toBeVisible();
  expect(new URL((await poster.getAttribute("src"))!, page.url()).origin).toBe(new URL(page.url()).origin);
});

test("Info is branded, versioned, exact-link-only, and dismisses from the backdrop", async ({ page }) => {
  await openWorkbench(page);
  const infoButton = page.getByRole("button", { name: "Info" });
  await infoButton.click();
  const info = page.getByRole("dialog", { name: "About reword-nerd" });
  await expect(info).toContainText("reword-nerd v0.5.1");
  await expect(info).toContainText("Files, extraction, package generation, and previews remain on this device.");
  const logo = info.getByRole("img", { name: "reword-nerd logo" });
  await expect(logo).toHaveAttribute("src", /\/brand\/reword-nerd-logo\.webp$/u);
  expect(await logo.evaluate((image) => ({ width: (image as HTMLImageElement).naturalWidth, height: (image as HTMLImageElement).naturalHeight })))
    .toEqual({ width: 512, height: 512 });

  const expectedLinks = [
    ["Repository", "https://github.com/ryanjosephkamp/reword-nerd"],
    ["GitHub profile", "https://github.com/ryanjosephkamp/"],
    ["Website", "https://ryanjosephkamp.github.io"],
    ["Sponsor", "https://github.com/sponsors/ryanjosephkamp"],
  ] as const;
  for (const [label, href] of expectedLinks) {
    const link = info.getByRole("link", { name: label, exact: true });
    await expect(link).toHaveAttribute("href", href);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }
  await expect(info.getByText("Built by").getByRole("link", { name: "Ryan Kamp" })).toHaveAttribute("href", "https://ryanjosephkamp.github.io");
  const creator = info.getByRole("region", { name: "Built by Ryan Kamp" });
  await expect(creator).toBeVisible();
  await expect(creator.getByRole("link", { name: "GitHub profile" })).toBeVisible();
  await expect(creator.getByRole("link", { name: "Repository" })).toHaveCount(0);
  mkdirSync(screenshotDirectory, { recursive: true });
  await page.screenshot({ path: `${screenshotDirectory}/info-desktop.png`, animations: "disabled" });

  await page.locator(".dialog-backdrop").click({ position: { x: 4, y: 4 } });
  await expect(info).toBeHidden();
  await expect(infoButton).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.getByRole("button", { name: "Menu" });
  await menu.click();
  await page.getByLabel("Mobile utilities").getByRole("button", { name: "Info" }).click();
  await expect(info).toBeVisible();
  await assertContained(page);
  await page.screenshot({ path: `${screenshotDirectory}/info-mobile-390x844.png`, animations: "disabled" });
  await page.locator(".dialog-backdrop").click({ position: { x: 4, y: 4 } });
  await expect(menu).toBeFocused();
});

test("mobile visual assets support a persistent detail selection and compact gallery", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkbench(page);
  const firstPng = readFileSync("public/brand/favicon-16.png").toString("base64");
  const secondPng = readFileSync("public/brand/favicon-32.png").toString("base64");
  const source = `# Gallery fixture\n\n![Figure one](data:image/png;base64,${firstPng})\n\n![Figure two](data:image/png;base64,${secondPng})\n`;
  await page.getByLabel("Add supported files").setInputFiles({
    name: "gallery.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source, "utf8"),
  });
  await expect(page.getByLabel("Extracted text for gallery.md")).toHaveValue(/asset:asset-/u);
  await page.getByRole("button", { name: "ASSETS" }).click();
  await expect(page.getByRole("heading", { name: "Figure one" })).toBeVisible();
  await page.getByRole("button", { name: "GALLERY", exact: true }).click();
  const gallery = page.getByRole("list", { name: "Visual asset gallery" });
  await expect(gallery.getByRole("listitem")).toHaveCount(2);
  await gallery.getByRole("button", { name: "Select Figure two, included" }).click();
  await expect(gallery.getByRole("button", { name: "Select Figure two, included" })).toHaveAttribute("aria-pressed", "true");
  mkdirSync(screenshotDirectory, { recursive: true });
  await page.screenshot({ path: `${screenshotDirectory}/asset-gallery-mobile-390x844.png`, animations: "disabled" });
  await page.getByRole("button", { name: "DETAIL", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Figure two" })).toBeVisible();
  await expect(page.getByText("2 / 2")).toBeVisible();
  await assertContained(page);
});

test("mobile One-shot exposes a contextual copy control for the edited prompt", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkbench(page);
  await buildTextPackage(page);
  await page.getByRole("tab", { name: "ONE-SHOT" }).click();
  const prompt = page.getByRole("textbox", { name: "Editable One-shot prompt" });
  await prompt.fill("EXACT MOBILE ONE-SHOT\nWITH A SECOND LINE");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: (value: string) => { (window as unknown as { copiedPrompt: string }).copiedPrompt = value; } },
    });
  });
  const contextualCopy = page.getByRole("button", { name: "Copy One-shot", exact: true });
  await contextualCopy.click();
  await expect(page.getByRole("status")).toHaveText("One-shot prompt copied.");
  expect(await page.evaluate(() => (window as unknown as { copiedPrompt: string }).copiedPrompt))
    .toBe("EXACT MOBILE ONE-SHOT\nWITH A SECOND LINE");
  await expect(contextualCopy).toBeFocused();
});

test("desktop Settings collapses into Preview without moving Files or invalidating a built package", async ({ page }) => {
  await openWorkbench(page);
  await buildTextPackage(page);
  const settingsButton = page.getByRole("button", { name: "Settings" });
  const settingsPanel = page.locator("#panel-settings");
  const filesPanel = page.locator("#panel-files");
  const previewPanel = page.locator("#panel-preview");
  await expect(settingsButton).toHaveAttribute("aria-expanded", "true");
  await expect(settingsButton).toHaveAttribute("aria-controls", "panel-settings");
  await expect(settingsPanel).toBeVisible();
  const before = await Promise.all([filesPanel.boundingBox(), previewPanel.boundingBox()]);

  await settingsButton.click();
  await expect(settingsButton).toHaveAttribute("aria-expanded", "false");
  await expect(settingsPanel).toBeHidden();
  const after = await Promise.all([filesPanel.boundingBox(), previewPanel.boundingBox()]);
  expect(after[0]!.width).toBeCloseTo(before[0]!.width, 0);
  expect(after[1]!.width).toBeGreaterThan(before[1]!.width + 200);
  await expect(page.getByRole("button", { name: "PACKAGE", exact: true })).toBeEnabled();
  await expect(page.getByRole("tab", { name: "RUNBOOK" })).toHaveAttribute("aria-selected", "true");

  await settingsButton.click();
  await expect(settingsPanel).toBeVisible();
  await expect(page.getByRole("button", { name: "DOWNLOAD ZIP" })).toBeEnabled();
});

test("New session clears work and package progress while preserving Settings", async ({ page }) => {
  await openWorkbench(page);
  await page.getByLabel("Tone", { exact: true }).selectOption("academic");
  await page.getByLabel("Context limit", { exact: true }).fill("64000");
  await buildTextPackage(page);
  await page.getByRole("tab", { name: "MANUAL" }).click();
  await page.getByRole("textbox", { name: "Stage 1 — Decompose model response" }).fill("Ephemeral stage response");

  const newSession = page.getByRole("button", { name: "New session" });
  await newSession.click();
  const confirmation = page.getByRole("dialog", { name: "Start a new session?" });
  await expect(confirmation).toContainText("prompt edits, model responses, progress, and the built package will be lost");
  await page.locator(".dialog-backdrop").click({ position: { x: 4, y: 4 } });
  await expect(confirmation).toBeHidden();
  await expect(newSession).toBeFocused();
  await expect(page.getByRole("button", { name: "DOWNLOAD ZIP" })).toBeEnabled();

  await newSession.click();
  await page.getByRole("dialog", { name: "Start a new session?" }).getByRole("button", { name: "Start new session" }).click();
  await expect(page.getByRole("listbox", { name: "Uploaded files" }).getByRole("option")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add files", exact: true })).toBeFocused();
  await expect(page.getByLabel("Tone", { exact: true })).toHaveValue("academic");
  await expect(page.getByLabel("Context limit", { exact: true })).toHaveValue("64000");
  await expect(page.getByLabel("Extract embedded images", { exact: true })).toBeChecked();
  await expect(page.getByRole("button", { name: "PACKAGE", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "DOWNLOAD ZIP" })).toBeDisabled();
  await expect(page.getByText("New session ready. Settings kept.")).toBeAttached();
});

test("mobile Settings help remains contained at every release width and mobile New session is reachable", async ({ page }) => {
  mkdirSync(screenshotDirectory, { recursive: true });
  await openWorkbench(page);
  for (const [width, height] of [[320, 720], [360, 800], [390, 844], [412, 915]] as const) {
    await page.setViewportSize({ width, height });
    await page.getByRole("tab", { name: "SETTINGS" }).click();
    const settingsPanel = page.getByRole("tabpanel", { name: "SETTINGS" });
    const toneHelp = settingsPanel.getByRole("button", { name: "Help about Tone" });
    await toneHelp.scrollIntoViewIfNeeded();
    await toneHelp.click();
    const popover = page.getByRole("dialog", { name: "Help about Tone" });
    await expect(popover).toContainText("Academic, Professional, Technical, or Plain");
    const bounds = await popover.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
    await assertContained(page);
    await page.screenshot({ path: `${screenshotDirectory}/settings-help-${width}x${height}.png`, animations: "disabled" });
    await popover.getByRole("button", { name: "Close setting help" }).click();

    const processingHelp = settingsPanel.getByRole("button", { name: "Help about Document processing" });
    await processingHelp.scrollIntoViewIfNeeded();
    await processingHelp.click();
    const processingPopover = page.getByRole("dialog", { name: "Help about Document processing" });
    const processingBounds = await processingPopover.boundingBox();
    expect(processingBounds!.x).toBeGreaterThanOrEqual(0);
    expect(processingBounds!.x + processingBounds!.width).toBeLessThanOrEqual(width);
    expect(processingBounds!.y).toBeGreaterThanOrEqual(0);
    expect(processingBounds!.y + processingBounds!.height).toBeLessThanOrEqual(height);
    await processingPopover.getByRole("button", { name: "Close setting help" }).click();
  }

  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByLabel("Mobile utilities").getByRole("button", { name: "Info" })).toBeVisible();
  await page.getByLabel("Mobile utilities").getByRole("button", { name: "New session" }).click();
  await expect(page.getByRole("dialog", { name: "Start a new session?" })).toBeVisible();
});

test("Document processing help stays anchored and visible in desktop and tablet Settings", async ({ page }) => {
  await openWorkbench(page);

  for (const [width, height] of [[1586, 992], [1024, 768]] as const) {
    await page.setViewportSize({ width, height });
    if (width === 1024) {
      await page.getByRole("button", { name: "Settings" }).click();
    }

    const settingsSurface = width === 1024
      ? page.getByRole("dialog", { name: "Parameters" })
      : page.locator("#panel-settings");
    const processing = settingsSurface.getByRole("group", { name: "DOCUMENT PROCESSING" });
    const trigger = processing.getByRole("button", { name: "Help about Document processing" });
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();

    const popover = page.getByRole("dialog", { name: "Help about Document processing" });
    const [triggerBounds, popoverBounds] = await Promise.all([
      trigger.boundingBox(),
      popover.boundingBox(),
    ]);
    expect(popoverBounds!.x).toBeGreaterThanOrEqual(0);
    expect(popoverBounds!.x + popoverBounds!.width).toBeLessThanOrEqual(width);
    expect(popoverBounds!.y).toBeGreaterThanOrEqual(0);
    expect(popoverBounds!.y).toBeLessThanOrEqual(triggerBounds!.y + 64);
    expect(popoverBounds!.y + popoverBounds!.height).toBeGreaterThanOrEqual(triggerBounds!.y - 64);
    expect(popoverBounds!.y + popoverBounds!.height).toBeLessThanOrEqual(height);
    await popover.getByRole("button", { name: "Close setting help" }).click();

    if (width === 1024) {
      await settingsSurface.getByRole("button", { name: "Close settings" }).click();
    }
  }
});
