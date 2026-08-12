import { expect, test, type Download, type Page } from "@playwright/test";
import JSZip from "jszip";
import {
  asPayload,
  createDocxFixture,
  createSelectablePdfFixture,
  createTextlessPdfFixture,
  markdownFixture,
  recoveryTextFixture,
  sha256,
  textFixture,
  unsupportedFixture,
  type BrowserFixture,
} from "./fixtures";

const markers = [
  "<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>",
  "<<<INSERT_STAGE_2_REWRITE_RESPONSE>>>",
  "<<<INSERT_STAGE_3_VERIFICATION_RESPONSE>>>",
] as const;

function monitorRuntime(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  return errors;
}

async function openWorkbench(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("main", { name: "reword_nerd workbench" })).toBeVisible();
}

async function upload(page: Page, fixtures: readonly BrowserFixture[]) {
  await page.getByLabel("Add supported files").setInputFiles(fixtures.map(asPayload));
}

function fileOptions(page: Page) {
  return page.getByRole("listbox", { name: "Uploaded files" }).getByRole("option");
}

async function selectDocument(page: Page, name: string) {
  const filesTab = page.getByRole("tab", { name: "FILES" });
  if (await filesTab.isVisible()) await filesTab.click();
  const option = fileOptions(page).filter({ hasText: name });
  await expect(option).toBeVisible();
  await option.click();
}

async function waitForExtracted(page: Page, fixture: BrowserFixture, phrase: string) {
  await selectDocument(page, fixture.name);
  await expect(page.getByLabel(`Extracted text for ${fixture.name}`)).toHaveValue(new RegExp(phrase));
}

async function confirmSelected(page: Page) {
  const button = page.getByRole("button", { name: "Confirm review" });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.locator(".review-actions .ready-text")).toHaveText("Review complete");
}

async function captureDownload(page: Page): Promise<Download> {
  await page.getByRole("button", { name: "BUILD PACKAGE" }).click();
  await expect(page.getByRole("heading", { name: "PACKAGE PREVIEW" })).toBeFocused();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "DOWNLOAD ZIP" }).click();
  return pending;
}

async function downloadBytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function expectedKey(fixture: BrowserFixture): string {
  const base = fixture.name.replace(/\.[^.]+$/u, "").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  return `${base}--${sha256(fixture.buffer).slice(0, 12)}`;
}

