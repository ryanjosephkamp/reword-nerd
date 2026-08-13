import { expect, test, type Download, type Locator, type Page } from "@playwright/test";
import JSZip from "jszip";

import { asPayload, createGenericProjectZipFixture, setFolderInputFiles } from "./fixtures";

const folderProjectPayloads = [
  {
    path: ".gitignore",
    mimeType: "text/plain",
    contents: "draft-notes.md\n",
  },
  {
    path: "alpha.tex",
    mimeType: "application/x-tex",
    contents: "\\documentclass{article}\n\\begin{document}\nAlpha candidate.\n\\end{document}\n",
  },
  {
    path: "beta.tex",
    mimeType: "application/x-tex",
    contents: "\\documentclass{article}\n\\begin{document}\nBeta candidate.\n\\end{document}\n",
  },
  {
    path: "src/rewrite.ts",
    mimeType: "text/typescript",
    contents: "// Original folder wording\nexport const answer = 42;\n",
  },
] as const;

async function openWorkbench(page: Page) {
  await page.goto("./");
  await expect(page.getByRole("main", { name: "reword_nerd workbench" })).toBeVisible();
  const quickStart = page.getByRole("dialog", { name: "Quick start" });
  if (await quickStart.isVisible()) await quickStart.getByRole("button", { name: "Close quick start" }).click();
}

function projectOption(page: Page, name: string) {
  return page.getByRole("listbox", { name: "Uploaded files" }).getByRole("option").filter({ hasText: name });
}

async function chooseProjectEntry(page: Page, path: string) {
  const mobilePicker = page.getByRole("button", { name: "Choose project file" });
  if (await mobilePicker.isVisible()) await mobilePicker.click();
  const browser = page.getByRole("list", { name: "Project files" });
  await expect(browser).toBeVisible();
  await browser.getByRole("button").filter({ hasText: path }).click();
}

async function waitForProjectMutation(page: Page, confirm: Locator, acceptedText?: { path: string; value: string }) {
  await expect(confirm).toBeEnabled();
  if (!acceptedText) return;
  const otherPath = acceptedText.path === ".gitignore" ? "alpha.tex" : ".gitignore";
  await chooseProjectEntry(page, otherPath);
  await chooseProjectEntry(page, acceptedText.path);
  await expect(page.getByLabel(`Reviewed text for ${acceptedText.path}`)).toHaveValue(acceptedText.value);
}

async function downloadBytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function confirmProject(page: Page) {
  const confirm = page.getByRole("button", { name: "Confirm project review" });
  await expect(confirm).toBeEnabled();
  await confirm.focus();
  await confirm.press("Enter");
  await expect(projectOption(page, "folder-workspace")).toContainText("READY");
}

test("desktop project review confirmation remains reachable above the Context Meter", async ({ page }) => {
  // This catches the fixed Context Meter/footer stack covering the enabled confirmation control.
  await openWorkbench(page);
  await setFolderInputFiles(page, "folder-workspace", folderProjectPayloads);
  await expect(projectOption(page, "folder-workspace")).toContainText("REVIEW");
  const confirm = page.getByRole("button", { name: "Confirm project review" });
  await page.getByRole("combobox", { name: "Project classification" }).selectOption("general-text");
  await expect(confirm).toBeEnabled();
  await confirm.click({ trial: true, timeout: 2_000 });
});

test("mobile project review exposes context recovery and package actions", async ({ page }) => {
  // This catches mobile hiding project context recovery or rendering export actions only for documents.
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkbench(page);
  await setFolderInputFiles(page, "folder-workspace", folderProjectPayloads);
  const confirm = page.getByRole("button", { name: "Confirm project review" });
  await page.getByRole("combobox", { name: "Project classification" }).selectOption("general-text");
  await expect(confirm).toBeEnabled();

  await page.getByRole("tab", { name: "SETTINGS" }).click();
  await page.getByLabel("Context limit", { exact: true }).fill("1");
  await page.getByRole("tab", { name: "REVIEW" }).click();
  await expect(page.getByText("Estimated workflow context exceeds the selected profile."))
    .toBeVisible({ timeout: 2_000 });
  await page.getByLabel("I understand and want to include this file.").check();
  await confirm.click();
  await expect(page.locator(".mobile-document-identity .selected-status")).toHaveText("READY");
  await expect(page.getByRole("button", { name: "BUILD PACKAGE" })).toBeVisible({ timeout: 2_000 });
});

