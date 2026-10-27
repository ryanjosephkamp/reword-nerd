import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { mkdir, mkdtemp, writeFile, readFile, rm, open } from "node:fs/promises";
import { resolve, join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createFixturePackage } from "./fixtures";
import { prepareJob, nextStage } from "./runner";

const execute = promisify(execFile);
let root: string;
beforeEach(async () => {
  await mkdir(resolve("output/studio/cli-tests"), { recursive: true });
  root = await mkdtemp(resolve("output/studio/cli-tests/case-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("recovers only a confirmed exited owner and preserves the pending ticket after a real process interruption", async () => {
  const zip = join(root, "selected.zip");
  await writeFile(zip, await createFixturePackage());
  const job = join(root, "job");
  await prepareJob(zip, job, { mode: "fixture" });
  const pending = await nextStage(job);
  const script = `const fs=require('node:fs');const path=require('node:path');const root=process.argv[1];fs.mkdirSync(path.join(root,'.lock'));fs.writeFileSync(path.join(root,'.lock','owner.json'),JSON.stringify({pid:process.pid,token:'interruption-test'}));process.stdout.write('ready');setInterval(()=>{},1000);`;
  const ownedChild = spawn(process.execPath, ["-e", script, job], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await once(ownedChild.stdout!, "data");
    const exit = once(ownedChild, "exit");
    ownedChild.kill("SIGKILL"); // Only the test's freshly created child.
    await exit;
    const resumed = await nextStage(job);
    expect(resumed.ticket).toEqual(pending.ticket);
    expect(await readFile(resumed.promptPath!, "utf8")).toBe(
      await readFile(pending.promptPath!, "utf8"),
    );
  } finally {
    if (ownedChild.exitCode === null && ownedChild.signalCode === null) ownedChild.kill();
  }
});

it("rejects command-specific option mistakes before creating a job", async () => {
  const forbidden = join(root, "must-not-exist");
  await expect(
    execute(process.execPath, ["companion/cli.mjs", "status", "--job", forbidden, "--revise"], {
      cwd: resolve("."),
    }),
  ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("ARGUMENT") });
  await expect(readFile(join(forbidden, "state.json"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("rejects an oversized sparse input through the actual CLI before reading it into memory", async () => {
  const file = join(root, "oversized.zip");
  const handle = await open(file, "wx");
  await handle.truncate(8 * 1024 * 1024 + 1);
  await handle.close();
  await expect(
    execute(process.execPath, ["companion/cli.mjs", "inspect", file], { cwd: resolve(".") }),
  ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("FILE_LIMIT") });
});
