import { expect, test } from "@playwright/test";
import { zipContents } from "./helpers";

const fixture = (name: string) => `e2e/fixtures/${name}`;

test.describe("real files", () => {
  test.skip(({ isMobile }) => isMobile, "File reading is the same on phones; desktop covers it.");

  test("a Word document keeps its text, table, and picture", async ({ page }) => {
    await page.goto("/app/");
    await page
      .locator('input[type="file"][multiple]')
      .setInputFiles(fixture("garden-proposal.docx"));
    await expect(page.getByRole("heading", { name: "garden-proposal.docx" })).toBeVisible();
    const paper = page.locator(".paper");
    await expect(paper.getByRole("heading", { name: "A little greener, together" })).toBeVisible();
    await expect(paper.locator("table")).toContainText("A reliable water source");
    await expect(paper.locator(".figure-ref")).toHaveCount(1);

    await page.getByRole("radio", { name: "Claude Code", exact: true }).check();
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download task folder" }).click();
    const download = await downloading;
    const folder = download.suggestedFilename().replace(/\.zip$/, "");
    const files = await zipContents(download);
    const paths = [...files.keys()];
    expect(paths).toContain(`${folder}/source/garden-proposal.docx`);
    expect(paths).toContain(`${folder}/text/garden-proposal.docx.md`);
    expect(paths.some((path) => path.startsWith(`${folder}/assets/garden-proposal.docx/`))).toBe(
      true,
    );
    const task = files.get(`${folder}/TASK.md`) ?? "";
    expect(task).toContain("`output/garden-proposal.docx`");
    expect(task).toContain("is `assets/garden-proposal.docx/");
  });

  test("a PDF with a text layer is read without OCR", async ({ page }) => {
    await page.goto("/app/");
    await page
      .locator('input[type="file"][multiple]')
      .setInputFiles(fixture("garden-proposal.pdf"));
    await expect(page.getByRole("heading", { name: "garden-proposal.pdf" })).toBeVisible();
    await expect(page.locator(".paper")).toContainText("unused land behind the community library");
    await page.getByRole("button", { name: "Original" }).click();
    await expect(page.locator(".pdf-page").first()).toBeVisible();
  });

  test("a scanned PDF is read with OCR, and accepted text joins the document", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/app/");
    await page.locator('input[type="file"][multiple]').setInputFiles(fixture("scanned-poster.pdf"));
    await expect(page.getByRole("heading", { name: "scanned-poster.pdf" })).toBeVisible({
      timeout: 90_000,
    });
    await page.getByRole("button", { name: /Scanned text/ }).click();
    await expect(page.locator(".ocr-item")).toContainText("Garden Day");
    await page.getByRole("button", { name: "Accept all" }).click();
    await page.getByRole("button", { name: "Read" }).click();
    await expect(page.locator(".paper")).toContainText("Garden Day");
  });

  test("pictures come out of PDFs and Word files in Images", async ({ page }) => {
    await page.goto("/app/?mode=images");
    await page
      .locator('input[type="file"][multiple]')
      .setInputFiles([fixture("garden-proposal.pdf"), fixture("garden-proposal.docx")]);
    await expect(page.locator(".thumb")).toHaveCount(2, { timeout: 30_000 });
  });
});
