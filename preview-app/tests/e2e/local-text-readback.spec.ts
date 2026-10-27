import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const out = "output/studio/connected-text-live";
const stateRoot = process.env.REWORD_COMPLETED_SMOKE;
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
test("read back already completed real host job; no model calls or Run action", async ({
  page,
}) => {
  test.skip(
    !stateRoot,
    "Requires explicitly selected completed owned smoke directory",
  );
  const root = resolve(stateRoot!),
    state = JSON.parse(readFileSync(root + "/connection.json", "utf8"));
  expect(state.status).toBe("awaiting-user-review");
  expect(state.modelTurns).toBe(4);
  expect(state.acceptedByUser).toBe(false);
  mkdirSync(out, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?mode=runs");
  const panel = page.getByRole("article", { name: "Connected local text" });
  const final = readFileSync(root + "/review/final.md");
  await expect(
    panel.getByText("Returned final document · awaiting your review", {
      exact: true,
    }),
  ).toBeVisible();
  expect(await panel.locator("pre").textContent()).toBe(final.toString("utf8"));
  await expect(
    panel.getByRole("button", { name: "Run four stages", exact: true }),
  ).toHaveCount(0);
  const downloads = [];
  for (const name of [
    "final.md",
    "source.md",
    "workbook-progress.html",
    "review.html",
    "package.zip",
    "decompose-raw.json",
    "rewrite-raw.json",
    "verify-raw.json",
    "final-raw.json",
  ]) {
    const event = page.waitForEvent("download");
    await panel.getByRole("link", { name, exact: true }).click();
    const download = await event;
    await download.saveAs(out + "/" + name);
    const raw = state.dispatches.find(
      (d: { stage: string }) => d.stage + "-raw.json" === name,
    );
    const original = readFileSync(
      name === "package.zip"
        ? root + "/job/package.zip"
        : raw
          ? root + "/" + raw.stage + "-" + raw.ticketId + "-raw.json"
          : root + "/review/" + name,
    );
    const received = readFileSync(out + "/" + name);
    expect(received).toEqual(original);
    downloads.push({
      name,
      sha256: sha(received),
      byteLength: received.length,
    });
  }
  await page.screenshot({ path: out + "/runs-desktop.png", fullPage: true });
  for (const mode of ["Text", "Images", "Projects", "Runs"]) {
    await page
      .getByRole("navigation", { name: "Workspace modes" })
      .getByRole("button", { name: mode, exact: true })
      .click();
    const start = page.getByRole("button", { name: "START LOCAL SESSION" });
    if (await start.isVisible()) await start.click();
  }
  await expect(
    panel.getByText("Returned final document · awaiting your review", {
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({ path: out + "/runs-mobile.png", fullPage: true });
  await panel.locator("pre").focus();
  await expect(panel.locator("pre")).toBeFocused();
  const workbook = await page.context().newPage();
  await workbook.goto(
    pathToFileURL(resolve(out + "/workbook-progress.html")).href,
  );
  for (const stage of ["decompose", "rewrite", "verify", "final"]) {
    expect(
      await workbook.locator(`[data-response-stage="${stage}"]`).inputValue(),
    ).toBe(readFileSync(root + "/review/" + stage + "-response.txt", "utf8"));
  }
  await workbook.getByRole("tab", { name: "MANUAL", exact: true }).click();
  await workbook.screenshot({
    path: out + "/workbook-desktop.png",
    fullPage: true,
  });
  await workbook.close();
  expect(errors).toEqual([]);
  expect(
    JSON.parse(readFileSync(root + "/connection.json", "utf8")).modelTurns,
  ).toBe(4);
  writeFileSync(
    out + "/browser-readback-receipt.json",
    JSON.stringify(
      {
        kind: "completed-real-host-run-readback",
        newModelCalls: 0,
        originModelTurns: state.modelTurns,
        jobId: state.id,
        sourceSha256: state.sourceSha256,
        packageSha256: state.packageSha256,
        acceptedByUser: false,
        downloads,
        allDownloadsExact: true,
        allWorkbookResponsesExact: true,
        modeRetention: true,
        mobileWidth: 390,
        keyboardFocus: true,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
});
