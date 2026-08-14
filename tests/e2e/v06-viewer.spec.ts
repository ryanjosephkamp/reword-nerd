import { expect, test, type Page } from "@playwright/test";

import {
  asPayload,
  hostileCsvFixture,
  hostileHtmlFixture,
  hostileJsonFixture,
  markdownFixture,
  createMultiPageSelectablePdfFixture,
  strictCodeFixture,
  unknownUtf8Fixture,
  type BrowserFixture,
} from "./fixtures";

function externalRequestMonitor(page: Page, baseURL: string) {
  const externalRequests: string[] = [];
  const appOrigin = new URL(baseURL).origin;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== appOrigin) {
      externalRequests.push(request.url());
    }
  });
  return externalRequests;
}

async function openWorkbench(page: Page) {
  await page.goto("./");
  await expect(page.getByRole("main", { name: "reword_nerd workbench" })).toBeVisible();
  const quickStart = page.getByRole("dialog", { name: "Quick start" });
  if (await quickStart.isVisible()) await quickStart.getByRole("button", { name: "Close quick start" }).click();
}

async function selectDocument(page: Page, fixture: BrowserFixture) {
  const filesTab = page.getByRole("tab", { name: "FILES" });
  if (await filesTab.isVisible()) await filesTab.click();
  const option = page.getByRole("listbox", { name: "Uploaded files" }).getByRole("option").filter({ hasText: fixture.name });
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.getByLabel(`Extracted text for ${fixture.name}`)).not.toHaveValue("");
}

async function showOriginal(page: Page) {
  const sourceTabs = page.getByRole("tablist", { name: "Source view" });
  await expect(sourceTabs.getByRole("tab")).toHaveText(["EXTRACTED TEXT", "ORIGINAL"]);
  await sourceTabs.getByRole("tab", { name: "ORIGINAL" }).click();
}

test("strict UTF-8 code and unknown text keep exact inert ORIGINAL views", async ({ page, baseURL }) => {
  const externalRequests = externalRequestMonitor(page, baseURL!);
  await openWorkbench(page);
  await page.getByLabel("Add supported files").setInputFiles([
    asPayload(strictCodeFixture),
    asPayload(unknownUtf8Fixture),
  ]);

  await selectDocument(page, strictCodeFixture);
  await showOriginal(page);
  const code = page.getByLabel("Read-only typescript source");
  await expect(code).toContainText("Strict UTF-8 source: café 😀");
  await expect(code).toContainText("export const greeting");
  const wrap = page.getByRole("button", { name: "WRAP" });
  await expect(wrap).toHaveAttribute("aria-pressed", "true");
  await wrap.focus();
  await page.keyboard.press("Enter");
  await expect(wrap).toHaveAttribute("aria-pressed", "false");

  await selectDocument(page, unknownUtf8Fixture);
  await showOriginal(page);
  await expect(page.getByLabel("Read-only plaintext source"))
    .toContainText("Unknown extension, strict UTF-8: naïve façade 東京.");
  expect(externalRequests).toEqual([]);
});

test("hostile HTML, JSON, and CSV originals stay structural, inert, and locally rendered", async ({ page, baseURL }) => {
  const externalRequests = externalRequestMonitor(page, baseURL!);
  await openWorkbench(page);
  await page.getByLabel("Add supported files").setInputFiles([
    asPayload(hostileHtmlFixture),
    asPayload(hostileJsonFixture),
    asPayload(hostileCsvFixture),
  ]);

  await selectDocument(page, hostileHtmlFixture);
  await showOriginal(page);
  const html = page.getByRole("article", { name: "HTML original preview" });
  await expect(html.getByRole("heading", { name: "Safe visible heading" })).toBeVisible();
  await expect(html.getByText("https://example.invalid/remote")).toBeVisible();
  await expect(page.locator(".source-review script, .source-review form, .source-review iframe, .source-review object, .source-review embed")).toHaveCount(0);
  await expect(page.locator(".source-review a, .source-review img")).toHaveCount(0);
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { __hostileOriginalExecuted?: boolean }).__hostileOriginalExecuted ?? false)).toBe(false);

  await selectDocument(page, hostileJsonFixture);
  await showOriginal(page);
  const jsonTabs = page.getByRole("tablist", { name: "JSON view" });
  await expect(page.getByText("Safe structured value")).toBeVisible();
  await expect(page.locator(".source-review a, .source-review img, .source-review script")).toHaveCount(0);
  await jsonTabs.getByRole("tab", { name: "RAW" }).click();
  await expect(page.getByLabel("Read-only JSON source")).toContainText("json-pixel.png");

  await selectDocument(page, hostileCsvFixture);
  await showOriginal(page);
  await expect(page.getByRole("columnheader", { name: "label" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "https://example.invalid/csv-reference" })).toBeVisible();
  await expect(page.locator(".source-review a, .source-review img, .source-review script")).toHaveCount(0);
  await page.getByRole("tablist", { name: "CSV view" }).getByRole("tab", { name: "RAW" }).click();
  await expect(page.getByLabel("Read-only CSV source")).toContainText("WEBSERVICE");

  await page.waitForTimeout(50);
  expect(externalRequests).toEqual([]);
});

