import { request } from "node:http";
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  rename,
  readdir,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const parent = resolve("output/studio/local-tests");
await mkdir(parent, { recursive: true });
const root = await mkdtemp(parent + "/suite-");
await build({
  entryPoints: ["local-companion/test-entry.mjs"],
  outfile: root + "/entry.mjs",
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
const {
  createService,
  checkRequest,
  createFixturePackage,
  createImageFixture,
  createImagePreparation,
  prepareImageJob,
  nextImageAttempt,
} = await import(pathToFileURL(root + "/entry.mjs"));
const source =
  "Owned fixture: $& $$ $` $' [INSERT REWRITE OUTPUT HERE]\r\n雪\n";
const zip = await createFixturePackage({ text: source });
const fake = ({
  pause = false,
  failAfterRaw = false,
  failAfterDispatch = false,
  initialCount = 0,
} = {}) => {
  let count = initialCount;
  return {
    closed: false,
    discover: async () => ({
      kind: "reword-nerd-local-text",
      model: "offline-fixture",
      effort: "medium",
      executor: "deterministic fixture, no model calls",
    }),
    startThread: async () => ({}),
    run: async (_, prompt, { signal, onDispatched, onRaw, onRawEvent }) => {
      count++;
      assert.ok(prompt.includes(source));
      await onDispatched({ threadId: "offline-fixture" });
      await onRawEvent({ fixture: true, delta: "partial" });
      if (failAfterDispatch)
        throw Error("Synthetic interruption after dispatch");
      if (pause)
        await new Promise((_, bad) =>
          signal.addEventListener("abort", () => bad(Error("cancelled")), {
            once: true,
          }),
        );
      const result = {
        text:
          count === 4 ? "Exact final \r\n雪 $&\n" : `Fixture stage ${count}\n`,
        completion: { turnId: "fixture-" + count },
        rawMessage: { fixture: true },
        executor: { fixture: true },
      };
      await onRaw(result);
      if (failAfterRaw)
        throw Error("Synthetic interruption before runner record");
      return result;
    },
    close() {
      this.closed = true;
    },
  };
};
async function setup(options = {}) {
  const dir = await mkdtemp(root + "/case-");
  await mkdir(dir + "/dist");
  await writeFile(dir + "/dist/index.html", "owned UI");
  const service = await createService({
    root: dir + "/state",
    dist: dir + "/dist",
    live: true,
    hostFactory: async () => fake(options),
  });
  const cap = await (await fetch(service.url + "api/capabilities")).json();
  const post = (path, body) =>
    fetch(service.url + "api/" + path, {
      method: "POST",
      headers: {
        origin: service.url.slice(0, -1),
        "x-reword-session": cap.session,
        ...(body ? { "content-type": "application/zip" } : {}),
      },
      body,
    });
  return { dir, service, cap, post };
}
async function wait(
  service,
  terminal = ["awaiting-user-review", "failed", "cancelled"],
) {
  for (let i = 0; i < 100; i++) {
    if (terminal.includes(service.state?.status)) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error("fixture timeout");
}
test("Host/Origin/session rejection", () => {
  const req = {
    headers: {
      host: "127.0.0.1:1234",
      origin: "http://127.0.0.1:1234",
      "x-reword-session": "secret",
    },
  };
  checkRequest(req, "127.0.0.1:1234", "secret", true);
  for (const headers of [
    { ...req.headers, host: "evil.test" },
    { ...req.headers, origin: "http://evil.test" },
    { ...req.headers, "x-reword-session": "wrong" },
    { ...req.headers, origin: undefined },
  ])
    assert.throws(() =>
      checkRequest({ headers }, "127.0.0.1:1234", "secret", true),
    );
});
test("real package custody, four-stage literal hydration, exact downloads, one job cap", async () => {
  const { service, post } = await setup();
  try {
    assert.equal((await post("run", zip)).status, 202);
    await wait(service);
    assert.equal(service.state.status, "awaiting-user-review");
    assert.equal(service.state.modelTurns, 4);
    assert.equal(service.state.acceptedByUser, false);
    assert.deepEqual(
      new Uint8Array(
        await (
          await fetch(service.url + "api/artifact/package.zip")
        ).arrayBuffer(),
      ),
      zip,
    );
    assert.equal(
      await (await fetch(service.url + "api/artifact/final.md")).text(),
      "Exact final \r\n雪 $&\n",
    );
    assert.equal((await post("run", zip)).status, 400);
    assert.equal(
      (await fetch(service.url + "api/artifact/state.json")).status,
      400,
    );
    assert.equal((await fetch(service.url + "api/unknown")).status, 404);
    const audit = await (
      await fetch(service.url + "api/artifact/connection-audit.json")
    ).json();
    assert.equal(audit.dispatches.length, 4);
    assert.ok(audit.dispatches.every((x) => x.rawSha256 && x.promptSha256));
  } finally {
    await service.close();
  }
});
test("tampered and oversized input rejected before job", async () => {
  const { service, post } = await setup();
  try {
    const bad = zip.slice();
    bad[0] = 0;
    assert.equal((await post("run", bad)).status, 400);
    assert.equal(service.state, null);
    assert.equal(
      (await post("run", Buffer.alloc(8 * 1024 * 1024 + 1))).status,
      400,
    );
    assert.equal(service.state, null);
  } finally {
    await service.close();
  }
});
test("cancel owned stage, retain partial raw, block unsafe resume without retries", async () => {
  const { service, post, dir } = await setup({ pause: true });
  try {
    await post("run", zip);
    for (let i = 0; i < 30 && !service.state.dispatches.length; i++)
      await new Promise((r) => setTimeout(r, 10));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal((await post("cancel")).status, 202);
    await wait(service);
    assert.equal(service.state.status, "cancelled");
    assert.equal(service.state.modelTurns, 1);
    assert.equal((await post("resume")).status, 400);
    const t = service.state.dispatches[0];
    assert.match(
      await readFile(
        join(dir, "state", t.stage + "-" + t.ticketId + "-stream.jsonl"),
        "utf8",
      ),
      /partial/,
    );
  } finally {
    await service.close();
  }
});
test("HTTP cross-origin, session and arbitrary path blocked", async () => {
  const { service } = await setup();
  try {
    assert.equal(
      (
        await fetch(service.url + "api/run", {
          method: "POST",
          headers: { origin: "https://evil.test" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(service.url + "api/status", {
          headers: { origin: "https://evil.test" },
        })
      ).status,
      400,
    );
    assert.equal(
      (await fetch(service.url + "api/artifact/%2e%2e%2fconnection.json"))
        .status,
      404,
    );
  } finally {
    await service.close();
  }
});

async function reopen(dir, options = {}) {
  const service = await createService({
    root: dir + "/state",
    dist: dir + "/dist",
    live: true,
    hostFactory: async () => fake(options),
  });
  const cap = await (await fetch(service.url + "api/capabilities")).json();
  const post = (path) =>
    fetch(service.url + "api/" + path, {
      method: "POST",
      headers: {
        origin: service.url.slice(0, -1),
        "x-reword-session": cap.session,
      },
    });
  return { service, post };
}
test("state owner lock and interrupted retained response resume without duplicate turns", async () => {
  const first = await setup({ failAfterRaw: true });
  await first.post("run", zip);
  await wait(first.service);
  assert.equal(first.service.state.status, "failed");
  assert.equal(first.service.state.modelTurns, 1);
  await assert.rejects(() => reopen(first.dir), /live owner/);
  const entry = first.service.state.dispatches[0],
    path = join(
      first.dir,
      "state",
      entry.stage + "-" + entry.ticketId + "-response.txt",
    ),
    before = await readFile(path);
  await first.service.close();
  const second = await reopen(first.dir, { initialCount: 1 });
  try {
    assert.equal((await second.post("resume")).status, 202);
    await wait(second.service);
    assert.equal(second.service.state.status, "awaiting-user-review");
    assert.equal(second.service.state.modelTurns, 4);
    assert.deepEqual(await readFile(path), before);
    assert.equal(
      new Set(second.service.state.dispatches.map((x) => x.ticketId)).size,
      4,
    );
    assert.equal((await second.post("resume")).status, 400);
  } finally {
    await second.service.close();
  }
});
test("uncertain dispatched stage is not retried after restart", async () => {
  const first = await setup({ failAfterDispatch: true });
  await first.post("run", zip);
  await wait(first.service);
  await first.service.close();
  const second = await reopen(first.dir);
  try {
    assert.equal((await second.post("resume")).status, 400);
    assert.equal(second.service.state.modelTurns, 1);
  } finally {
    await second.service.close();
  }
});
test("retained raw envelope tampering blocks resume and preserves recorded artifacts", async () => {
  const first = await setup({ failAfterRaw: true });
  await first.post("run", zip);
  await wait(first.service);
  const d = first.service.state.dispatches[0];
  await first.service.close();
  const path = join(
    first.dir,
    "state",
    d.stage + "-" + d.ticketId + "-raw.json",
  );
  await writeFile(path, '{"syntheticTamper":true}');
  const second = await reopen(first.dir);
  try {
    assert.equal((await second.post("resume")).status, 202);
    await wait(second.service);
    assert.equal(second.service.state.status, "failed");
    assert.match(second.service.state.error, /Retained response binding/);
    assert.equal(second.service.state.modelTurns, 1);
    assert.equal(await readFile(path, "utf8"), '{"syntheticTamper":true}');
  } finally {
    await second.service.close();
  }
});
test("wrong persisted source and dispatch bindings are rejected on restart", async () => {
  const first = await setup({ failAfterRaw: true });
  await first.post("run", zip);
  await wait(first.service);
  await first.service.close();
  const path = join(first.dir, "state/connection.json"),
    original = await readFile(path, "utf8");
  for (const changed of [
    (s) => (s.sourceSha256 = "0".repeat(64)),
    (s) => (s.runnerJobId = "wrong-job"),
    (s) => (s.dispatches[0].stage = "final"),
    (s) => (s.modelTurns = 0),
  ]) {
    const state = JSON.parse(original);
    changed(state);
    await writeFile(path, JSON.stringify(state));
    await assert.rejects(() => reopen(first.dir), /binding mismatch/);
  }
  await writeFile(path, original);
});

test("completed job reopens for review without initializing any host", async () => {
  const first = await setup();
  await first.post("run", zip);
  await wait(first.service);
  await first.service.close();
  const before = await readFile(join(first.dir, "state/connection.json"));
  const service = await createService({
    root: first.dir + "/state",
    dist: first.dir + "/dist",
    live: false,
    hostFactory: async () => {
      throw Error("A review-only launch must not touch the host");
    },
  });
  try {
    const cap = await (await fetch(service.url + "api/capabilities")).json();
    assert.equal(cap.available, false);
    assert.equal(cap.mode, "review-only");
    const status = await (await fetch(service.url + "api/status")).json();
    assert.equal(status.job.status, "awaiting-user-review");
    assert.equal(status.job.modelTurns, 4);
    assert.deepEqual(
      await readFile(join(first.dir, "state/connection.json")),
      before,
    );
  } finally {
    await service.close();
  }
});

// Owned synthetic schema-1 exports. These tests make zero model/image calls.
const imageFixture = await createImageFixture();
async function imageSetup(dir = null) {
  dir ??= await mkdtemp(root + "/image-");
  await mkdir(dir + "/dist", { recursive: true });
  await writeFile(dir + "/dist/index.html", "owned UI");
  const service = await createService({
    root: dir + "/state",
    dist: dir + "/dist",
    live: false,
    hostFactory: async () => {
      throw Error("Offline image preparation must never initialize a host");
    },
  });
  const cap = await (
    await fetch(service.url + "api/image/capabilities")
  ).json();
  const post = (bytes, headers = {}) =>
    fetch(service.url + "api/image/prepare", {
      method: "POST",
      headers: {
        origin: service.url.slice(0, -1),
        "x-reword-session": cap.session,
        "content-type": "application/zip",
        ...headers,
      },
      body: bytes,
    });
  return { dir, service, cap, post };
}
test("offline image preparation uses real exporter, exact downloads, unsupported ticket and no host; repeat/reopen are idempotent", async () => {
  const first = await imageSetup();
  let before;
  try {
    assert.equal(first.cap.generationAvailable, false);
    assert.equal(first.cap.smokeAuthorized, false);
    const r = await first.post(imageFixture.packageBytes);
    assert.equal(r.status, 200, await r.clone().text());
    const v = await r.json();
    before = v.job;
    assert.equal(before.attempts.length, 1);
    assert.equal(before.attempts[0].status, "unsupported");
    assert.equal(before.attempts[0].ticket.capability.smokeAuthorized, false);
    assert.equal(
      before.attempts[0].ticket.capability.exactOutputArtifact,
      false,
    );
    assert.equal(before.execution.model, null);
    assert.equal(first.service.state, null);
    for (const [name, bytes] of [
      ["package.zip", imageFixture.packageBytes],
      ["reference.png", imageFixture.referenceBytes],
    ]) {
      const r = await fetch(first.service.url + "api/image/artifact/" + name);
      assert.equal(r.headers.get("x-content-type-options"), "nosniff");
      assert.deepEqual(new Uint8Array(await r.arrayBuffer()), bytes);
    }
    const repeated = await (await first.post(imageFixture.packageBytes)).json();
    assert.equal(repeated.idempotent, true);
    assert.deepEqual(repeated.job, before);
    const wrong = await createFixturePackage({ text: "owned text" });
    assert.equal((await first.post(wrong)).status, 400);
    assert.equal(
      (
        await fetch(first.service.url + "api/image/generate", {
          method: "POST",
          headers: {
            origin: first.service.url.slice(0, -1),
            "x-reword-session": first.cap.session,
          },
        })
      ).status,
      404,
    );
  } finally {
    await first.service.close();
  }
  const second = await imageSetup(first.dir);
  try {
    assert.deepEqual(
      (await (await second.post(imageFixture.packageBytes)).json()).job,
      before,
    );
  } finally {
    await second.service.close();
  }
});
test("image endpoint rejects invalid session/origin/host, unsafe paths, unsupported OCR, tampered/oversized ZIP before state", async () => {
  const { service, post, dir } = await imageSetup();
  try {
    for (const headers of [
      { origin: "https://evil.test" },
      { "x-reword-session": "wrong" },
    ])
      assert.equal(
        (await post(imageFixture.packageBytes, headers)).status,
        400,
      );
    const wrongHost = await new Promise((resolve, reject) => {
      const req = request(
        service.url + "api/image/status",
        { headers: { host: "evil.test" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(wrongHost, 400);
    assert.equal((await post(Buffer.alloc(24 * 1024 * 1024 + 1))).status, 400);
    const bad = imageFixture.packageBytes.slice();
    bad[0] = 0;
    assert.equal((await post(bad)).status, 400);
    const ocr = await createImageFixture({ acceptedOcr: true });
    assert.equal((await post(ocr.packageBytes)).status, 400);
    assert.equal(
      (await fetch(service.url + "api/image/artifact/%2e%2e%2fstate.json"))
        .status,
      404,
    );
    assert.equal(
      (await fetch(service.url + "api/image/artifact/state.json")).status,
      400,
    );
    assert.equal((await readdir(dir + "/state")).includes("image"), false);
  } finally {
    await service.close();
  }
});
test("image interrupted job preparation resumes without replacing ticket; conflicting archive and artifact tampering rejected", async () => {
  const dir = await mkdtemp(root + "/image-resume-");
  await writeFile(dir + "/selected-package.zip", imageFixture.packageBytes);
  await prepareImageJob(dir + "/selected-package.zip", dir + "/job", {
    mode: "host-assisted",
    host: "Not executed; offline image preparation",
    model: null,
  });
  const prep = await createImagePreparation(dir);
  const result = await prep.prepare(imageFixture.packageBytes);
  assert.equal(result.idempotent, true);
  const before = await readFile(dir + "/job/state.json");
  assert.deepEqual(
    (await prep.prepare(imageFixture.packageBytes)).job,
    result.job,
  );
  assert.deepEqual(await readFile(dir + "/job/state.json"), before);
  // Same canonical artifacts in a differently compressed valid ZIP: a conflicting package identity.
  const JSZip = (await import("jszip")).default;
  const z = await JSZip.loadAsync(imageFixture.packageBytes);
  const other = await z.generateAsync({
    type: "uint8array",
    compression: "STORE",
  });
  await assert.rejects(() => prep.prepare(other), /Conflicting image package/);
  await writeFile(dir + "/review/reference.png", imageFixture.resultBytes);
  await assert.rejects(
    () => prep.artifact("reference.png"),
    /custody mismatch/,
  );
  assert.deepEqual(await readFile(dir + "/job/state.json"), before);
});
test("image preparation refuses symlink and partial export without overwriting evidence", async () => {
  const dir = await mkdtemp(root + "/image-unsafe-");
  await symlink(root, dir + "/linked");
  const linked = await createImagePreparation(dir + "/linked");
  await assert.rejects(() => linked.snapshot(), /symlink/);
  const prep = await createImagePreparation(dir + "/new");
  await prep.prepare(imageFixture.packageBytes);
  await rename(dir + "/new/review", dir + "/retained-review");
  await symlink(dir + "/retained-review", dir + "/new/review");
  await assert.rejects(() => prep.artifact("reference.png"), /symlink/);
  const interrupted = dir + "/partial";
  await mkdir(interrupted);
  await writeFile(
    interrupted + "/selected-package.zip",
    imageFixture.packageBytes,
  );
  const incomplete = await createImagePreparation(interrupted);
  await assert.rejects(
    () => incomplete.prepare(imageFixture.packageBytes),
    /Interrupted preparation/,
  );
  assert.deepEqual(
    await readFile(interrupted + "/selected-package.zip"),
    Buffer.from(imageFixture.packageBytes),
  );
});

test("changed image ticket history cannot be presented as the sealed preparation", async () => {
  const dir = await mkdtemp(root + "/image-stale-");
  const prep = await createImagePreparation(dir + "/image");
  const prepared = await prep.prepare(imageFixture.packageBytes);
  const reviewBefore = await readFile(dir + "/image/review/audit.json");
  await nextImageAttempt(dir + "/image/job", {
    retry: true,
    capability: prepared.job.attempts[0].ticket.capability,
  });
  await assert.rejects(() => prep.snapshot(), /history is stale/);
  await assert.rejects(
    () => prep.artifact("reference.png"),
    /history is stale/,
  );
  assert.deepEqual(
    await readFile(dir + "/image/review/audit.json"),
    reviewBefore,
  );
});
test("collection mode blocks legacy start routes even before a collection claim exists",async()=>{
 const dir=await mkdtemp(root+"/collection-mode-");await mkdir(dir+"/dist");await writeFile(dir+"/dist/index.html","owned UI");
 const service=await createService({root:dir+"/state",dist:dir+"/dist",collectionOptions:{textEnabled:true}});
 try{const cap=await(await fetch(service.url+"api/collections/capabilities")).json();
 for(const path of ["run","resume","handoff/open","handoff/dispatch"]){const res=await fetch(service.url+"api/"+path,{method:"POST",headers:{origin:service.url.slice(0,-1),"x-reword-session":cap.session,"content-type":"application/json"},body:"{}"});assert.equal(res.status,400);assert.match((await res.json()).error,/New execution uses/);}
 }finally{await service.close();}
});
