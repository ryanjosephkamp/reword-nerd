import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createFixturePackage } from "./fixtures";
import { getStatus, nextStage, prepareJob } from "./runner";

let scratch: string;
beforeEach(async () => {
  await mkdir(resolve("output/studio/recovery-tests"), { recursive: true });
  scratch = await mkdtemp(resolve("output/studio/recovery-tests/case-"));
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

it("fences competing dead-owner recovery before removal, then resumes one stable ticket", async () => {
  const zip = join(scratch, "chosen.zip");
  await writeFile(zip, await createFixturePackage());
  const job = join(scratch, "job");
  await prepareJob(zip, job, { mode: "fixture" });
  const pending = await nextStage(job);
  const before = await getStatus(job);
  const script = `const fs=require('node:fs');const path=require('node:path');const job=process.argv[1];fs.mkdirSync(path.join(job,'.lock'));fs.writeFileSync(path.join(job,'.lock','owner.json'),JSON.stringify({pid:process.pid,token:'owned-interrupted-recovery-test'}));process.stdout.write('ready');setInterval(()=>{},1000);`;
  const ownedChild = spawn(process.execPath, ["-e", script, job], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await once(ownedChild.stdout!, "data");
    const exited = once(ownedChild, "exit");
    ownedChild.kill("SIGKILL"); // This test's own newly spawned child only.
    await exited;
    const ownerPath = join(job, ".lock", "owner.json");
    const ownerBytes = await readFile(ownerPath);
    const guard = join(job, ".lock-recovery");
    await mkdir(guard); // This running test represents the current recovery owner.
    const blocked = await Promise.allSettled(
      Array.from({ length: 4 }, () => nextStage(job)),
    );
    for (const result of blocked) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected")
        expect(result.reason).toMatchObject({ code: "JOB_BUSY" });
    }
    expect(await readFile(ownerPath)).toEqual(ownerBytes);
    expect((await stat(guard)).isDirectory()).toBe(true);
    expect(await getStatus(job)).toEqual(before);
    await rmdir(guard); // Release only the guard created above, after its contenders settled.
    const competing = await Promise.allSettled(
      Array.from({ length: 8 }, () => nextStage(job)),
    );
    const successful = competing.filter(
      (result) => result.status === "fulfilled",
    );
    expect(successful.length).toBeGreaterThan(0);
    for (const result of competing) {
      if (result.status === "fulfilled") {
        expect(result.value.ticket).toEqual(pending.ticket);
        expect(result.value.promptPath).toBe(pending.promptPath);
      } else expect(result.reason).toMatchObject({ code: "JOB_BUSY" });
    }
    expect(await getStatus(job)).toEqual(before);
    expect((await nextStage(job)).ticket).toEqual(pending.ticket);
    await expect(stat(join(job, ".lock"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(stat(guard)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    if (ownedChild.exitCode === null && ownedChild.signalCode === null)
      ownedChild.kill();
  }
});
