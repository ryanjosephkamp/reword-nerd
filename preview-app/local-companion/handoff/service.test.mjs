import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  chmod,
  symlink,
  rename,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { request } from "node:http";
import JSZip from "jszip";
const out = resolve("output/studio/handoff-tests");
await mkdir(out, { recursive: true });
const suite = await mkdtemp(out + "/suite-");
await build({
  entryPoints: ["local-companion/handoff/test-entry.mjs"],
  outfile: join(suite, "entry.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  logLevel: "silent",
  plugins: [
    {
      name: "raw",
      setup(b) {
        b.onResolve({ filter: /\?raw$/ }, (a) => ({
          path: resolve(a.resolveDir, a.path.slice(0, -4)),
          namespace: "raw",
        }));
        b.onLoad({ filter: /.*/, namespace: "raw" }, async (a) => ({
          contents: `export default ${JSON.stringify(await readFile(a.path, "utf8"))}`,
          loader: "js",
        }));
      },
    },
  ],
});
const m = await import(pathToFileURL(join(suite, "entry.mjs")).href);
const image = await m.createImageFixture();
const text = await m.createFixturePackage({
  text: "Owned hostile data </script><img src=x onerror=alert(1)>\n$& $$ $` $' 雪 😀\n",
});
const reviewer = resolve("local-companion/handoff/review-launch.mjs");
let num = 0;
async function service(options = {}) {
  return m.createHandoffService(join(suite, "case-" + ++num), {
    reviewer,
    openTerminal: async () => {},
    ...options,
  });
}
const req = () => ({ requestId: randomUUID() });
test("real exporter parity: exact canonical prompt/reference and no fake generation claim", async () => {
  const s = await service();
  const r = await s.prepare(image.packageBytes, "image", req());
  const p = await m.loadImagePackage(image.packageBytes);
  assert.equal(r.prompt, p.prompt);
  assert.equal(r.promptSha256, p.promptSha256);
  assert.deepEqual(
    await s.artifact(r.id, "reference.png"),
    Buffer.from(image.referenceBytes),
  );
  assert.deepEqual(
    await s.artifact(r.id, "package.zip"),
    Buffer.from(image.packageBytes),
  );
  assert.equal(r.acceptedByUser, false);
  assert.equal(r.actualModel, null);
  assert.equal(r.phase, "prepared");
  assert.equal(r.automaticStartAvailable, false);
  const x = await m.inspectReview(r.location, r.snapshotSha256);
  assert.equal(x.args.at(-1), p.prompt);
  assert.equal(
    x.args[x.args.indexOf("--image") + 1],
    join(r.location, "reference.png"),
  );
});
test("canonical one-shot text is not reworded or normalized by handoff", async () => {
  const s = await service();
  const r = await s.prepare(text, "text", req());
  const p = await m.loadPackage(text);
  assert.equal(r.prompt, p.workbook.oneShot.prompt);
  assert.deepEqual(
    await s.artifact(r.id, "reviewed-source.txt"),
    Buffer.from(p.sourceText),
  );
  assert.equal(r.workflow, "canonical-one-shot-text");
});
test("identical request and source repeats are idempotent; conflicts rejected", async () => {
  const s = await service();
  const input = req(),
    a = await s.prepare(image.packageBytes, "image", input);
  assert.equal((await s.prepare(image.packageBytes, "image", input)).id, a.id);
  assert.equal((await s.prepare(image.packageBytes, "image", req())).id, a.id);
  await assert.rejects(s.prepare(text, "text", input), /Conflicting/);
  assert.equal((await s.list()).length, 1);
});
test("explicit resend preserves prior snapshot; wrong-source resend rejected", async () => {
  const s = await service();
  const a = await s.prepare(image.packageBytes, "image", req());
  const b = await s.prepare(image.packageBytes, "image", {
    ...req(),
    resendOf: a.id,
  });
  assert.notEqual(a.id, b.id);
  assert.equal(b.resendOf, a.id);
  assert.equal((await s.list()).length, 2);
  await assert.rejects(
    s.prepare(text, "text", { ...req(), resendOf: a.id }),
    /Resend source/,
  );
});
test("wrong/stale identities and unsafe artifact names fail closed", async () => {
  const s = await service();
  const a = await s.prepare(image.packageBytes, "image", req());
  await assert.rejects(s.launch(a.id, "0".repeat(64)), /Stale/);
  await assert.rejects(s.artifact("../x", "prompt.txt"), /identity/);
  await assert.rejects(s.artifact(a.id, "../snapshot.json"), /Unknown/);
  await assert.rejects(
    s.prepare(image.packageBytes, "image", { requestId: "../foo" }),
    /Invalid/,
  );
});
test("changed reference or snapshot is rejected before terminal open", async () => {
  let opened = 0;
  const s = await service({ openTerminal: async () => opened++ });
  const a = await s.prepare(image.packageBytes, "image", req());
  await chmod(join(a.location, "reference.png"), 0o600);
  await writeFile(join(a.location, "reference.png"), "tampered");
  await assert.rejects(s.launch(a.id, a.snapshotSha256), /changed/);
  assert.equal(opened, 0);
});
test("symlinked artifacts and roots are rejected", async () => {
  const s = await service();
  const a = await s.prepare(image.packageBytes, "image", req());
  await rename(
    join(a.location, "prompt.txt"),
    join(a.location, "prompt-original.txt"),
  );
  await symlink(
    join(a.location, "prompt-original.txt"),
    join(a.location, "prompt.txt"),
  );
  await assert.rejects(s.artifact(a.id, "prompt.txt"));
  const alias = join(suite, "alias");
  await symlink(suite, alias);
  await assert.rejects(m.createHandoffService(alias), /Symlink/);
});
test("uncertain terminal launch cannot dispatch twice", async () => {
  let opened = 0;
  const s = await service({
    openTerminal: async () => {
      opened++;
      throw Error("fixture launch acknowledgement lost");
    },
  });
  const a = await s.prepare(image.packageBytes, "image", req());
  await assert.rejects(s.launch(a.id, a.snapshotSha256), /uncertain/);
  const again = await s.launch(a.id, a.snapshotSha256);
  assert.equal(opened, 1);
  assert.equal(again.phase, "launch-requested-unconfirmed");
  assert.equal(again.events.length, 1);
});
test("reopen preserves sent snapshots and detects incomplete directories", async () => {
  const root = join(suite, "resume");
  const a = await m.createHandoffService(root, {
    reviewer,
    openTerminal: async () => {},
  });
  const r = await a.prepare(text, "text", req());
  await a.launch(r.id, r.snapshotSha256);
  await mkdir(join(root, randomUUID()));
  const b = await m.createHandoffService(root, {
    reviewer,
    openTerminal: async () => {
      throw Error("Must not relaunch");
    },
  });
  const list = await b.list();
  assert.equal(list.length, 2);
  assert.equal(
    list.find((x) => x.id === r.id).phase,
    "launch-requested-unconfirmed",
  );
  assert.ok(list.some((x) => x.phase === "incomplete-or-invalid"));
  await b.launch(r.id, r.snapshotSha256);
});
test("tampered/unsupported/oversized packages rejected before a record", async () => {
  const s = await service();
  await assert.rejects(s.prepare(Buffer.from("notzip"), "image", req()));
  await assert.rejects(s.prepare(image.packageBytes, "text", req()));
  await assert.rejects(
    s.prepare(Buffer.alloc(24 * 1024 * 1024 + 1), "image", req()),
    /limit/,
  );
  assert.equal((await s.list()).length, 0);
});
test("unsafe terminal characters remain data and arguments never become shell text", () => {
  const value = "$(touch /tmp/not-run) `cmd`\n--image other";
  const a = m.cliArgs({ sourceKind: "text" }, suite, value);
  assert.equal(a.at(-2), "--");
  assert.equal(a.at(-1), value);
  assert.equal(a.includes("--dangerously-bypass-approvals-and-sandbox"), false);
});
function http(base, path, method = "GET", body = null, headers = {}) {
  return new Promise((ok, bad) => {
    const u = new URL(base);
    const q = request(
      {
        host: u.hostname,
        port: u.port,
        path,
        method,
        headers: {
          ...headers,
          ...(body ? { "content-length": body.length } : {}),
        },
      },
      (r) => {
        const c = [];
        r.on("data", (x) => c.push(x));
        r.on("end", () => ok({ status: r.statusCode, body: Buffer.concat(c) }));
      },
    );
    q.on("error", bad);
    q.end(body);
  });
}
test("same-origin endpoints enforce sessions, bounds and exact downloadable source", async () => {
  const root = join(suite, "server");
  const dist = join(suite, "dist");
  await mkdir(dist);
  await writeFile(join(dist, "index.html"), "fixture");
  const s = await m.createService({
    root,
    dist,
    handoffReviewer: reviewer,
    handoffOpenTerminal: async () => {},
  });
  try {
    const c = JSON.parse((await http(s.url, "/api/handoff/capabilities")).body);
    const p = "/api/handoff/prepare?kind=image&requestId=" + randomUUID();
    const headers = {
      origin: new URL(s.url).origin,
      "x-reword-session": c.session,
      "content-type": "application/zip",
    };
    assert.notEqual(
      (
        await http(s.url, p, "POST", Buffer.from(image.packageBytes), {
          ...headers,
          origin: "https://evil.test",
        })
      ).status,
      200,
    );
    assert.notEqual(
      (
        await http(s.url, p, "POST", Buffer.from(image.packageBytes), {
          ...headers,
          "x-reword-session": "x",
        })
      ).status,
      200,
    );
    const created = await http(
      s.url,
      p,
      "POST",
      Buffer.from(image.packageBytes),
      headers,
    );
    assert.equal(created.status, 200, created.body.toString());
    const a = JSON.parse(created.body).handoff;
    const download = await http(
      s.url,
      `/api/handoff/artifact/${a.id}/reference.png`,
    );
    assert.deepEqual(download.body, Buffer.from(image.referenceBytes));
    const open = await http(
      s.url,
      "/api/handoff/open",
      "POST",
      Buffer.from(
        JSON.stringify({ id: a.id, snapshotSha256: a.snapshotSha256 }),
      ),
      { ...headers, "content-type": "application/json" },
    );
    for (const mutation of [
      {
        ...headers,
        origin: "https://evil.test",
        "content-type": "application/json",
      },
      {
        ...headers,
        "x-reword-session": "invalid",
        "content-type": "application/json",
      },
      { ...headers, "content-type": "application/json" },
    ]) {
      const denied = await http(
        s.url,
        "/api/handoff/dispatch",
        "POST",
        Buffer.from(
          JSON.stringify({ id: a.id, snapshotSha256: a.snapshotSha256 }),
        ),
        mutation,
      );
      assert.notEqual(denied.status, 200); // Disabled launch cannot initialize the native runtime.
    }
    const unsafe = await http(
      s.url,
      "/api/handoff/dispatch",
      "POST",
      Buffer.from(
        JSON.stringify({
          id: a.id,
          snapshotSha256: a.snapshotSha256,
          executable: "/bin/sh",
        }),
      ),
      { ...headers, "content-type": "application/json" },
    );
    assert.notEqual(unsafe.status, 200);
    assert.equal(open.status, 200, open.body.toString());
    assert.equal(
      JSON.parse(open.body).handoff.phase,
      "launch-requested-unconfirmed",
    );
  } finally {
    await s.close();
  }
});

test("CLI newline normalization is rejected rather than changing canonical content", async () => {
  const s = await service();
  const zip = await m.createFixturePackage({ text: "Owned CRLF\r\nsource\n" });
  await assert.rejects(s.prepare(zip, "text", req()), /normalizes CRLF/);
  assert.equal((await s.list()).length, 0);
});

test("changed portable export and cross-handoff events are rejected", async () => {
  const s = await service();
  const a = await s.prepare(image.packageBytes, "image", req());
  const original = await s.artifact(a.id, "handoff.zip");
  const zip = await JSZip.loadAsync(original);
  assert.deepEqual(
    await zip.file("reference.png").async("nodebuffer"),
    Buffer.from(image.referenceBytes),
  );
  assert.equal(await zip.file("prompt.txt").async("string"), a.prompt);
  await chmod(join(a.location, "handoff.zip"), 0o600);
  await writeFile(
    join(a.location, "handoff.zip"),
    Buffer.concat([original, Buffer.from("tamper")]),
  );
  await assert.rejects(s.artifact(a.id, "handoff.zip"), /bundle changed/);
  await writeFile(
    join(a.location, "review-opened.json"),
    JSON.stringify({
      handoffId: randomUUID(),
      snapshotSha256: a.snapshotSha256,
    }),
  );
  assert.equal((await s.list())[0].phase, "incomplete-or-invalid");
  await assert.rejects(s.launch(a.id, a.snapshotSha256), /identity mismatch/);
});
test("unlisted ZIP entries and forged canonical bindings do not create handoffs", async () => {
  const s = await service();
  for (const name of ["../escape.txt", "hidden.txt"]) {
    const zip = await JSZip.loadAsync(image.packageBytes);
    zip.file(name, "owned hostile fixture", { createFolders: false });
    await assert.rejects(
      s.prepare(
        await zip.generateAsync({ type: "nodebuffer" }),
        "image",
        req(),
      ),
    );
  }
  const zip = await JSZip.loadAsync(image.packageBytes);
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  manifest.pairs[0].source.sha256 = "0".repeat(64);
  zip.file("manifest.json", JSON.stringify(manifest, null, 2) + "\n", {
    createFolders: false,
  });
  await assert.rejects(
    s.prepare(await zip.generateAsync({ type: "nodebuffer" }), "image", req()),
  );
  assert.deepEqual(await s.list(), []);
});
test("capability explicitly rejects all task execution; renderer has no spawn or auth operation", async () => {
  const cap = await (await service()).discover();
  assert.equal(cap.executionAvailable, false);
  assert.equal(cap.automaticStartAvailable, false);
  assert.equal(cap.nativeDraftAvailable, false);
  assert.equal(cap.claude.available, false);
  const source = await readFile(reviewer, "utf8");
  assert.doesNotMatch(source, /node:child_process|login.*status|AuthManager/);
});
test("control and prompt bounds reject content without modifying canonical bytes", () => {
  for (const prompt of ["x\r\ny", "x\x1by", "x".repeat(65537)])
    assert.throws(
      () => m.cliArgs({ sourceKind: "text" }, suite, prompt),
      /limit|control/,
    );
});

test("preparation owns incoming package bytes before asynchronous discovery", async () => {
  const s = await service();
  const selected = Buffer.from(image.packageBytes);
  const pending = s.prepare(selected, "image", req());
  selected.fill(0);
  const record = await pending;
  assert.deepEqual(
    await s.artifact(record.id, "package.zip"),
    Buffer.from(image.packageBytes),
  );
});

test("repeatable service coalesces identical confirmations and rejects distinct concurrent ones without queueing", async () => {
  let release, entered;
  const arrived = new Promise(ok => { entered = ok; });
  const hold = new Promise(ok => { release = ok; });
  let calls = 0;
  const s = await service({ terminalRepeatable: true, terminalRunner: resolve("local-companion/handoff/terminal-run.mjs"), terminalCheck: async () => ({ executor: "OFFLINE SUBSTITUTE", model: "fixture", effort: "medium" }), openTerminal: async () => { calls++; entered(); await hold; } });
  const first = await s.prepare(image.packageBytes, "image", req());
  const second = await s.prepare(image.packageBytes, "image", { ...req(), resendOf: first.id });
  const one = s.dispatch(first.id, first.snapshotSha256);
  await arrived;
  const duplicate = s.dispatch(first.id, first.snapshotSha256);
  await assert.rejects(s.dispatch(second.id, second.snapshotSha256), /never queued/);
  release();
  const records = await Promise.all([one, duplicate]);
  assert.equal(calls, 1); assert.equal(records[0].id, records[1].id);
  assert.equal((await s.discover()).terminalTaskAvailable, false);
  await assert.rejects(s.dispatch(second.id, second.snapshotSha256), /uncertain/);
  assert.equal(calls, 1);
});
