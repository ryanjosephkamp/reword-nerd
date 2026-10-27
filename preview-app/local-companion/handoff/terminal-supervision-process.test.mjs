import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, open, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { EventEmitter } from "node:events";
import { superviseNative } from "./terminal-supervision.mjs";

test("offline owned process group is terminated after timeout; original output prefix survives", async () => {
  const root = resolve("output/studio/repeatable-handoff/process-fault-tests");
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, "case-"));
  const stdout = await open(join(dir, "stdout.txt"), "wx"), stderr = await open(join(dir, "stderr.txt"), "wx");
  const child = spawn(process.execPath, ["-e", 'process.on("SIGTERM",()=>{});process.stdout.write("OWNED OFFLINE PARTIAL OUTPUT\\n");setInterval(()=>{},1000);'], {
    cwd: dir, env: { PATH: "/usr/bin:/bin" }, detached: true,
    stdio: ["pipe", stdout.fd, stderr.fd],
  });
  try {
    const outcome = await superviseNative(child, { stdout, stderr, prompt: "owned fixture", timeoutMs: 300, killAfterMs: 30, sampleMs: 20, signals: new EventEmitter() });
    assert.equal(outcome.reason, "owned-task-timeout");
    assert.equal(outcome.exit.signal, "SIGKILL");
    await stdout.sync();
    assert.equal((await readFile(join(dir, "stdout.txt"))).toString(), "OWNED OFFLINE PARTIAL OUTPUT\n");
  } finally { await stdout.close(); await stderr.close(); }
});
