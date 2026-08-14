import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const PRIVATE_FILENAME = "local-private-source.png";
const OCR_MARKER = "OCR-E2E-PRIVATE";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const visualEvidenceDirectory = process.env.IMAGE_A11Y_SCREENSHOT_DIR;

async function captureEvidence(page: Page, name: string): Promise<void> {
  if (!visualEvidenceDirectory) return;
  mkdirSync(visualEvidenceDirectory, { recursive: true });
  await page.screenshot({ path: join(visualEvidenceDirectory, name), animations: "disabled" });
}

function tinyPdf(): Buffer {
  const stream = "1 0.5 0 rg\n0 0 32 24 re f\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 32 24] /Resources << >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source, "ascii");
}

async function installUrlAudit(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const live = new Set<string>();
    const audit = { created: 0, revoked: 0, peak: 0, live };
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (source) => {
      const url = create(source);
      if (source instanceof Blob && source.type.startsWith("image/")) {
        audit.created += 1;
        live.add(url);
        audit.peak = Math.max(audit.peak, live.size);
      }
      return url;
    };
    URL.revokeObjectURL = (url) => {
      if (live.delete(url)) audit.revoked += 1;
      revoke(url);
    };
    Object.defineProperty(window, "__imageUrlAudit", { value: audit });
  });
}

async function openWorkbench(page: Page): Promise<void> {
  await page.goto("image/");
  await expect(page.getByRole("main", { name: "reword_nerd Image workbench" })).toBeVisible();
  const start = page.getByRole("button", { name: "START LOCAL SESSION" });
  if (await start.isVisible()) await start.click();
}