test("prompt safety caps visibly name the reduced project scope before confirmation", async ({ page }) => {
  await openWorkbench(page);
  const cappedFiles = Array.from({ length: 251 }, (_, index) => ({
    path: `notes/${String(index).padStart(3, "0")}.txt`,
    mimeType: "text/plain",
    contents: `Bounded note ${index}.\n`,
  }));
  await setFolderInputFiles(page, "capped-workspace", cappedFiles);
  await expect(projectOption(page, "capped-workspace")).toContainText("REVIEW");
  await expect(page.getByText(/excluded from prompt scope.*250-file.*5 MiB.*review.*before confirming/iu)).toBeVisible();
  await page.getByLabel("FILTER").selectOption("excluded");
  const excluded = page.getByRole("list", { name: "Project files" }).getByRole("button");
  await expect(excluded).toHaveCount(1);
  await expect(excluded.first()).toContainText("notes/250.txt");
  await expect(excluded.first()).toContainText("PROMPT LIMIT");
});

test("Add Folder requires classification, preserves immutable paths, edits reviewed text, and recovers context risk", async ({ page }) => {
  await openWorkbench(page);
  await setFolderInputFiles(page, "folder-workspace", folderProjectPayloads);
  await expect(projectOption(page, "folder-workspace")).toContainText("REVIEW");

  const confirm = page.getByRole("button", { name: "Confirm project review" });
  const classification = page.getByRole("combobox", { name: "Project classification" });
  await expect(classification).toHaveValue("");
  await expect(confirm).toBeDisabled();
  await classification.selectOption("general-text");
  await waitForProjectMutation(page, confirm);

  await chooseProjectEntry(page, "src/rewrite.ts");
  await expect(page.getByRole("region", { name: "Review src/rewrite.ts" })).toContainText("IMMUTABLE PATH");
  const editor = page.getByLabel("Reviewed text for src/rewrite.ts");
  const firstReviewedText = "// Reviewed folder wording\nexport const answer = 42;\n";
  await editor.fill(firstReviewedText);
  await editor.blur();
  await waitForProjectMutation(page, confirm, { path: "src/rewrite.ts", value: firstReviewedText });

  await page.getByLabel("Context limit", { exact: true }).fill("1");
  await expect(page.getByText("Estimated workflow context exceeds the selected profile.")).toBeVisible();
  const acknowledge = page.getByLabel("I understand and want to include this file.");
  await expect(page.getByRole("button", { name: "BUILD PACKAGE" })).toBeDisabled();
  await confirmProject(page);
  await expect(page.getByRole("button", { name: "BUILD PACKAGE" })).toBeDisabled();
  await acknowledge.check();
  await expect(page.getByRole("button", { name: "BUILD PACKAGE" })).toBeEnabled();

  await chooseProjectEntry(page, "src/rewrite.ts");
  const finalReviewedText = "// Context changed again\nexport const answer = 42;\n";
  await page.getByLabel("Reviewed text for src/rewrite.ts").fill(finalReviewedText);
  await page.getByLabel("Reviewed text for src/rewrite.ts").blur();
  await expect(acknowledge).not.toBeChecked();
  await expect(page.getByRole("button", { name: "BUILD PACKAGE" })).toBeDisabled();
  await waitForProjectMutation(page, confirm, { path: "src/rewrite.ts", value: finalReviewedText });
  await confirm.focus();
  await confirm.press("Enter");
  await acknowledge.check();
  await expect(page.getByRole("button", { name: "BUILD PACKAGE" })).toBeEnabled();
});

