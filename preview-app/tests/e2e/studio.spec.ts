import { expect, test, type Download, type Page } from "@playwright/test";
import JSZip from "jszip";
import {
  asPayload,
  createDocxFixture,
  createSelectablePdfFixture,
  markdownFixture,
  textFixture,
  type BrowserFixture,
} from "./fixtures";

function runtimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function bytesOf(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Expected a readable download.");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function openStudio(page: Page) {
  await page.goto("./");
  await expect(
    page.getByRole("main", { name: "reword-nerd writing studio" }),
  ).toBeVisible();
}

async function selectImported(page: Page, fixture: BrowserFixture) {
  const displayName = fixture.name
    .replace(/\.(md|txt)$/i, "")
    .replaceAll("-", " ");
  await page
    .locator(".studio-document-item")
    .filter({ hasText: displayName })
    .getByRole("button")
    .first()
    .click();
  await page.getByRole("button", { name: "Edit source", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Document source" }),
  ).not.toHaveValue("");
}

test("Studio imports real formats and packages exact originals with reviewed source", async ({
  page,
}) => {
  const errors = runtimeErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStudio(page);
  await page.getByRole("button", { name: /^Remove Urban gardens/ }).click();
  const fixtures = [
    textFixture,
    markdownFixture,
    await createDocxFixture(),
    createSelectablePdfFixture(),
  ];
  await page
    .getByLabel("Import documents")
    .setInputFiles(fixtures.map(asPayload));
  await expect(page.locator(".studio-document-item")).toHaveCount(
    fixtures.length,
  );
  const reviewed = new Map<string, string>();
  for (const fixture of fixtures) {
    await selectImported(page, fixture);
    const source = page.getByRole("textbox", { name: "Document source" });
    if (fixture.name === textFixture.name)
      await source.fill(
        `${textFixture.buffer.toString("utf8")}Reviewed in the writing studio.\n`,
      );
    reviewed.set(fixture.name, await source.inputValue());
    await expect(
      page.getByRole("button", { name: "Build package", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Review complete", exact: true })
      .click();
  }
  await page
    .getByRole("button", { name: "Polish it up", exact: false })
    .click();
  await page
    .getByRole("button", { name: "Build package", exact: true })
    .click();
  const workspace = page.getByRole("region", {
    name: "Prompt workspace",
    exact: true,
  });
  await expect(workspace).toBeVisible();
  const pending = page.waitForEvent("download");
  await workspace
    .getByRole("button", { name: "Download ZIP", exact: true })
    .click();
  const archive = await JSZip.loadAsync(await bytesOf(await pending), {
    checkCRC32: true,
  });
  const manifest = JSON.parse(
    await archive.file("manifest.json")!.async("string"),
  ) as {
    schemaVersion: number;
    documents: Array<{
      originalDisplayName: string;
      original: { path: string };
      reviewedExtraction: { path: string };
      settings: { tone: string };
    }>;
  };
  expect(manifest.schemaVersion).toBe(6);
  expect(manifest.documents).toHaveLength(fixtures.length);
  for (const fixture of fixtures) {
    const record = manifest.documents.find(
      (item) => item.originalDisplayName === fixture.name,
    )!;
    expect(
      await archive.file(record.original.path)!.async("nodebuffer"),
    ).toEqual(fixture.buffer);
    expect(
      await archive.file(record.reviewedExtraction.path)!.async("string"),
    ).toBe(reviewed.get(fixture.name));
    expect(record.settings.tone).toBe("professional");
  }
  await page.getByRole("button", { name: "Plain", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Prompt package", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText("Your previous package is safely here.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Build updated package", exact: true }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});

test("guided responses survive navigation and can be saved in a portable workbook", async ({
  page,
}) => {
  const errors = runtimeErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStudio(page);
  await page.screenshot({
    path: "output/studio/final-desktop.png",
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Build package", exact: true })
    .click();
  await page.getByRole("button", { name: /^Guided workflow/ }).click();
  await page.getByRole("button", { name: /^\d?\s*Rewrite$/ }).click();
  await expect(
    page.getByRole("button", { name: "Copy prompt", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /^\d?\s*Decompose$/ }).click();
  const decomposition =
    "Source map: preserve the library location, permission requirement, and accessible garden plan.";
  await page
    .getByRole("textbox", { name: "Model response", exact: true })
    .fill(decomposition);
  await page.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Generated prompt", exact: true }),
  ).toHaveValue(new RegExp(decomposition));
  await expect(
    page.getByRole("button", { name: "Copy prompt", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await page
    .getByRole("button", { name: "Prompt package", exact: true })
    .click();
  await page.getByRole("button", { name: /^Guided workflow/ }).click();
  await page.getByRole("button", { name: /^\d?\s*Decompose$/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Model response", exact: true }),
  ).toHaveValue(decomposition);
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Save progress HTML", exact: true })
    .click();
  const html = (await bytesOf(await pending)).toString("utf8");
  expect(html).toContain(decomposition);
  expect(html).toContain("<!doctype html>");
  expect(errors).toEqual([]);
});

test("mobile navigation, new drafts, comparison, and command menu remain usable", async ({
  page,
}) => {
  const errors = runtimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openStudio(page);
  await expect(
    page.getByRole("button", { name: "Toggle documents", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "output/studio/final-mobile.png",
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Toggle documents", exact: true })
    .click();
  await page.getByRole("button", { name: "New document", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Let’s give those words a home.",
  });
  await dialog
    .getByRole("textbox", { name: "DOCUMENT NAME" })
    .fill("Mobile notes.md");
  await dialog
    .getByRole("textbox", { name: "YOUR WORDS" })
    .fill("# Mobile notes\n\nThe library opens at nine. Bring a notebook.");
  await dialog
    .getByRole("button", { name: "Create document", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("textbox", { name: "Document source" })
    .fill(
      "# Mobile notes\n\nThe library opens at nine. Bring a blue notebook.",
    );
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(
    page.getByLabel("Inline text comparison").locator("ins"),
  ).toContainText("blue");
  await page
    .getByRole("button", { name: "Review complete", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Brief & insights", exact: true })
    .click();
  await page.getByRole("button", { name: "Insights", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your words, decoded." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Build package", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Prompt workspace", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Open command menu", exact: true })
    .click();
  const command = page.getByRole("dialog", { name: "Where to?" });
  await command
    .getByRole("textbox", { name: "Search commands" })
    .fill("appearance");
  await command.getByRole("button", { name: /^Switch appearance/ }).click();
  await expect(
    page.getByRole("button", { name: "Use dark appearance", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("a sample result can be compared, edited, retained across navigation, and downloaded exactly", async ({
  page,
}) => {
  const errors = runtimeErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStudio(page);
  await page
    .getByRole("button", { name: "Build package", exact: true })
    .click();
  await page.getByRole("button", { name: /^Try a sample response/ }).click();
  const reader = page.getByRole("region", {
    name: "Review your model result",
    exact: true,
  });
  await expect(reader).toBeVisible();
  await expect(
    reader.getByText("Extracted final document", { exact: true }),
  ).toBeVisible();
  await expect(
    reader.getByRole("heading", {
      name: "A little greener, together",
      exact: true,
    }),
  ).toBeVisible();
  await reader.screenshot({
    path: "output/studio/final-result.png",
    animations: "disabled",
    style: ".studio-topbar { visibility: hidden !important; }",
  });
  await reader
    .getByRole("button", { name: "Compare with source", exact: true })
    .click();
  await expect(reader.getByLabel("Inline text comparison")).toContainText(
    "community library",
  );
  await reader
    .getByRole("button", { name: "Edit result", exact: true })
    .click();
  const edited =
    "# My reviewed garden proposal\n\nKeep the library location and ask neighbors what they need.\n\nLocally edited, with café and 東京 preserved.  \n";
  await reader
    .getByRole("textbox", { name: "Your result text", exact: true })
    .fill(edited);
  await page.getByRole("button", { name: /^Guided workflow/ }).click();
  await expect(reader).not.toBeVisible();
  await page.getByRole("button", { name: /^One-shot/ }).click();
  await expect(
    reader.getByRole("textbox", { name: "Your result text", exact: true }),
  ).toHaveValue(edited);
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await page
    .getByRole("button", { name: "Prompt package", exact: true })
    .click();
  await expect(
    reader.getByRole("textbox", { name: "Your result text", exact: true }),
  ).toHaveValue(edited);
  const pending = page.waitForEvent("download");
  await reader
    .getByRole("button", { name: "Download Markdown", exact: true })
    .click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.md$/u);
  expect((await bytesOf(download)).toString("utf8")).toBe(edited);
  expect(
    await page
      .getByRole("textbox", { name: "Model response", exact: true })
      .inputValue(),
  ).not.toContain("My reviewed garden proposal");
  expect(errors).toEqual([]);
});

test("sorted package documents compare against their own sources and hostile result Markdown stays inert", async ({
  page,
  baseURL,
}) => {
  const errors = runtimeErrors(page);
  const externalRequests: string[] = [];
  const appOrigin = new URL(baseURL!).origin;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (/^https?:$/u.test(url.protocol) && url.origin !== appOrigin)
      externalRequests.push(request.url());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStudio(page);
  await page.getByRole("button", { name: /^Remove Urban gardens/ }).click();
  const fixtures: BrowserFixture[] = [
    {
      name: "zebra.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "# Zebra source\n\nThe zebra survey recorded 73 visits.\n",
      ),
    },
    {
      name: "alpha.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "# Alpha source\n\nThe alpha survey recorded 29 visits.\n",
      ),
    },
  ];
  await page
    .getByLabel("Import documents")
    .setInputFiles(fixtures.map(asPayload));
  for (const fixture of fixtures) {
    await selectImported(page, fixture);
    await page
      .getByRole("button", { name: "Review complete", exact: true })
      .click();
  }
  await page
    .getByRole("button", { name: "Build package", exact: true })
    .click();
  const picker = page.getByRole("combobox", {
    name: "Package document",
    exact: true,
  });
  await expect(picker).toHaveValue("0");
  await expect(
    page.getByRole("button", { name: /^Try a sample response/ }),
  ).toHaveCount(0);
  const hostile =
    "<<<FINAL_DOCUMENT>>>\n# Safe visible result\n\n[Reference](https://example.invalid/reference)\n\n![Diagram](https://example.invalid/pixel.png)\n\n<script>globalThis.__studioResultExecuted = true</script>\n<<<END_FINAL_DOCUMENT>>>";
  await page
    .getByRole("textbox", { name: "Model response", exact: true })
    .fill(hostile);
  await page
    .getByRole("button", { name: "Review result", exact: true })
    .click();
  const reader = page.getByRole("region", {
    name: "Review your model result",
    exact: true,
  });
  const preview = reader.getByRole("article", {
    name: "Your result reading preview",
    exact: true,
  });
  await expect(
    preview.getByRole("heading", { name: "Safe visible result", exact: true }),
  ).toBeVisible();
  await expect(preview.locator("a, img, script, iframe")).toHaveCount(0);
  await expect(
    preview.getByText("[Image: Diagram]", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __studioResultExecuted?: boolean })
          .__studioResultExecuted,
    ),
  ).toBeUndefined();
  await reader
    .getByRole("button", { name: "Compare with source", exact: true })
    .click();
  await reader
    .getByRole("button", { name: "Side by side", exact: true })
    .click();
  expect(
    await reader.getByLabel("Your source text", { exact: true }).textContent(),
  ).toBe(fixtures[1].buffer.toString("utf8"));
  await picker.selectOption("1");
  await page
    .getByRole("textbox", { name: "Model response", exact: true })
    .fill("A reviewed zebra result.");
  await page
    .getByRole("button", { name: "Review result", exact: true })
    .click();
  await reader
    .getByRole("button", { name: "Compare with source", exact: true })
    .click();
  await reader
    .getByRole("button", { name: "Side by side", exact: true })
    .click();
  expect(
    await reader.getByLabel("Your source text", { exact: true }).textContent(),
  ).toBe(fixtures[0].buffer.toString("utf8"));
  await picker.selectOption("0");
  expect(
    await reader.getByLabel("Your source text", { exact: true }).textContent(),
  ).toBe(fixtures[1].buffer.toString("utf8"));
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("changing the brief and importing a document preserves the previous response until replacement is confirmed", async ({
  page,
}) => {
  const errors = runtimeErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStudio(page);
  await page.getByRole("button", { name: "Edit source", exact: true }).click();
  const originalSource = await page
    .getByRole("textbox", { name: "Document source", exact: true })
    .inputValue();
  await page
    .getByRole("button", { name: "Build package", exact: true })
    .click();
  await page.getByRole("button", { name: /^Try a sample response/ }).click();
  const response = page.getByRole("textbox", {
    name: "Model response",
    exact: true,
  });
  const pastedResponse = await response.inputValue();
  const reader = page.getByRole("region", {
    name: "Review your model result",
    exact: true,
  });
  await reader
    .getByRole("button", { name: "Edit result", exact: true })
    .click();
  const editedResult =
    "# A considered garden plan\n\nPreserve this locally edited result across a new writing brief and another imported document.\n";
  await reader
    .getByRole("textbox", { name: "Your result text", exact: true })
    .fill(editedResult);
  await page.getByRole("button", { name: "Professional", exact: true }).click();
  await expect(
    page.getByText("Your previous package is safely here.", { exact: true }),
  ).toBeVisible();
  await expect(response).toHaveValue(pastedResponse);
  await expect(
    reader.getByRole("textbox", { name: "Your result text", exact: true }),
  ).toHaveValue(editedResult);
  const unrelated: BrowserFixture = {
    name: "another-note.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "# Another note\n\nA newly imported source with entirely different words.\n",
    ),
  };
  await page.getByLabel("Import documents").setInputFiles(asPayload(unrelated));
  await expect(page.locator(".studio-document-item")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Prompt package", exact: true })
    .click();
  await expect(response).toHaveValue(pastedResponse);
  await expect(
    reader.getByRole("textbox", { name: "Your result text", exact: true }),
  ).toHaveValue(editedResult);
  await reader
    .getByRole("button", { name: "Compare with source", exact: true })
    .click();
  await reader
    .getByRole("button", { name: "Side by side", exact: true })
    .click();
  expect(
    await reader.getByLabel("Your source text", { exact: true }).textContent(),
  ).toBe(originalSource);
  const markdownPending = page.waitForEvent("download");
  await reader
    .getByRole("button", { name: "Download Markdown", exact: true })
    .click();
  expect((await bytesOf(await markdownPending)).toString("utf8")).toBe(
    editedResult,
  );
  const progressPending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Save progress HTML", exact: true })
    .click();
  expect((await bytesOf(await progressPending)).toString("utf8")).toContain(
    "A little greener, together",
  );
  const zipPending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download ZIP", exact: true }).click();
  const previousZip = await JSZip.loadAsync(await bytesOf(await zipPending), {
    checkCRC32: true,
  });
  const previousManifest = JSON.parse(
    await previousZip.file("manifest.json")!.async("string"),
  ) as {
    documents: Array<{
      reviewedExtraction: { path: string };
      settings: { tone: string };
    }>;
  };
  expect(previousManifest.documents).toHaveLength(1);
  expect(previousManifest.documents[0].settings.tone).toBe("plain");
  expect(
    await previousZip
      .file(previousManifest.documents[0].reviewedExtraction.path)!
      .async("string"),
  ).toBe(originalSource);
  await selectImported(page, unrelated);
  await page
    .getByRole("button", { name: "Review complete", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Build updated package", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "Ready for a fresh package?",
  });
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole("button", { name: "Back to previous package", exact: true })
    .click();
  await expect(response).toHaveValue(pastedResponse);
  await reader
    .getByRole("button", { name: "Edit result", exact: true })
    .click();
  await expect(
    reader.getByRole("textbox", { name: "Your result text", exact: true }),
  ).toHaveValue(editedResult);
  await page
    .getByRole("button", { name: "Build updated package", exact: true })
    .click();
  await confirmation
    .getByRole("button", { name: "Replace package", exact: true })
    .click();
  await expect(confirmation).not.toBeVisible();
  await expect(
    page.getByText("Your previous package is safely here.", { exact: true }),
  ).toHaveCount(0);
  const picker = page.getByRole("combobox", {
    name: "Package document",
    exact: true,
  });
  await expect(picker.locator("option")).toHaveCount(2);
  await expect(response).toHaveValue("");
  await expect(reader).toHaveCount(0);
  await picker.selectOption("1");
  await expect(response).toHaveValue("");
  await picker.selectOption({ label: "Urban gardens · sample.md" });
  await expect(
    page.getByRole("button", { name: /^Try a sample response/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