test("real PNG workflow stays local, keeps package actions truthful, and releases URLs", async ({ page }) => {
  test.setTimeout(120_000);
  const requests: Array<{ method: string; url: string }> = [];
  page.on("request", (request) => requests.push({ method: request.method(), url: request.url() }));
  await installUrlAudit(page);
  await openWorkbench(page);

  await page.getByLabel("Add image files").setInputFiles({
    name: PRIVATE_FILENAME,
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.getByRole("button", { name: `Focus ${PRIVATE_FILENAME}` })).toBeVisible();
  await expect(page.getByRole("region", { name: "Image queue" })).toContainText("1 × 1");
  await expect(page.getByRole("img", { name: `Focused source ${PRIVATE_FILENAME}` })).toBeVisible();

  await page.getByRole("checkbox", { name: `Select ${PRIVATE_FILENAME}` }).check();
  await page.getByRole("button", { name: "SELECTED [1]" }).click();
  await page.getByRole("checkbox", { name: "Apply Model family" }).check();
  await page.getByLabel("Selected model family").selectOption("google-nano-banana");
  await page.getByRole("button", { name: "APPLY TO 1 IMAGES" }).click();
  await expect(page.getByLabel("Focused model family")).toHaveValue("google-nano-banana");

  await page.getByRole("button", { name: "RUN OCR", exact: true }).click();
  await expect(page.getByText("NEEDS REVIEW", { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Reviewed OCR text").fill(OCR_MARKER);
  await page.getByRole("button", { name: "ACCEPT REVIEWED OCR" }).click();
  await expect(page.getByRole("region", { name: "Prompt prose" })).toContainText(OCR_MARKER);

  await page.getByRole("button", { name: "CONFIRM IMAGE SET" }).click();
  await expect(page.getByText(/creates a local ZIP in memory/iu)).toBeVisible();
  await expect(page.getByRole("button", { name: "BUILD PACKAGE" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "DOWNLOAD ZIP" })).toBeDisabled();
  await expect(page.getByRole("article", { name: "Package preview" })).toContainText("No package has been built.");

  await page.getByRole("button", { name: `Omit ${PRIVATE_FILENAME}` }).click();
  await expect(page.getByText("Include at least one image.")).toBeVisible();
  await page.getByRole("button", { name: `Include ${PRIVATE_FILENAME}` }).click();
  await page.getByRole("button", { name: "New session" }).click();
  await page.getByRole("dialog", { name: "Start a new Image session?" })
    .getByRole("button", { name: "CLEAR IMAGE SESSION" }).click();
  await expect(page.getByText("No images in this local session.")).toBeVisible();

  const urlAudit = await page.evaluate(() => {
    const value = (window as unknown as Window & {
      __imageUrlAudit: { created: number; revoked: number; peak: number; live: Set<string> };
    }).__imageUrlAudit;
    return { created: value.created, revoked: value.revoked, peak: value.peak, live: value.live.size };
  });
  expect(urlAudit.created).toBeGreaterThan(0);
  expect(urlAudit.live).toBe(0);
  expect(urlAudit.revoked).toBe(urlAudit.created);
  expect(urlAudit.peak).toBeLessThanOrEqual(37);

  const storage = await page.evaluate(() => Object.fromEntries(
    Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index) ?? "";
      return [key, localStorage.getItem(key) ?? ""];
    }),
  ));
  expect(Object.keys(storage)).toEqual(["reword-nerd:image-preferences:v1"]);
  const serialized = Object.values(storage).join("\n");
  expect(serialized).not.toContain(PRIVATE_FILENAME);
  expect(serialized).not.toContain(OCR_MARKER);
  expect(serialized).not.toContain(PNG.toString("base64").slice(0, 24));
  expect(serialized).not.toContain("No package has been built");

  const pageOrigin = new URL(page.url()).origin;
  for (const request of requests) {
    const url = new URL(request.url);
    if (url.protocol === "http:" || url.protocol === "https:") expect(url.origin).toBe(pageOrigin);
    expect(request.method).toBe("GET");
  }
});

test("real one-page PDF capture and direct drop admit local images through the public facade", async ({ page }) => {
  test.setTimeout(90_000);
  await openWorkbench(page);
  await page.getByLabel("Add image files").setInputFiles({
    name: "tiny-local.pdf",
    mimeType: "application/pdf",
    buffer: tinyPdf(),
  });
  const capture = page.getByRole("dialog", { name: "Capture PDF pages" });
  await expect(capture).toContainText("1 page");
  await capture.getByLabel("EMBEDDED + SELECTED PAGES").check();
  await capture.getByLabel("PDF pages").fill("1");
  await capture.getByLabel("STANDARD").check();
  await capture.getByRole("button", { name: "USE PDF CHOICE" }).click();
  await expect(page.getByRole("button", { name: "Focus pdf-page-001-capture.png" })).toBeVisible({ timeout: 30_000 });

  await page.locator(".image-intake-target").evaluate((target, encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "dropped-local.png", { type: "image/png" }));
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, PNG.toString("base64"));
  await expect(page.getByRole("button", { name: "Focus dropped-local.png" })).toBeVisible();
});

