import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Download, type Page } from "@playwright/test";
import JSZip from "jszip";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const IMAGE_PACKAGE_FILENAME = "reword-nerd-image-prompt-package.zip";

async function downloadBytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function openWorkbench(page: Page): Promise<void> {
  await page.goto("image/");
  await expect(page.getByRole("main", { name: "reword_nerd Image workbench" })).toBeVisible();
  const start = page.getByRole("button", { name: "START LOCAL SESSION" });
  if (await start.isVisible()) await start.click();
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

test("real local Image package is deterministic, portable, stale-safe, and side-effect bounded", async ({ page, context }) => {
  test.setTimeout(180_000);
  const requests: Array<{ method: string; url: string }> = [];
  const downloads: string[] = [];
  page.on("request", (request) => requests.push({ method: request.method(), url: request.url() }));
  page.on("download", (download) => downloads.push(download.suggestedFilename()));

  await openWorkbench(page);
  await page.reload();
  await expect(page.getByRole("main", { name: "reword_nerd Image workbench" })).toBeVisible();
  await page.getByLabel("Add image files").setInputFiles([
    { name: "one.png", mimeType: "image/png", buffer: PNG },
    { name: "two.png", mimeType: "image/png", buffer: PNG },
  ]);
  await expect(page.getByRole("button", { name: "Focus two.png" })).toBeVisible();
  const secondQueueCard = page.getByRole("group", { name: "two.png image controls" });
  await secondQueueCard.getByText("two.png", { exact: true }).click();
  await expect(secondQueueCard.getByRole("button", { name: "Focus two.png" })).toHaveAttribute("aria-current", "true");
  await page.getByRole("checkbox", { name: "Select one.png" }).check();
  await page.getByRole("checkbox", { name: "Select two.png" }).check();
  await page.getByRole("button", { name: "SELECTED [2]" }).click();
  await page.getByRole("checkbox", { name: "Apply Model family" }).check();
  await page.getByLabel("Selected model family").selectOption("ideogram");
  await page.getByRole("button", { name: "APPLY TO 2 IMAGES" }).click();
  await page.getByRole("button", { name: "CONFIRM IMAGE SET" }).click();

  await page.getByRole("button", { name: "BUILD PACKAGE" }).click();
  await expect(page.getByRole("button", { name: "DOWNLOAD ZIP" })).toBeEnabled({ timeout: 60_000 });
  const packageHash = page.locator(".image-package-hash");
  await expect(packageHash).toHaveText(/^[a-f0-9]{64}$/u);
  expect(await packageHash.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(downloads).toEqual([]);
  const pairs = page.getByRole("region", { name: "Built package pairs" });
  await expect(pairs.getByRole("group", { name: "one.png built package pair" })).toBeVisible();
  await expect(pairs.getByRole("group", { name: "two.png built package pair" })).toBeVisible();

  await page.evaluate(() => {
    const audit = { prompts: [] as string[], imageWrites: 0 };
    Object.defineProperty(window, "__imageClipboardAudit", { configurable: true, value: audit });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => { audit.prompts.push(text); },
        write: async () => { audit.imageWrites += 1; },
      },
    });
  });
  const firstPair = pairs.getByRole("group", { name: "one.png built package pair" });
  await expect(firstPair.getByRole("img", { name: "Built source one.png" })).toBeVisible();
  await firstPair.getByRole("button", { name: "COPY PROMPT" }).click();
  await expect(firstPair.getByRole("status")).toContainText("Prompt copied.");
  await firstPair.getByRole("button", { name: "COPY IMAGE" }).click();
  await expect(firstPair.getByRole("status")).toContainText("Image copied.");
  expect(await page.evaluate(() => (window as unknown as {
    __imageClipboardAudit: { prompts: string[]; imageWrites: number };
  }).__imageClipboardAudit)).toMatchObject({ prompts: [expect.stringContaining("Faithful rendition")], imageWrites: 1 });

  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });
  await firstPair.getByRole("button", { name: "COPY PROMPT" }).click();
  await expect(firstPair.getByRole("status")).toContainText("Prompt selected — copy manually.");
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toContain("Faithful rendition");
  await firstPair.getByRole("button", { name: "COPY IMAGE" }).click();
  await expect(firstPair.getByRole("status")).toContainText("Copy unavailable");
  await expect(firstPair.getByRole("link", { name: "OPEN IMAGE" })).toHaveAttribute("href", /^blob:/u);
  await expect(firstPair.getByRole("link", { name: "DOWNLOAD IMAGE" })).toHaveAttribute("download", "source.png");

  const firstDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "DOWNLOAD ZIP" }).click();
  const firstArchive = await firstDownload;
  expect(firstArchive.suggestedFilename()).toBe(IMAGE_PACKAGE_FILENAME);
  const firstBytes = await downloadBytes(firstArchive);
  expect(downloads).toEqual([IMAGE_PACKAGE_FILENAME]);

  const archive = await JSZip.loadAsync(firstBytes, { checkCRC32: true });
  const tree = Object.values(archive.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name)
    .sort();
  expect(tree).toEqual([
    "OPEN-ME-FULL.html",
    "OPEN-ME.html",
    "README.md",
    "manifest.json",
    "pairs/001-one/OPEN-ME.html",
    "pairs/001-one/metadata.json",
    "pairs/001-one/prompt.txt",
    "pairs/001-one/run-card.md",
    "pairs/001-one/source.png",
    "pairs/002-two/OPEN-ME.html",
    "pairs/002-two/metadata.json",
    "pairs/002-two/prompt.txt",
    "pairs/002-two/run-card.md",
    "pairs/002-two/source.png",
  ]);
  const manifest = JSON.parse(await archive.file("manifest.json")!.async("string")) as {
    package: { pairCount: number };
    privacy: { originalContainersIncluded: boolean; sourceBytesMayRetainExifOrLocation: boolean };
    pairs: Array<{ source: { path: string; sha256: string } }>;
    artifactInventory: Array<{ path: string; byteCount: number; sha256: string }>;
    rootArtifacts: { fullOpenMe: { status: string } };
  };
  expect(manifest.package.pairCount).toBe(2);
  expect(manifest.privacy).toMatchObject({ originalContainersIncluded: false, sourceBytesMayRetainExifOrLocation: true });
  expect(manifest.rootArtifacts.fullOpenMe.status).toBe("generated");
  expect(manifest.pairs.map((pair) => pair.source.path)).toEqual([
    "pairs/001-one/source.png",
    "pairs/002-two/source.png",
  ]);
  for (const sourcePath of manifest.pairs.map((pair) => pair.source.path)) {
    expect(await archive.file(sourcePath)!.async("nodebuffer")).toEqual(PNG);
  }
  expect(manifest.artifactInventory.map((entry) => entry.path)).toEqual(tree.filter((path) => path !== "manifest.json"));
  for (const record of manifest.artifactInventory) {
    const bytes = await archive.file(record.path)!.async("nodebuffer");
    expect(record.byteCount).toBe(bytes.byteLength);
    expect(record.sha256).toBe(digest(bytes));
  }
  expect(await archive.file("README.md")!.async("string")).toMatch(/EXIF|location/u);
  expect(tree.every((path) => !/\.pdf$|\.docx$|\.zip$/u.test(path))).toBe(true);

  await page.getByRole("button", { name: "BUILD PACKAGE" }).click();
  await expect(page.getByRole("button", { name: "DOWNLOAD ZIP" })).toBeEnabled();
  const secondDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "DOWNLOAD ZIP" }).click();
  const secondBytes = await downloadBytes(await secondDownload);
  expect(secondBytes).toEqual(firstBytes);
  expect(digest(secondBytes)).toBe(digest(firstBytes));

  for (const viewport of [{ width: 320, height: 720 }, { width: 390, height: 844 }, { width: 1586, height: 992 }]) {
    await page.setViewportSize(viewport);
    if (viewport.width < 768) await page.getByRole("tab", { name: "PREVIEW" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }

  const storage = await page.evaluate(() => Object.fromEntries(
    Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index) ?? "";
      return [key, localStorage.getItem(key) ?? ""];
    }),
  ));
  expect(Object.keys(storage)).toEqual(["reword-nerd:image-preferences:v1"]);
  const persisted = Object.values(storage).join("\n");
  expect(persisted).not.toMatch(/one\.png|two\.png|Faithful rendition|manifest|PK/u);

  const extractRoot = mkdtempSync(join(tmpdir(), "reword-nerd-image-package-e2e-"));
  try {
    for (const path of tree) {
      expect(path).not.toMatch(/(^|\/)\.\.?(\/|$)|\\/u);
      const output = join(extractRoot, ...path.split("/"));
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, await archive.file(path)!.async("nodebuffer"));
    }
    const standalone = await context.newPage();
    const standaloneHttpRequests: string[] = [];
    standalone.on("request", (request) => {
      if (/^https?:/iu.test(request.url())) standaloneHttpRequests.push(request.url());
    });
    await standalone.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    });
    for (const htmlPath of ["OPEN-ME.html", "pairs/001-one/OPEN-ME.html"]) {
      for (const viewport of [{ width: 320, height: 720 }, { width: 390, height: 844 }, { width: 1586, height: 992 }]) {
        await standalone.setViewportSize(viewport);
        await standalone.goto(pathToFileURL(join(extractRoot, htmlPath)).href);
        await expect(standalone.getByRole("img", { name: /Source image for/iu }).first()).toBeVisible();
        expect(await standalone.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      }
    }
    const standaloneCard = standalone.getByRole("article").first();
    await expect(standaloneCard.getByRole("img")).toHaveAttribute("draggable", "true");
    await standaloneCard.getByRole("button", { name: "COPY PROMPT" }).click();
    await expect(standaloneCard.getByRole("status")).toContainText("Prompt selected — copy manually.");
    await standaloneCard.getByRole("button", { name: "COPY IMAGE" }).click();
    await expect(standaloneCard.getByRole("status")).toContainText("Copy unavailable");
    const standaloneOpenImage = standaloneCard.getByRole("link", { name: "OPEN IMAGE" });
    await expect(standaloneOpenImage).toHaveAttribute("href", "./source.png");
    expect(await standaloneOpenImage.evaluate((link) => (link as HTMLAnchorElement).href)).toMatch(/^file:/u);
    await expect(standaloneCard.getByRole("link", { name: "DOWNLOAD IMAGE" })).toHaveAttribute("download", "");
    expect(standaloneHttpRequests).toEqual([]);
    await standalone.close();
  } finally {
    rmSync(extractRoot, { recursive: true, force: true });
  }

  await page.setViewportSize({ width: 1586, height: 992 });
  await page.getByRole("button", { name: "Omit one.png" }).click();
  await expect(page.getByRole("region", { name: "Built package pairs" })).toBeHidden();
  await expect(page.getByRole("button", { name: "DOWNLOAD ZIP" })).toBeDisabled();
  await expect(page.getByRole("article", { name: "Package preview" })).toContainText("No package has been built.");

  const pageOrigin = new URL(page.url()).origin;
  for (const request of requests) {
    const url = new URL(request.url);
    if (url.protocol === "http:" || url.protocol === "https:") expect(url.origin).toBe(pageOrigin);
    expect(request.method).toBe("GET");
  }
});
