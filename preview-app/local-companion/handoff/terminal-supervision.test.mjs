import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { superviseNative } from "./terminal-supervision.mjs";
function fixture() {
  const child = new EventEmitter(),
    signals = new EventEmitter();
  child.pid = 413099;
  child.stdin = new EventEmitter();
  let input;
  child.stdin.end = (x) => {
    input = x;
  };
  const sent = [],
    sizes = { out: 0, err: 0 };
  return {
    child,
    signals,
    sent,
    sizes,
    input: () => input,
    options: {
      stdout: { stat: async () => ({ size: sizes.out }) },
      stderr: { stat: async () => ({ size: sizes.err }) },
      prompt: "literal $& $$ $` $' 雪\n",
      signals,
      timeoutMs: 1000,
      sampleMs: 5,
      killAfterMs: 5,
      maxRawBytes: 128,
      signalGroup: (pid, signal) => {
        sent.push({ pid, signal });
        if (signal === "SIGKILL") child.emit("exit", null, signal);
      },
    },
  };
}
test("delayed exit preserves exact stdin; successful completion makes no signal", async () => {
  const f = fixture();
  const p = superviseNative(f.child, f.options);
  setTimeout(() => f.child.emit("exit", 0, null), 12);
  const r = await p;
  assert.equal(r.reason, null);
  assert.equal(r.exit.code, 0);
  assert.equal(f.input(), f.options.prompt);
  assert.deepEqual(f.sent, []);
  assert.equal(f.signals.listenerCount("SIGINT"), 0);
});
test("timeout signals only owned process group and escalates once", async () => {
  const f = fixture();
  const r = await superviseNative(f.child, { ...f.options, timeoutMs: 8 });
  assert.equal(r.reason, "owned-task-timeout");
  assert.deepEqual(f.sent, [
    { pid: f.child.pid, signal: "SIGTERM" },
    { pid: f.child.pid, signal: "SIGKILL" },
  ]);
});
test("partial logs hitting size bound are retained and not a completion claim", async () => {
  const f = fixture();
  f.sizes.out = 129;
  const r = await superviseNative(f.child, f.options);
  assert.equal(r.reason, "raw-output-bound");
  assert.equal(f.sizes.out, 129);
});
test("repeated interrupt signals stop once and listeners are removed", async () => {
  const f = fixture();
  const p = superviseNative(f.child, f.options);
  f.signals.emit("SIGINT");
  f.signals.emit("SIGTERM");
  const r = await p;
  assert.equal(r.reason, "user-interrupt");
  assert.equal(f.sent.length, 2);
  assert.equal(f.signals.listenerCount("SIGTERM"), 0);
});
test("spawn failure without PID never signals any process", async () => {
  const f = fixture();
  delete f.child.pid;
  const p = superviseNative(f.child, f.options);
  f.child.emit("error", new Error("OFFLINE spawn failed"));
  assert.equal((await p).exit.error, "OFFLINE spawn failed");
  assert.deepEqual(f.sent, []);
});