test("locked desktop, tablet, and mobile layouts stay contained and keyboard operable", async ({ page }) => {
  const sizes = [
    { width: 320, height: 720, mode: "mobile" },
    { width: 360, height: 800, mode: "mobile" },
    { width: 390, height: 844, mode: "mobile" },
    { width: 412, height: 915, mode: "mobile" },
    { width: 1024, height: 768, mode: "tablet" },
    { width: 1586, height: 992, mode: "desktop" },
  ] as const;
  for (const size of sizes) {
    await page.setViewportSize(size);
    await openWorkbench(page);
    await expect(page.getByRole("main", { name: "reword_nerd Image workbench" })).toHaveAttribute(
      "data-responsive-mode",
      size.mode,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.reload();
  const settingsTrigger = page.getByRole("button", { name: "Settings" });
  await settingsTrigger.focus();
  await settingsTrigger.click();
  const drawer = page.getByRole("dialog", { name: "Image settings" });
  await expect(drawer).toBeVisible();
  await drawer.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(settingsTrigger).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const images = page.getByRole("tab", { name: "IMAGES" });
  const preview = page.getByRole("tab", { name: "PREVIEW" });
  const settings = page.getByRole("tab", { name: "SETTINGS", exact: true });
  await images.focus();
  await page.keyboard.press("End");
  await expect(settings).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(preview).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(images).toHaveAttribute("aria-selected", "true");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => page.locator(".image-panel").first().evaluate((element) => (
    Number.parseFloat(getComputedStyle(element).transitionDuration)
  ))).toBeLessThanOrEqual(0.00001);
});

test("Quick Start opens at its title and artwork instead of auto-scrolling to the CTA", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("image/");
  const dialog = page.getByRole("dialog", { name: "Image Quick Start" });

  await expect(dialog).toBeFocused();
  await expect(dialog.getByRole("heading", { name: "Image Quick Start" })).toBeVisible();
  await expect(dialog.getByRole("img", { name: "Orange pyramid artwork" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close Image Quick Start" })).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollTop)).toBe(0);
  await captureEvidence(page, "quick-start-top-320x568.png");
});

test("Image identity, modal accents, and close controls use the orange visual system", async ({ page }) => {
  await page.setViewportSize({ width: 1246, height: 1610 });
  await openWorkbench(page);
  await expect(page.getByRole("heading", { name: "reword_nerd/" })).toHaveCSS("color", "rgb(255, 159, 28)");

  const assertCenteredClose = async (dialogName: string, closeName: string) => {
    const dialog = page.getByRole("dialog", { name: dialogName });
    const close = dialog.getByRole("button", { name: closeName });
    const centers = await close.evaluate((button) => {
      const icon = button.querySelector("svg");
      if (!icon) throw new Error("Missing close icon");
      const buttonBox = button.getBoundingClientRect();
      const iconBox = icon.getBoundingClientRect();
      return {
        x: Math.abs((buttonBox.left + buttonBox.width / 2) - (iconBox.left + iconBox.width / 2)),
        y: Math.abs((buttonBox.top + buttonBox.height / 2) - (iconBox.top + iconBox.height / 2)),
      };
    });
    expect(centers.x).toBeLessThanOrEqual(0.5);
    expect(centers.y).toBeLessThanOrEqual(0.5);
    await expect(dialog).toHaveCSS("border-color", "rgb(255, 159, 28)");
    return close;
  };

  await page.getByRole("button", { name: "Help" }).click();
  const helpClose = await assertCenteredClose("Image Help", "Close Image Help");
  await helpClose.click();

  await page.getByRole("button", { name: "Info" }).click();
  const info = page.getByRole("dialog", { name: "About reword-nerd Image" });
  const infoClose = await assertCenteredClose("About reword-nerd Image", "Close Image info");
  await expect(info.locator(".info-group").first()).toHaveCSS("border-color", "rgb(255, 159, 28)");
  await expect(info.getByRole("link", { name: "Updates" })).toHaveCSS("border-color", "rgb(255, 159, 28)");
  await captureEvidence(page, "image-info-orange-1246x1610.png");
  await infoClose.click();
});

test("settings remain unobscured and usable at every audited width", async ({ page }) => {
  const sizes = [
    { width: 320, height: 720, mode: "mobile" },
    { width: 390, height: 844, mode: "mobile" },
    { width: 412, height: 915, mode: "mobile" },
    { width: 1024, height: 768, mode: "tablet" },
    { width: 1586, height: 992, mode: "desktop" },
  ] as const;

  for (const size of sizes) {
    await page.setViewportSize(size);
    await openWorkbench(page);
    if (size.mode === "mobile") {
      const settingsTab = page.getByRole("tab", { name: "SETTINGS", exact: true });
      await settingsTab.click();
      expect(await settingsTab.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          actionColor: style.getPropertyValue("--image-action").trim(),
          backgroundColor: style.backgroundColor,
          color: style.color,
        };
      })).toEqual({
        actionColor: "#ff9f1c",
        backgroundColor: "rgb(255, 159, 28)",
        color: "rgb(25, 19, 10)",
      });
    }
    if (size.mode === "tablet") await page.getByRole("button", { name: "Settings" }).click();

    const surface = size.mode === "tablet"
      ? page.getByRole("dialog", { name: "Image settings" })
      : page.getByRole("region", { name: "Image settings" });
    const fields = surface.locator(".image-settings-fields").first();
    const dock = surface.locator(".image-build-dock");
    const [fieldsBox, dockBox] = await Promise.all([fields.boundingBox(), dock.boundingBox()]);
    expect(fieldsBox).not.toBeNull();
    expect(dockBox).not.toBeNull();
    expect(dockBox!.y + dockBox!.height).toBeLessThanOrEqual(size.height + 1);
    expect(dockBox!.y).toBeLessThan(fieldsBox!.y);
    await expect(page.getByRole("button", { name: "BUILD PACKAGE" })).toHaveCount(1);
    await expect(surface.getByRole("button", { name: "BUILD PACKAGE" })).toBeVisible();
    if (size.mode === "mobile") {
      const tabsBox = await page.getByRole("tablist", { name: "Image workbench panels" }).boundingBox();
      expect(tabsBox).not.toBeNull();
      expect(dockBox!.y + dockBox!.height).toBeLessThanOrEqual(tabsBox!.y + 1);
    }
    const modelSelect = surface.getByLabel("Default model family");
    await expect(modelSelect).toHaveCSS("background-color", "rgb(9, 11, 16)");
    await expect(modelSelect).toHaveCSS("color", "rgb(215, 221, 232)");

    const packagePreview = surface.getByRole("article", { name: "Package preview" });
    await packagePreview.scrollIntoViewIfNeeded();
    await expect(packagePreview).toBeVisible();
    await captureEvidence(page, `settings-bottom-${size.width}x${size.height}.png`);
  }
});

