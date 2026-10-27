import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hydrateBoundPrompt } from "../../src/prompting/hydrationRuntime.js";
const fixture = "output/studio/connected-text/hydration-browser";
const out = "output/studio/connected-text-live/standalone-literal";
const payload = (html: string) =>
  JSON.parse(
    html.match(
      /<script type="application\/json" id="workbook-data">([\s\S]*?)<\/script>/,
    )![1],
  );
test("standalone JavaScript preserves raw CRLF payload and hydrates literal tokens exactly once", async ({
  page,
}) => {
  mkdirSync(out, { recursive: true });
  const initial = payload(readFileSync(fixture + "/workbook.html", "utf8"));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(resolve(fixture + "/workbook.html")).href);
  const download = async (name: string) => {
    const event = page.waitForEvent("download");
    await page.locator("[data-download-progress]").click();
    await (await event).saveAs(out + "/" + name);
    return payload(readFileSync(out + "/" + name, "utf8"));
  };
  const untouched = await download("untouched.html");
  expect(untouched.progress).toEqual(initial.progress);
  await page.getByRole("tab", { name: "MANUAL", exact: true }).click();
  const literal = JSON.parse(
    readFileSync(fixture + "/expected.json", "utf8"),
  ).literal.replace(/\r\n/g, "\n");
  const hashes = [];
  for (const stage of ["decompose", "rewrite", "verify", "final"]) {
    await page
      .locator(`[data-response-stage="${stage}"]`)
      .fill(stage + " browser edit " + literal);
    const current = await download(stage + ".html");
    for (const target of ["decompose", "rewrite", "verify", "final"]) {
      const expected = hydrateBoundPrompt(
        initial.workbook.promptBundle.manual[target],
        initial.workbook.promptBundle.manualBindings[target],
        current.progress.responses,
      );
      expect(current.progress.manual.prompts[target].canonicalText).toBe(
        expected,
      );
      expect(current.progress.manual.prompts[target].text).toBe(expected);
    }
    hashes.push({ changedStage: stage, allCanonicalStringsExact: true });
  }
  await page.goto(pathToFileURL(resolve(out + "/final.html")).href);
  expect(await page.locator('[data-response-stage="final"]').inputValue()).toBe(
    "final browser edit " + literal,
  );
  expect(errors).toEqual([]);
  writeFileSync(
    out + "/receipt.json",
    JSON.stringify(
      {
        fixtureOnly: true,
        newModelCalls: 0,
        untouchedCRLFPayloadExact: true,
        domEditingUsesBrowserLF: true,
        allStages: hashes,
        downloadReopened: true,
        errors,
      },
      null,
      2,
    ),
  );
});
