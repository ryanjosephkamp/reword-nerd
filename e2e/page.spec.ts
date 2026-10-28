import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { zipContents } from "./helpers";

async function addSample(page: Page) {
  await page.goto("/app/");
  await page.getByRole("button", { name: "Try a sample document" }).click();
  await expect(page.getByRole("heading", { name: "urban-gardens.md" })).toBeVisible();
}

async function editFirstParagraph(page: Page) {
  const editor = page.getByRole("textbox", { name: "Page: urban-gardens.md" });
  await editor.locator("p").first().click();
  // Put the caret at the end of the first paragraph, wherever the click landed.
  await editor.evaluate((element) => {
    const paragraph = element.querySelector("p")!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
  });
  await page.keyboard.type(" Everyone is welcome.");
  // Edits are saved as the user pauses or leaves the page.
  await editor.blur();
}

test("edits on the page show as changes, one line at a time", async ({ page }) => {
  await addSample(page);
  await editFirstParagraph(page);
  await expect(page.getByText("edited", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Changes/ }).click();
  await expect(page.locator(".diff-stat")).toContainText("+1 −1");
  await expect(page.locator("tr.diff-add .diff-word")).toHaveText(/^\s*Everyone is welcome\.$/);

  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  const source = page.getByLabel("Edit the text of urban-gardens.md");
  await expect(source).toHaveValue(/a small community garden\. Everyone is welcome\.\n/);
  await expect(source).toHaveValue(/^# A little greener, together\n\n/);

  await page.getByRole("button", { name: /^Changes/ }).click();
  await page.getByRole("button", { name: "Undo all edits" }).click();
  await page
    .getByRole("group", { name: "Undo all edits?" })
    .getByRole("button", {
      name: "Undo all edits",
    })
    .click();
  await expect(page.getByText("No changes from the original.")).toBeVisible();
});

test("formatting buttons change the page", async ({ page, isMobile }) => {
  test.skip(isMobile, "The same editor on phones.");
  await addSample(page);
  const editor = page.getByRole("textbox", { name: "Page: urban-gardens.md" });
  await editor.locator("p").first().click();
  await page.getByLabel("Text style").selectOption("h2");
  await expect(editor.locator("h2")).toHaveCount(1);
  await editor.blur();
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await expect(page.getByLabel("Edit the text of urban-gardens.md")).toHaveValue(
    /\n## There is a patch of unused land/,
  );
});

test("the document downloads as Word, a web page, Markdown, and text", async ({ page }) => {
  await addSample(page);
  await editFirstParagraph(page);
  const save = async (choice: RegExp) => {
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Download" })
      .getByRole("button", { name: choice })
      .click();
    return downloading;
  };

  const word = await save(/^Word document/);
  expect(word.suggestedFilename()).toBe("urban-gardens.docx");
  const parts = await zipContents(word);
  expect(parts.get("word/document.xml")).toContain("Everyone is welcome.");
  expect(parts.get("word/document.xml")).toContain('w:background w:color="F6F4EC"');

  const html = await save(/^Web page/);
  expect(html.suggestedFilename()).toBe("urban-gardens.html");
  const page_ = await readFile(await html.path(), "utf8");
  expect(page_).toContain('data-style="paper"');
  expect(page_).toContain("Everyone is welcome.");
  expect(page_).toContain("@font-face");

  const markdown = await save(/^Markdown/);
  expect(await readFile(await markdown.path(), "utf8")).toContain("Everyone is welcome.");

  const text = await save(/^Plain text/);
  const plain = await readFile(await text.path(), "utf8");
  expect(plain).toMatch(/^A little greener, together\n\nThere is a patch/);
  expect(plain).not.toContain("#");
});

test("the page style applies to the page and is remembered", async ({ page, isMobile }) => {
  test.skip(isMobile, "Same menu on phones.");
  await addSample(page);
  await page.getByRole("button", { name: "Page style" }).click();
  const menu = page.getByRole("dialog", { name: "Page style" });
  await menu.getByRole("radio", { name: "Night" }).check();
  await menu.getByRole("radio", { name: "Sans" }).check();
  await expect(page.locator(".paper.page")).toHaveAttribute("data-style", "night");
  await expect(page.locator(".paper.page")).toHaveAttribute("data-font", "sans");
  await page.reload();
  await page.getByRole("button", { name: "Try a sample document" }).click();
  await expect(page.locator(".paper.page")).toHaveAttribute("data-style", "night");
});

test("printing shows only the document", async ({ page, isMobile }) => {
  test.skip(isMobile, "Printing is the same on phones.");
  await addSample(page);
  await page.evaluate(() => {
    window.print = () => window.dispatchEvent(new Event("printed"));
  });
  const printed = page.evaluate(
    () => new Promise((resolve) => window.addEventListener("printed", resolve, { once: true })),
  );
  await page.getByRole("button", { name: "Download", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Download" })
    .getByRole("button", { name: /^PDF/ })
    .click();
  await printed;
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#print-root")).toBeVisible();
  await expect(page.locator("#print-root")).toContainText("There is a patch of unused land");
  await expect(page.locator(".app-header")).toBeHidden();
});

test("side panels can be resized and hidden, and stay that way", async ({ page, isMobile }) => {
  test.skip(isMobile, "Phones show one panel at a time.");
  await addSample(page);
  const files = page.locator(".workspace-files");
  const before = (await files.boundingBox())!.width;
  const handle = page.getByRole("separator", { name: "Resize the files panel" });
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await files.boundingBox())!.width).toBeGreaterThan(before + 20);

  await page.getByRole("button", { name: "Hide the rewrite settings and hand-off panel" }).click();
  await expect(page.locator(".workspace-side")).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: "Try a sample document" }).click();
  await expect(page.locator(".workspace-side")).toBeHidden();
  await page.getByRole("button", { name: "Show the rewrite settings and hand-off panel" }).click();
  await expect(page.locator(".workspace-side")).toBeVisible();
});

test("long image names wrap inside the side panel", async ({ page, isMobile }) => {
  test.skip(isMobile, "Phones show the panel full width.");
  await page.goto("/app/?mode=images");
  await page.getByRole("button", { name: "Try a sample image" }).click();
  await expect(page.locator(".thumb")).toHaveCount(1);
  const png = await readFile("e2e/fixtures/new-version.png");
  await page.locator('input[type="file"][multiple]').first().setInputFiles({
    name: "grok-image-5e240bad-c326-43e6-95cc-255c0791ca33-and-a-very-long-name.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.locator(".thumb")).toHaveCount(2);
  await page.locator(".thumb-button").last().click();
  const overflow = await page
    .locator(".workspace-side")
    .evaluate((panel) => panel.scrollWidth - panel.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
