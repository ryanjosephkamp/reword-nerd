import { expect, test } from "@playwright/test";
import { zipContents } from "./helpers";

test.beforeEach(async ({ page, context, browserName }) => {
  if (browserName === "chromium")
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/app/");
});

test("a sample document becomes a chat prompt", async ({ page, isMobile }) => {
  await page.getByRole("button", { name: "Try a sample document" }).click();
  await expect(page.getByRole("heading", { name: "urban-gardens.md" })).toBeVisible();
  if (isMobile) await page.getByRole("button", { name: "Hand off", exact: true }).click();
  await page.getByRole("radio", { name: "ChatGPT", exact: true }).check();
  await page.getByRole("button", { name: "See the prompt" }).click();
  const prompt = page.locator(".prompt-preview");
  await expect(prompt).toContainText("<<<SOURCE urban-gardens.md>>>");
  await expect(prompt).toContainText("There is a patch of unused land");
  await expect(prompt).toContainText("- Goal: Make it clear.");
  await expect(prompt).toContainText("<<<FINAL_DOCUMENT>>>");
});

test("a coding agent gets a task folder and one command", async ({ page, isMobile }) => {
  await page.getByRole("button", { name: "Try a sample document" }).click();
  if (isMobile) await page.getByRole("button", { name: "Hand off", exact: true }).click();
  await page.getByRole("radio", { name: "Claude Code", exact: true }).check();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download task folder" }).click();
  const download = await downloading;
  const folder = download.suggestedFilename().replace(/\.zip$/, "");
  expect(folder).toMatch(/^rn-urban-gardens-\d{4}-\d{4}$/);

  const files = await zipContents(download);
  expect([...files.keys()].sort()).toEqual(
    [
      "AGENTS.md",
      "CLAUDE.md",
      "GEMINI.md",
      "TASK.md",
      "output/.keep",
      "source/urban-gardens.md",
      "work/.keep",
    ].map((path) => `${folder}/${path}`),
  );
  expect(files.get(`${folder}/TASK.md`)).toContain("`output/urban-gardens.md`");

  await expect(page.locator(".command code")).toHaveText(
    new RegExp(`cd ~/Downloads .* cd ${folder} && claude "Follow TASK.md"$`),
  );
});

test("a pasted reply is compared and exported", async ({ page, isMobile }) => {
  await page.getByRole("button", { name: "Try a sample document" }).click();
  if (isMobile) await page.getByRole("button", { name: "Hand off", exact: true }).click();
  await page.getByRole("radio", { name: "ChatGPT", exact: true }).check();
  await page.getByText("Bring the result back").click();
  await page
    .getByLabel("Paste the model's reply to compare and export it")
    .fill(
      [
        "<<<FINAL_DOCUMENT>>>",
        "# Greener together",
        "",
        "Behind the library sits an empty lot.",
        "<<<END_FINAL_DOCUMENT>>>",
        "<<<FIDELITY_AUDIT>>>",
        "Meaning: REVIEW — shortened on purpose for the test",
        "<<<END_FIDELITY_AUDIT>>>",
      ].join("\n"),
    );
  if (isMobile) await page.getByRole("button", { name: "Result", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The rewrite", exact: true })).toBeVisible();
  await expect(page.getByText("The model flagged something to review.")).toBeVisible();
  await page.getByRole("radio", { name: "Word changes" }).check();
  await expect(page.locator(".diff ins").first()).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  expect((await downloading).suggestedFilename()).toBe("urban-gardens.md");
});

test("step by step unlocks each stage after the previous reply", async ({ page, isMobile }) => {
  await page.getByRole("button", { name: "Try a sample document" }).click();
  if (isMobile) await page.getByRole("button", { name: "Hand off", exact: true }).click();
  await page.getByRole("radio", { name: "Claude", exact: true }).check();
  await page.getByText("Go step by step").click();
  await expect(page.getByRole("button", { name: "Copy prompt 2" })).toBeDisabled();
  await page.getByLabel("Paste reply 1").fill("## Main point\nA garden would help.");
  await expect(page.getByRole("button", { name: "Copy prompt 2" })).toBeEnabled();
});

test("saving on this device survives a reload", async ({ page, isMobile }) => {
  await page.getByRole("button", { name: "Try a sample document" }).click();
  await expect(page.getByRole("heading", { name: "urban-gardens.md" })).toBeVisible();
  await page.getByRole("button", { name: /Workspace options/ }).click();
  await page.getByText("Save on this device").click();
  await page.getByRole("button", { name: "Close" }).click();
  if (!isMobile) await expect(page.locator(".save-status")).toContainText("Saved");
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(page.getByRole("heading", { name: "urban-gardens.md" })).toBeVisible();
});

test("the page never scrolls sideways", async ({ page }) => {
  await page.getByRole("button", { name: "Try a sample document" }).click();
  await expect(page.getByRole("heading", { name: "urban-gardens.md" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a workspace can be exported and imported", async ({ page, isMobile }) => {
  test.skip(isMobile, "Same flow on phones.");
  await page.getByRole("button", { name: "Try a sample document" }).click();
  await expect(page.getByRole("heading", { name: "urban-gardens.md" })).toBeVisible();
  await page.getByRole("button", { name: /Workspace options/ }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export workspace" }).click();
  const exported = await (await downloading).path();

  await page.getByRole("button", { name: "Start over" }).click();
  await page.getByRole("button", { name: "Remove everything" }).click();
  await expect(page.getByRole("button", { name: "Try a sample document" })).toBeVisible();

  await page.getByRole("button", { name: /Workspace options/ }).click();
  await page.locator('dialog input[type="file"]').setInputFiles(exported);
  await expect(page.getByRole("heading", { name: "urban-gardens.md" })).toBeVisible();
});

test("the narrowest phones don't scroll sideways", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.getByRole("button", { name: "Try a sample document" }).click();
  await expect(page.getByRole("heading", { name: "urban-gardens.md" })).toBeVisible();
  for (const tab of ["Files", "Document", "Hand off"]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    const wide = await page.evaluate(() =>
      [...document.querySelectorAll("body *")]
        .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 0.5)
        .map((element) => `${element.tagName}.${element.className}`)
        .slice(0, 5),
    );
    expect(overflow, `${tab} at 320 px: ${wide.join(", ")}`).toBeLessThanOrEqual(0);
  }
});