test("mixed real formats produce a complete, previewed, byte-preserving schema-v3 prompt package", async ({ page }) => {
  // This catches browser extraction/export drift that unit-level parser and archive adapters cannot see.
  const runtimeErrors = monitorRuntime(page);
  const docx = await createDocxFixture();
  const pdf = createSelectablePdfFixture();
  const fixtures = [textFixture, markdownFixture, docx, pdf];
  await openWorkbench(page);
  await upload(page, fixtures);
  await expect(fileOptions(page)).toHaveCount(4);

  await waitForExtracted(page, textFixture, "café launch code is 314");
  const editedText = `${textFixture.buffer.toString("utf8").trimEnd()}\nReviewed in Chromium.\n`;
  await page.getByLabel(`Extracted text for ${textFixture.name}`).fill(editedText);
  await confirmSelected(page);
  await waitForExtracted(page, markdownFixture, "stable Markdown fact");
  await confirmSelected(page);
  await waitForExtracted(page, docx, "Stable DOCX fact");
  await expect(page.getByLabel(`Extracted text for ${docx.name}`)).toHaveValue(/# Browser DOCX Fixture/);
  await confirmSelected(page);
  await waitForExtracted(page, pdf, "Stable PDF fact");
  await confirmSelected(page);

  await page.getByLabel("Tone").selectOption("academic");
  await page.getByLabel("Custom requirements").fill("  Preserve  exact spacing.\n\nKeep the blank line.  ");
  await selectDocument(page, pdf.name);
  await page.getByRole("switch", { name: /PER-FILE OVERRIDE/i }).check();
  await page.getByLabel("Length").selectOption("concise");
  const reviewedValues = new Map<string, string>();
  for (const fixture of fixtures) {
    await selectDocument(page, fixture.name);
    reviewedValues.set(fixture.name, await page.getByLabel(`Extracted text for ${fixture.name}`).inputValue());
  }

  const download = await captureDownload(page);
  expect(download.suggestedFilename()).toBe("reword-nerd-prompt-package.zip");
  const archiveBytes = await downloadBytes(download);
  const archive = await JSZip.loadAsync(archiveBytes, { checkCRC32: true });
  const manifestText = await archive.file("manifest.json")?.async("string");
  expect(manifestText).toBeTruthy();
  const manifest = JSON.parse(manifestText!) as {
    schemaVersion: number;
    workflow: { stages: string[]; responseMarkers: Record<string, string> };
    documents: Array<{
      key: string;
      originalDisplayName: string;
      format: string;
      original: { path: string; sha256: string; byteCount: number };
      reviewedExtraction: { path: string; sha256: string };
      settings: { tone: string; length: string };
      model: { promptStrategy: { id: string; version: string; referenceModel: string; reviewedAt: string } };
      prompts: Record<string, { path: string; sha256: string }>;
      visualAssets: { index: { path: string }; placementMap: { path: string } };
      ocr: { path: string };
      combined: { markdown: { path: string; sha256: string }; html: { path: string; sha256: string }; fullHtml: { status: string; path?: string } };
    }>;
  };
  expect(manifest.schemaVersion).toBe(3);
  expect(manifest.workflow.stages).toEqual(["decompose", "rewrite", "verify", "final"]);
  expect(Object.values(manifest.workflow.responseMarkers)).toEqual(markers);
  expect(manifest.documents).toHaveLength(4);

  const expectedPaths = ["README.md", "manifest.json"];
  for (const fixture of fixtures) {
    const key = expectedKey(fixture);
    const record = manifest.documents.find((document) => document.originalDisplayName === fixture.name);
    expect(record).toBeTruthy();
    expect(record!.key).toBe(key);
    const extension = fixture.name.split(".").at(-1);
    const documentPaths = [
      `documents/${key}/original.${extension}`,
      `documents/${key}/reviewed-extraction.md`,
      `documents/${key}/prompts/01-decompose.md`,
      `documents/${key}/prompts/02-rewrite.md`,
      `documents/${key}/prompts/03-verify.md`,
      `documents/${key}/prompts/04-final.md`,
      `documents/${key}/combined-prompts.md`,
      `documents/${key}/combined-prompts.html`,
      `documents/${key}/assets/index.md`,
      `documents/${key}/assets/placement-map.json`,
      `documents/${key}/ocr/candidates.json`,
      ...(record!.combined.fullHtml.status === "generated" ? [`documents/${key}/combined-prompts-full.html`] : []),
    ];
    expectedPaths.push(...documentPaths);
    const original = await archive.file(record!.original.path)?.async("nodebuffer");
    expect(original).toEqual(fixture.buffer);
    expect(record!.original.sha256).toBe(sha256(fixture.buffer));
    expect(record!.original.byteCount).toBe(fixture.buffer.byteLength);
    const reviewed = await archive.file(record!.reviewedExtraction.path)?.async("string");
    expect(reviewed).toBe(reviewedValues.get(fixture.name));
    expect(record!.reviewedExtraction.sha256).toBe(sha256(reviewed!));
    expect(record!.settings.tone).toBe("academic");
    expect(record!.settings.length).toBe(fixture.name === pdf.name ? "concise" : "preserve");
    expect(record!.model.promptStrategy).toEqual({
      id: "openai-chatgpt-v1",
      version: "2026-08-11-v1",
      referenceModel: "GPT-5.6 Sol",
      reviewedAt: "2026-08-11",
    });
    for (const [stage, promptRecord] of Object.entries(record!.prompts)) {
      const prompt = await archive.file(promptRecord.path)?.async("string");
      expect(prompt).toContain("===== BEGIN SOURCE DOCUMENT =====");
      expect(prompt).toContain(reviewed!);
      expect(promptRecord.sha256).toBe(sha256(prompt!));
      if (stage !== "decompose") expect(prompt).toContain(markers[0]);
      if (stage === "verify" || stage === "final") expect(prompt).toContain(markers[1]);
      if (stage === "final") expect(prompt).toContain(markers[2]);
    }
    const combinedMarkdown = await archive.file(record!.combined.markdown.path)?.async("string");
    const combinedHtml = await archive.file(record!.combined.html.path)?.async("string");
    const runbook = await archive.file("README.md")?.async("string");
    expect(combinedMarkdown?.startsWith(runbook!)).toBe(true);
    expect(record!.combined.markdown.sha256).toBe(sha256(combinedMarkdown!));
    expect(record!.combined.html.sha256).toBe(sha256(combinedHtml!));
    expect(combinedHtml).not.toMatch(/<(?:img|link|iframe|script)\b[^>]+(?:src|href)\s*=\s*["']https?:/iu);
  }
  expect(Object.keys(archive.files).sort()).toEqual(expectedPaths.sort());
  expect(Object.values(archive.files).every((entry) => !entry.dir)).toBe(true);

  const firstRecord = manifest.documents[0];
  const firstPrompt = await archive.file(firstRecord.prompts.decompose.path)!.async("string");
  const standaloneHtml = await archive.file(firstRecord.combined.html.path)!.async("string");
  await page.setContent(standaloneHtml);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: (text: string) => { (window as unknown as { capturedCopy: string }).capturedCopy = text; } },
    });
  });
  const firstCode = page.locator(".prompt-section pre code").first();
  expect(await firstCode.textContent()).toBe(firstPrompt);
  await page.getByRole("button", { name: "Copy Decompose" }).click();
  await expect(page.getByRole("status")).toHaveText("Decompose copied.");
  expect(await page.evaluate(() => (window as unknown as { capturedCopy: string }).capturedCopy)).toBe(firstPrompt);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    Object.defineProperty(document, "execCommand", { configurable: true, value: () => true });
  });
  await page.getByRole("button", { name: "Copy Rewrite" }).click();
  await expect(page.getByRole("status")).toHaveText("Rewrite copied.");
  await page.evaluate(() => {
    Object.defineProperty(document, "execCommand", { configurable: true, value: () => false });
  });
  await page.getByRole("button", { name: "Copy Verify" }).click();
  await expect(page.getByRole("status")).toContainText("Select the Verify prompt manually");
  expect(runtimeErrors).toEqual([]);
});