test("ORIGINAL stays inert and contained at every supported mobile width", async ({ page, baseURL }) => {
  const externalRequests = externalRequestMonitor(page, baseURL!);
  await openWorkbench(page);
  await page.getByLabel("Add supported files").setInputFiles(asPayload(markdownFixture));
  await expect(page.getByLabel(`Extracted text for ${markdownFixture.name}`)).toHaveValue(/stable Markdown fact/u);
  await showOriginal(page);
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

test("multi-page PDF ORIGINAL scrolls continuously and offers a bounded page gallery", async ({ page, baseURL }) => {
  const externalRequests = externalRequestMonitor(page, baseURL!);
  const fixture = createMultiPageSelectablePdfFixture();
  await openWorkbench(page);
  await page.getByLabel("Add supported files").setInputFiles(asPayload(fixture));
  await expect(page.getByLabel(`Extracted text for ${fixture.name}`)).toHaveValue(/Continuous PDF page 6/u);
  await showOriginal(page);

  const pageWindow = page.locator(".pdf-continuous-list");
  await expect(pageWindow.getByRole("region", { name: /PDF page slot/u })).toHaveCount(6);
  const secondSlot = pageWindow.getByRole("region", { name: "PDF page slot 2" });
  await secondSlot.locator("summary").click();
  const selectableText = secondSlot.locator("details > p");
  await expect(selectableText).toContainText("Long selectable text remains readable");
  const selectableGeometry = await selectableText.evaluate((text) => {
    const details = text.closest("details");
    const slot = text.closest<HTMLElement>("[data-pdf-page]");
    const nextSlot = slot?.nextElementSibling as HTMLElement | null;
    if (!details || !slot || !nextSlot) throw new Error("Missing continuous page geometry");
    return {
      textScrollHeight: text.scrollHeight,
      textClientHeight: text.clientHeight,
      textBottom: text.getBoundingClientRect().bottom,
      detailsBottom: details.getBoundingClientRect().bottom,
      slotBottom: slot.getBoundingClientRect().bottom,
      nextTop: nextSlot.getBoundingClientRect().top,
    };
  });
  expect(selectableGeometry.textScrollHeight).toBeGreaterThan(selectableGeometry.textClientHeight);
  expect(selectableGeometry.textBottom).toBeLessThanOrEqual(selectableGeometry.detailsBottom + 0.5);
  expect(selectableGeometry.detailsBottom).toBeLessThanOrEqual(selectableGeometry.slotBottom + 0.5);
  expect(selectableGeometry.slotBottom).toBeLessThanOrEqual(selectableGeometry.nextTop + 0.5);
  await pageWindow.evaluate((windowNode) => {
    const slot = windowNode.querySelector<HTMLElement>('[data-pdf-page="4"]');
    if (!slot) throw new Error("Missing page 4 slot");
    windowNode.scrollTop = slot.offsetTop - windowNode.clientHeight / 2 + slot.offsetHeight / 2;
    windowNode.dispatchEvent(new Event("scroll"));
  });
  await expect(page.getByText("PAGE 4 / 6")).toBeVisible();

  await page.getByRole("button", { name: "GALLERY" }).click();
  const gallery = page.locator(".pdf-page-gallery");
  await expect(gallery.getByRole("button", { name: /Open PDF page \d+ of 6/u })).toHaveCount(6);
  await expect(gallery.locator("canvas")).toHaveCount(6);
  await gallery.getByRole("button", { name: "Open PDF page 6 of 6" }).click();
  await expect(page.getByText("PAGE 6 / 6")).toBeVisible();
  await expect(page.getByRole("button", { name: "CONTINUOUS", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "PDF page slot 6" })).toBeFocused();
  expect(externalRequests).toEqual([]);
});

test("the configured repository base serves the built app and assets without external requests", async ({ page, baseURL }) => {
  const externalRequests = externalRequestMonitor(page, baseURL!);
  const configured = process.env.PLAYWRIGHT_BASE_PATH ?? "/";
  const expectedPath = configured.endsWith("/") ? configured : `${configured}/`;
  await openWorkbench(page);
  expect(new URL(page.url()).pathname).toBe(expectedPath);

  const assetUrls = await page.locator('script[type="module"][src], link[rel="stylesheet"][href], img[src]').evaluateAll((elements) => elements.map((element) => {
    const value = element.getAttribute("src") ?? element.getAttribute("href") ?? "";
    return new URL(value, document.baseURI).href;
  }));
  expect(assetUrls.length).toBeGreaterThan(0);
  for (const url of assetUrls) {
    expect(new URL(url).origin).toBe(new URL(baseURL!).origin);
    expect(new URL(url).pathname.startsWith(expectedPath)).toBe(true);
  }

  await page.getByLabel("Add supported files").setInputFiles(asPayload(strictCodeFixture));
  await expect(page.getByLabel(`Extracted text for ${strictCodeFixture.name}`)).toHaveValue(/café/u);
  await page.waitForTimeout(50);
  expect(externalRequests).toEqual([]);
});
