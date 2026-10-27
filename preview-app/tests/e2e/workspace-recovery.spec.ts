import { expect, test, type Page, type Download } from "@playwright/test";
import { asPayload, textFixture, markdownFixture, createDocxFixture, createSelectablePdfFixture, setFolderInputFiles } from "./fixtures";
import { decodeWorkspace } from "../../src/workspace/codec";

test("remembered workspace restores reviewed text and appearance without a run", async ({ page, context }) => {
  const errors: string[] = [], sends: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("request", r => { if (r.method() === "POST" && /\/api\/(collections\/dispatch|run|resume|handoff\/dispatch)/.test(r.url())) sends.push(r.url()); });
  await page.goto("./?mode=text");
  await page.getByRole("button", { name: "Remember this workspace on this device", exact: true }).click();
  await page.getByRole("button", { name: "Edit source", exact: true }).click();
  const text = "Recovered reviewed text. 雪\n\nExact trailing spaces.  \n[INSERT REWRITE OUTPUT HERE]";
  await page.getByRole("textbox", { name: "Document source", exact: true }).fill(text);
  await page.getByLabel("Color palette", { exact: true }).selectOption("amber");
  await page.getByRole("button", { name: "Switch to light appearance", exact: true }).click();
  await expect(page.getByTestId("workspace-save-status")).toContainText("Saved");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Document source", exact: true })).toHaveValue(text);
  await expect(page.locator(".unified-platform")).toHaveAttribute("data-palette", "amber");
  await expect(page.locator(".unified-platform")).toHaveAttribute("data-appearance", "light");
  await page.close(); const reopened = await context.newPage(); await reopened.goto("./?mode=text");
  await expect(reopened.getByRole("textbox", { name: "Document source", exact: true })).toHaveValue(text);
  expect(sends).toEqual([]);
  expect(errors).toEqual([]);
});

async function saved(page: Page) { await expect(page.getByTestId("workspace-save-status")).toContainText(/^Saved /); }
async function downloadBytes(download: Download) { const stream = await download.createReadStream(); const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks); }
async function mode(page: Page, name: string) { await page.getByRole("navigation", { name: "Workspace modes" }).getByRole("button", { name, exact: true }).click(); const start = page.getByRole("button", { name: "START LOCAL SESSION", exact: true }); if (await start.isVisible()) await start.click(); }

