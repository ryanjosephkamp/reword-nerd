import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, realpath, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
interface Launch { url: string; collectionTextEnabled: boolean; collectionImagesEnabled: boolean }
async function start(state: string) {
  const child = spawn(process.execPath, ["local-companion/cli.mjs", "--state", state, "--port", "0"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  const launch = await new Promise<Launch>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Owned companion did not become ready.")), 20_000);
    child.stderr!.on("data", data => { stderr = (stderr + data.toString()).slice(-8000); });
    child.stdout!.on("data", data => { stdout += data.toString(); try { const value = JSON.parse(stdout); if (value.url) { clearTimeout(timer); resolve(value); } } catch { /* Wait for the complete startup record. */ } });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("exit", code => { clearTimeout(timer); if (!stdout.includes('"url"')) reject(Error(`Owned companion exited (${code}): ${stderr}`)); });
  });
  return { child, launch };
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(Error("Owned companion did not close.")), 8000); child.once("exit", () => { clearTimeout(timer); resolve(); }); child.kill("SIGTERM"); });
}
async function files(root: string): Promise<string[]> { const entries = await readdir(root, { withFileTypes: true }); return (await Promise.all(entries.map(async entry => entry.isDirectory() ? (await files(join(root, entry.name))).map(n => entry.name + "/" + n) : [entry.name]))).flat(); }

test("the actual review-only companion recovers the workspace at a new port", async ({ page, context }) => {
  test.setTimeout(90_000);
  const root = await realpath(await mkdtemp(join(tmpdir(), "reword-companion-browser-"))), children: ChildProcess[] = [];
  const errors: string[] = [], starts: string[] = [];
  context.on("request", request => { if (request.method() === "POST" && /\/api\/(run|resume|collections\/(dispatch|catalog)|handoff\/dispatch)/.test(request.url())) starts.push(request.url()); });
  page.on("pageerror", e => errors.push(e.message));
  try {
    const first = await start(root); children.push(first.child);
    expect(first.launch.collectionTextEnabled).toBe(false); expect(first.launch.collectionImagesEnabled).toBe(false);
    await page.goto(first.launch.url);
    await page.getByRole("button", { name: "Remember this workspace on this device", exact: true }).click();
    await page.getByRole("button", { name: "Edit source", exact: true }).click();
    await page.getByRole("textbox", { name: "Document source", exact: true }).fill("Recovered across companion ports. 雪\nExact local data.");
    await expect(page.getByTestId("workspace-save-status")).toContainText(/^Saved /);
    await page.locator(".workspace-recovery summary").click();
    await expect(page.locator(".workspace-options")).toContainText("Companion-owned snapshots");
    const metadata = await (await page.request.get(new URL("/api/workspace/meta", first.launch.url).href)).json();
    const downloading = page.waitForEvent("download"); await page.getByRole("button", { name: "Export workspace file", exact: true }).click();
    const stream = await (await downloading).createReadStream(), chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).includes(Buffer.from(metadata.session))).toBe(false);
    await writeFile(join(root, "preservation-marker.txt"), "job claims remain independent");
    await page.close(); await stop(first.child);
    const second = await start(root); children.push(second.child);
    expect(new URL(second.launch.url).origin).not.toBe(new URL(first.launch.url).origin);
    const reopened = await context.newPage(); reopened.on("pageerror", e => errors.push(e.message)); await reopened.goto(second.launch.url);
    await expect(reopened.getByRole("textbox", { name: "Document source", exact: true })).toHaveValue("Recovered across companion ports. 雪\nExact local data.");
    await reopened.locator(".workspace-recovery summary").click();
    await reopened.getByRole("button", { name: "Forget saved workspace", exact: true }).click();
    await reopened.getByRole("button", { name: "Remove saved copies", exact: true }).click();
    await expect(reopened.locator(".workspace-options")).toContainText("Saved workspace copies removed");
    expect(await readFile(join(root, "preservation-marker.txt"), "utf8")).toBe("job claims remain independent");
    expect((await files(root)).some(n => /dispatch-intent|native-start-claimed|claim-\d/.test(n))).toBe(false);
    expect(starts).toEqual([]); expect(errors).toEqual([]);
  } finally { for (const child of children) await stop(child); await rm(root, { recursive: true, force: true }); }
});