test("a textless PDF and unsupported file do not destroy a retained good-file review", async ({ page }) => {
  // This catches one-file extraction failure escalating into a workspace-wide failure or lost edits.
  const runtimeErrors = monitorRuntime(page);
  const textless = createTextlessPdfFixture();
  await openWorkbench(page);
  await upload(page, [recoveryTextFixture, textless, unsupportedFixture]);
  await expect(fileOptions(page)).toHaveCount(2);
  await expect(page.getByText("unsupported.rtf: This file type is not supported.")).toBeVisible();
  await waitForExtracted(page, recoveryTextFixture, "retained value is 909");
  const retainedEdit = "Recovery fact: the retained value is 909.\nReviewed and retained.\n";
  await page.getByLabel(`Extracted text for ${recoveryTextFixture.name}`).fill(retainedEdit);
  await selectDocument(page, textless.name);
  await expect(page.getByRole("alert")).toHaveText("This PDF does not contain selectable text.");
  await page.getByRole("button", { name: "Remove file", exact: true }).click();
  await expect(fileOptions(page).filter({ hasText: recoveryTextFixture.name })).toBeFocused();
  await expect(page.getByLabel(`Extracted text for ${recoveryTextFixture.name}`)).toHaveValue(retainedEdit);
  await confirmSelected(page);
  const download = await captureDownload(page);
  const archive = await JSZip.loadAsync(await downloadBytes(download), { checkCRC32: true });
  const manifest = JSON.parse((await archive.file("manifest.json")!.async("string"))) as { documents: Array<{ originalDisplayName: string }> };
  expect(manifest.documents.map((document) => document.originalDisplayName)).toEqual([recoveryTextFixture.name]);
  expect(runtimeErrors).toEqual([]);
});

test("oversized-context acknowledgment unlocks export and resets when the source or limit changes", async ({ page }) => {
  // This catches a stale warning acknowledgment surviving mutations to the context estimate inputs.
  await openWorkbench(page);
  await upload(page, [textFixture]);
  await waitForExtracted(page, textFixture, "launch code is 314");
  await confirmSelected(page);
  const build = page.getByRole("button", { name: "BUILD PACKAGE" });
  const contextLimit = page.getByLabel("Context limit");
  await contextLimit.fill("1");
  await expect(page.getByText("Estimated workflow context exceeds the selected profile.")).toBeVisible();
  const acknowledgment = page.getByLabel("I understand and want to include this file.");
  await expect(build).toBeDisabled();
  await acknowledgment.check();
  await expect(build).toBeEnabled();

  const editor = page.getByLabel(`Extracted text for ${textFixture.name}`);
  await editor.fill(`${await editor.inputValue()}Additional reviewed source detail.\n`);
  await expect(acknowledgment).not.toBeChecked();
  await confirmSelected(page);
  await expect(build).toBeDisabled();
  await acknowledgment.check();
  await expect(build).toBeEnabled();
  await contextLimit.fill("2");
  await expect(page.getByLabel("I understand and want to include this file.")).not.toBeChecked();
  await expect(build).toBeDisabled();
});

test("reload clears edited workspace state and leaves browser persistence surfaces empty", async ({ page, context }) => {
  // This catches accidental session restoration or storage introduced under the local-only UI.
  await openWorkbench(page);
  await upload(page, [textFixture]);
  await waitForExtracted(page, textFixture, "launch code is 314");
  const editor = page.getByLabel(`Extracted text for ${textFixture.name}`);
  await editor.click();
  await editor.fill("Transient browser-only edit.\n");
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.type());
    await dialog.accept();
  });
  await page.reload();
  await expect(fileOptions(page)).toHaveCount(0);
  await expect(page.getByLabel("No selected file")).toBeVisible();
  expect(dialogs.every((type) => type === "beforeunload")).toBe(true);

  const persistence = await page.evaluate(async () => ({
    localStorage: Object.keys(localStorage),
    sessionStorage: Object.keys(sessionStorage),
    databases: typeof indexedDB.databases === "function" ? (await indexedDB.databases()).map((database) => database.name) : [],
    caches: "caches" in window ? await caches.keys() : [],
    cookies: document.cookie,
    serviceWorkers: "serviceWorker" in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0,
  }));
  expect(persistence).toEqual({
    localStorage: [],
    sessionStorage: [],
    databases: [],
    caches: [],
    cookies: "",
    serviceWorkers: 0,
  });
  expect((await context.cookies()).filter((cookie) => cookie.domain === "127.0.0.1")).toEqual([]);
});