test("tablet header separates brand, local-session copy, and actions", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openWorkbench(page);
  const groups = page.locator(".image-header > :is(.brand-portal, .image-session-copy, .image-header-actions)");
  const boxes = await groups.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
  }));

  expect(boxes).toHaveLength(3);
  expect(boxes[1].left - boxes[0].right).toBeGreaterThanOrEqual(16);
  expect(boxes[2].left - boxes[1].right).toBeGreaterThanOrEqual(16);
  expect(boxes[0].bottom).toBeLessThanOrEqual(boxes[1].bottom + 24);
  await captureEvidence(page, "header-spacing-1024x768.png");
});

test("thirty-image queue rotates the bounded thumbnail leases with its real scroll viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1586, height: 992 });
  await installUrlAudit(page);
  await openWorkbench(page);
  await page.getByLabel("Add image files").setInputFiles(Array.from({ length: 30 }, (_, index) => ({
    name: `batch-${String(index + 1).padStart(2, "0")}.png`,
    mimeType: "image/png",
    buffer: PNG,
  })));

  const queue = page.getByRole("region", { name: "Image queue" });
  const topVisibleRow = page.getByRole("group", { name: "batch-02.png image controls" });
  const lastRow = page.getByRole("group", { name: "batch-30.png image controls" });
  await expect(lastRow).toBeAttached();
  await expect.poll(() => topVisibleRow.locator(".image-thumbnail-frame img").count()).toBe(1);
  await expect.poll(() => lastRow.locator(".image-thumbnail-frame img").count()).toBe(0);

  const activeIds = () => queue.locator("[data-image-id]").evaluateAll((rows) => rows.flatMap((row) => (
    row.querySelector(".image-thumbnail-frame img") && row instanceof HTMLElement && row.dataset.imageId
      ? [row.dataset.imageId]
      : []
  )));
  const before = await activeIds();
  expect(before.length).toBeLessThanOrEqual(24);
  await captureEvidence(page, "thumbnail-window-top-30.png");

  await queue.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => lastRow.locator(".image-thumbnail-frame img").count()).toBe(1);
  const after = await activeIds();
  expect(after.length).toBeLessThanOrEqual(24);
  expect(after).not.toEqual(before);
  await captureEvidence(page, "thumbnail-window-bottom-30.png");

  const audit = await page.evaluate(() => {
    const value = (window as unknown as Window & {
      __imageUrlAudit: { peak: number; live: Set<string> };
    }).__imageUrlAudit;
    return { live: value.live.size, peak: value.peak };
  });
  expect(audit.live).toBeLessThanOrEqual(37);
  expect(audit.peak).toBeLessThanOrEqual(37);
});