test("workspace file preserves multiple original formats, workbooks, images, and project bytes", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("./?mode=text");
  await page.getByRole("button", { name: "Remember this workspace on this device", exact: true }).click();
  await page.getByRole("button", { name: /^Remove Urban gardens/ }).click();
  const fixtures = [textFixture, markdownFixture, await createDocxFixture(), createSelectablePdfFixture()];
  await page.getByLabel("Import documents", { exact: true }).setInputFiles(fixtures.map(asPayload));
  await expect(page.locator(".studio-document-item")).toHaveCount(fixtures.length);
  for (const fixture of fixtures) {
    const name = fixture.name.replace(/\.(md|txt)$/i, "").replaceAll("-", " ");
    await page.locator(".studio-document-item").filter({ hasText: name }).getByRole("button").first().click();
    await page.getByRole("button", { name: "Edit source", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Document source", exact: true })).not.toHaveValue("");
    await page.getByRole("button", { name: "Review complete", exact: true }).click();
  }
  await page.getByRole("button", { name: "Build package", exact: true }).click();
  const workspace = page.getByRole("region", { name: "Prompt workspace", exact: true }).filter({ visible: true });
  await expect(workspace).toBeVisible();
  const response = "Owned response for recovery. 雪\n[INSERT REWRITE OUTPUT HERE]  ";
  await workspace.getByLabel("Model response", { exact: true }).first().fill(response);
  await mode(page, "Images");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await page.getByLabel("Add image files", { exact: true }).setInputFiles([{ name: "one.png", mimeType: "image/png", buffer: png }, { name: "two.png", mimeType: "image/png", buffer: png }]);
  await expect(page.getByRole("button", { name: "Focus two.png", exact: true })).toBeVisible();
  await mode(page, "Projects");
  await setFolderInputFiles(page, "recovery-project", [{ path: "src/main.ts", mimeType: "text/typescript", contents: "export const answer = 42;\n" }, { path: "docs/café.md", mimeType: "text/markdown", contents: "# Original\n雪\n" }]);
  await expect(page.getByRole("listbox", { name: "Uploaded files" })).toContainText("recovery-project");
  await saved(page);
  await page.locator(".workspace-recovery summary").click();
  const downloading = page.waitForEvent("download"); await page.getByRole("button", { name: "Export workspace file", exact: true }).click();
  const bytes = await downloadBytes(await downloading), sections = await decodeWorkspace(new Blob([Uint8Array.from(bytes)]));
  const studio = (sections.studio as { value: { documents: { original: File; name: string }[] } }).value;
  for (const fixture of fixtures) { const original = studio.documents.find(d => d.name === fixture.name)!.original; expect(Buffer.from(await original.arrayBuffer())).toEqual(fixture.buffer); }
  const images = (sections.images as { value: { items: { sourceBytes: Blob; id: string }[] } }).value.items;
  expect(images).toHaveLength(2); expect(images[0].id).not.toBe(images[1].id); for (const image of images) expect(Buffer.from(await image.sourceBytes.arrayBuffer())).toEqual(png);
  const project = (sections.workbench as { value: { items: { kind?: string; entries?: { path: string; originalBytes: Uint8Array }[] }[] } }).value.items.find(i => i.kind === "project")!;
  expect(Buffer.from(project.entries!.find(e => e.path === "src/main.ts")!.originalBytes).toString()).toBe("export const answer = 42;\n");
  await page.reload(); await mode(page, "Text");
  await expect(workspace.getByLabel("Model response", { exact: true }).first()).toHaveValue(response);
  await mode(page, "Images"); await expect(page.getByRole("button", { name: "Focus two.png", exact: true })).toBeVisible();
  await mode(page, "Projects"); await expect(page.getByRole("listbox", { name: "Uploaded files" })).toContainText("recovery-project");
  expect(errors).toEqual([]);
});

test("a stale tab pauses without overwriting another tab's saved edits", async ({ page, context }) => {
  await page.goto("./?mode=text"); await page.getByRole("button", { name: "Remember this workspace on this device", exact: true }).click();
  await page.getByRole("button", { name: "Edit source", exact: true }).click(); await page.getByRole("textbox", { name: "Document source", exact: true }).fill("Shared baseline"); await saved(page);
  const second = await context.newPage(); await second.goto("./?mode=text"); await expect(second.getByRole("textbox", { name: "Document source", exact: true })).toHaveValue("Shared baseline");
  await page.getByRole("textbox", { name: "Document source", exact: true }).fill("First tab confirmed"); await saved(page);
  await second.getByRole("textbox", { name: "Document source", exact: true }).fill("Second tab preserved for export");
  await expect(second.getByRole("alert").filter({ hasText: "Another tab" })).toBeVisible();
  const third = await context.newPage(); await third.goto("./?mode=text"); await expect(third.getByRole("textbox", { name: "Document source", exact: true })).toHaveValue("First tab confirmed");
  await expect(second.getByRole("textbox", { name: "Document source", exact: true })).toHaveValue("Second tab preserved for export");
});

test("a browser quota failure preserves the confirmed copy and keeps current edits visible", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("./?mode=text"); await page.getByRole("button", { name: "Remember this workspace on this device", exact: true }).click();
  await page.getByRole("button", { name: "Edit source", exact: true }).click(); await page.getByRole("textbox", { name: "Document source", exact: true }).fill("Confirmed before quota"); await saved(page);
  await page.evaluate(() => { const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) { if (this.name === "workspace") throw new DOMException("Owned quota fixture", "QuotaExceededError"); return put.apply(this, args); }; });
  await page.getByRole("textbox", { name: "Document source", exact: true }).fill("Latest edits remain visible");
  await expect(page.getByRole("alert").filter({ hasText: "storage is full" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Document source", exact: true })).toHaveValue("Latest edits remain visible");
  page.on("dialog", d => d.accept()); await page.reload();
  await expect(page.getByRole("textbox", { name: "Document source", exact: true })).toHaveValue("Confirmed before quota");
  expect(errors).toEqual([]);
});


test("accepted OCR and the exact built image ZIP remain usable after recovery", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("./?mode=images");
  await page.getByRole("button", { name: "START LOCAL SESSION", exact: true }).click();
  await page.getByRole("button", { name: "Remember this workspace on this device", exact: true }).click();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await page.getByLabel("Add image files", { exact: true }).setInputFiles({ name: "ocr-recovery.png", mimeType: "image/png", buffer: png });
  await page.getByRole("checkbox", { name: "Select ocr-recovery.png", exact: true }).check();
  await page.getByRole("button", { name: "RUN OCR", exact: true }).click();
  await expect(page.getByLabel("Reviewed OCR text", { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Reviewed OCR text", { exact: true }).fill("Reviewed OCR retained. 雪");
  await saved(page); await page.reload();
  await expect(page.getByLabel("Reviewed OCR text", { exact: true })).toHaveValue("Reviewed OCR retained. 雪");
  await page.getByRole("button", { name: "ACCEPT REVIEWED OCR", exact: true }).click();
  await page.getByRole("button", { name: "CONFIRM IMAGE SET", exact: true }).click();
  await page.getByRole("button", { name: "BUILD PACKAGE", exact: true }).click();
  const button = page.getByRole("button", { name: "DOWNLOAD ZIP", exact: true }); await expect(button).toBeEnabled();
  const first = page.waitForEvent("download"); await button.click(); const before = await downloadBytes(await first); await saved(page);
  await page.reload(); await expect(page.getByRole("region", { name: "Prompt prose" })).toContainText("Reviewed OCR retained. 雪");
  await expect(button).toBeEnabled(); const second = page.waitForEvent("download"); await button.click(); expect(await downloadBytes(await second)).toEqual(before);
});

test("imported reviews, saved decisions, and unsaved review drafts survive reload", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("./?mode=runs"); await page.getByRole("button", { name: "Remember this workspace on this device", exact: true }).click();
  await page.getByLabel("Select portable image review ZIP", { exact: true }).setInputFiles("image-companion/testdata/retained-image-review-v1.zip");
  const notes = page.getByRole("textbox", { name: "Your review notes", exact: true }); await expect(notes).toBeVisible(); await notes.fill("Saved fixture review note. 雪");
  await page.getByLabel("Decision for this revision", { exact: true }).selectOption("notes-only");
  await page.getByRole("button", { name: "Save user revision 1", exact: true }).click();
  await expect(page.getByText("Saved fixture review note. 雪", { exact: true })).toBeVisible();
  await notes.fill("Unsaved draft retained separately."); await page.getByLabel("Decision for this revision", { exact: true }).selectOption("request-changes"); await saved(page);
  await page.reload(); await expect(notes).toHaveValue("Unsaved draft retained separately.");
  await expect(page.getByLabel("Decision for this revision", { exact: true })).toHaveValue("request-changes");
  await expect(page.getByText("Saved fixture review note. 雪", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save user revision 2", exact: true })).toBeEnabled();
});