test("initial load, real extraction, and ZIP export make no HTTP requests outside the local app origin", async ({ page }) => {
  // This catches a remote asset, parser fetch, analytics call, or upload transport crossing the browser boundary.
  const docx = await createDocxFixture();
  const pdf = createSelectablePdfFixture();
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== "http://127.0.0.1:4173") {
      externalRequests.push(request.url());
    }
  });
  await openWorkbench(page);
  await upload(page, [textFixture, docx, pdf]);
  for (const [fixture, phrase] of [[textFixture, "launch code"], [docx, "Stable DOCX fact"], [pdf, "Stable PDF fact"]] as const) {
    await waitForExtracted(page, fixture, phrase);
    await confirmSelected(page);
  }
  await captureDownload(page);
  await page.waitForTimeout(150);
  expect(externalRequests).toEqual([]);
});

test("keyboard navigation, modal focus, live state, removal focus, and reduced motion remain operable", async ({ page }) => {
  // This catches custom controls becoming pointer-only or losing focus after responsive UI transitions.
  await page.setViewportSize({ width: 412, height: 915 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openWorkbench(page);
  await upload(page, [textFixture, markdownFixture]);
  await waitForExtracted(page, markdownFixture, "stable Markdown fact");
  const previewTab = page.getByRole("tab", { name: "REVIEW" });
  await previewTab.focus();
  await page.keyboard.press("ArrowLeft");
  const filesTab = page.getByRole("tab", { name: "FILES" });
  await expect(filesTab).toHaveAttribute("aria-selected", "true");
  const first = fileOptions(page).filter({ hasText: textFixture.name });
  await first.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("[role='option']").filter({ hasText: markdownFixture.name })).toHaveAttribute("aria-selected", "true");
  await previewTab.focus();
  await page.keyboard.press("Enter");

  const editor = page.getByLabel(`Extracted text for ${markdownFixture.name}`);
  await editor.focus();
  await page.keyboard.press("End");
  await page.keyboard.type("\nKeyboard-reviewed.");
  const confirm = page.getByRole("button", { name: "Confirm review" });
  await expect(confirm).toBeEnabled();
  await confirm.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[aria-live='polite']")).toHaveText("Review complete");

  const menu = page.getByRole("button", { name: "Menu" });
  await menu.focus();
  await page.keyboard.press("Enter");
  const help = page.getByRole("menuitem", { name: "Help" });
  await help.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Four-stage package" });
  await expect(dialog).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();

  const settingsTab = page.getByRole("tab", { name: "SETTINGS" });
  await settingsTab.focus();
  await page.keyboard.press("Enter");
  const override = page.getByRole("switch", { name: /PER-FILE OVERRIDE/i });
  await override.focus();
  await page.keyboard.press("Space");
  await expect(override).toBeChecked();
  const focusStyle = await override.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focusStyle.outlineStyle).not.toBe("none");
  expect(focusStyle.outlineWidth).not.toBe("0px");

  await filesTab.focus();
  await page.keyboard.press("Enter");
  const actions = page.getByRole("button", { name: `File actions for ${markdownFixture.name}` });
  await actions.focus();
  await page.keyboard.press("Enter");
  const remove = page.getByRole("menuitem", { name: "Remove file" });
  await remove.focus();
  await page.keyboard.press("Enter");
  const retained = fileOptions(page).filter({ hasText: textFixture.name });
  await expect(retained).toBeFocused();
  await page.keyboard.press("Enter");
  const retainedConfirm = page.getByRole("button", { name: "Confirm review" });
  await retainedConfirm.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[aria-live='polite']")).toHaveText("Review complete");
  await previewTab.focus();
  await page.keyboard.press("Enter");
  const build = page.getByRole("button", { name: "BUILD PACKAGE" });
  await expect(build).toBeEnabled();
  await build.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "PACKAGE PREVIEW" })).toBeFocused();
  const download = page.waitForEvent("download");
  const downloadButton = page.getByRole("button", { name: "DOWNLOAD ZIP" });
  await downloadButton.focus();
  await page.keyboard.press("Enter");
  expect((await download).suggestedFilename()).toBe("reword-nerd-prompt-package.zip");
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