test("folder and generic ZIP projects build one schema-v6 archive with sanitized trees and a changed-files RUNBOOK", async ({ page, baseURL }) => {
  const externalRequests: string[] = [];
  const appOrigin = new URL(baseURL!).origin;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== appOrigin) externalRequests.push(request.url());
  });
  await openWorkbench(page);
  const genericZip = await createGenericProjectZipFixture();
  await setFolderInputFiles(page, "folder-workspace", folderProjectPayloads);
  await expect(projectOption(page, "folder-workspace")).toBeVisible();
  await page.getByRole("combobox", { name: "Project classification" }).selectOption("general-text");
  await waitForProjectMutation(page, page.getByRole("button", { name: "Confirm project review" }));
  await chooseProjectEntry(page, "src/rewrite.ts");
  const reviewedFolderText = "// Reviewed folder package wording\nexport const answer = 42;\n";
  await page.getByLabel("Reviewed text for src/rewrite.ts").fill(reviewedFolderText);
  await page.getByLabel("Reviewed text for src/rewrite.ts").blur();
  await waitForProjectMutation(page, page.getByRole("button", { name: "Confirm project review" }), {
    path: "src/rewrite.ts",
    value: reviewedFolderText,
  });
  await confirmProject(page);

  await page.getByLabel("Add supported files").setInputFiles(asPayload(genericZip));
  const zipOption = projectOption(page, genericZip.name);
  await expect(zipOption).toContainText("REVIEW");
  const zipEditor = page.getByLabel("Reviewed text for README.md");
  await zipEditor.fill("# Generic ZIP workspace\n\nReviewed and edited in Chromium.\n");
  await zipEditor.blur();
  const zipConfirm = page.getByRole("button", { name: "Confirm project review" });
  await waitForProjectMutation(page, zipConfirm);
  await zipConfirm.focus();
  await zipConfirm.press("Enter");
  await expect(zipOption).toContainText("READY");

  const dock = page.getByRole("region", { name: "Package actions" });
  await expect(dock).toBeVisible();
  await dock.getByRole("button", { name: "BUILD PACKAGE" }).click();
  await expect(page.getByRole("heading", { name: "PACKAGE PREVIEW" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "RUNBOOK" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("This sanitized tree is AI context, not a source-control backup.").first()).toBeVisible();
  await expect(page.getByText(/ask the model to return changed text files only/u).first()).toBeVisible();

  const downloadPending = page.waitForEvent("download");
  await dock.getByRole("button", { name: "DOWNLOAD ZIP" }).click();
  const archive = await JSZip.loadAsync(await downloadBytes(await downloadPending), { checkCRC32: true });
  const manifest = JSON.parse(await archive.file("manifest.json")!.async("string")) as {
    schemaVersion: number;
    package: { version: string };
    documents: Array<{
      key: string;
      originalDisplayName: string;
      source: {
        kind: string;
        intakeKind: string;
        originalContainer?: { displayName: string; byteCount: number; sha256: string };
        entries: Array<{ path: string; promptIncluded: boolean; packageIncluded: boolean; packaged?: { path: string } }>;
      };
    }>;
  };
  expect(manifest).toMatchObject({ schemaVersion: 6, package: { version: "0.7.0" } });
  expect(manifest.documents.map((record) => [record.originalDisplayName, record.source.kind, record.source.intakeKind]))
    .toEqual([
      ["folder-workspace", "project", "folder"],
      [genericZip.name, "project", "zip"],
    ]);

  const folder = manifest.documents[0];
  const zipped = manifest.documents[1];
  expect(folder.source).not.toHaveProperty("originalContainer");
  expect(zipped.source.originalContainer).toMatchObject({ displayName: genericZip.name, byteCount: genericZip.buffer.byteLength });
  expect(zipped.source.originalContainer?.sha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(Object.keys(archive.files).some((path) => /original\.zip$/u.test(path))).toBe(false);

  const folderEntry = folder.source.entries.find((entry) => entry.path === "src/rewrite.ts");
  const zipEntry = zipped.source.entries.find((entry) => entry.path === "README.md");
  expect(folderEntry).toMatchObject({ promptIncluded: true, packageIncluded: true });
  expect(zipEntry).toMatchObject({ promptIncluded: true, packageIncluded: true });
  await expect(archive.file(folderEntry!.packaged!.path)!.async("string"))
    .resolves.toBe(reviewedFolderText);
  await expect(archive.file(zipEntry!.packaged!.path)!.async("string"))
    .resolves.toBe("# Generic ZIP workspace\n\nReviewed and edited in Chromium.\n");

  const allText = (await Promise.all(Object.values(archive.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.async("string").catch(() => "")))).join("\n");
  expect(allText).not.toContain("GENERATED_ZIP_BYTES_MUST_NOT_BE_PACKAGED");
  expect(externalRequests).toEqual([]);

  await page.getByRole("button", { name: "New session" }).click();
  await page.getByRole("dialog", { name: "Start a new session?" }).getByRole("button", { name: "Start new session" }).click();
  await expect(page.getByRole("listbox", { name: "Uploaded files" }).getByRole("option")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "PACKAGE", exact: true })).toBeDisabled();
  await expect(page.getByText("New session ready. Settings kept.")).toBeAttached();
});
