import { mkdir, readdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Host } from "../host.mjs";
import { durableFile } from "../handoff/repeatable-state.mjs";
import { bounded, hash, safeDirectory } from "../handoff/contract.mjs";
import { loadCollection } from "./package.ts";
import { canonical, fromWire } from "../../src/collections/codec.ts";
import { prepareCollectionStage, parseCollectionResponse, imageCollectionPrompt } from "../../src/collections/stages.ts";
import { sourceContext, collectionId } from "../../src/collections/prepare.ts";
import { parseProjectFinal } from "../../src/collections/projectResult.ts";
import { COLLECTION_LIMITS as L, COLLECTION_STAGES } from "../../src/collections/limits.ts";
import { resolveRuntime } from "../../src/collections/runtime.mjs";
import { collectionWorkbook } from "../../src/collections/workbook.ts";

const maybe = async (path, max = 1024 * 1024) => { try { return await bounded(path, max); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };
const write = (path, object) => durableFile(path, canonical(object));
const downloadable = name => ["collection.json", "source-manifest.json", "outgoing-prompt.txt", "outcome.json", "dispatch-intent.json", "output-manifest.json", "collection-workbook.html", "collection-review.html"].includes(name) || /^(member-\d+|stage-[1-4]|native|task)-[a-z0-9.-]+$/.test(name) || /^member-\d+\.zip$/.test(name) || /^reference-0[1-4]-[a-f0-9]{12}\.png$/.test(name);
export async function createCollectionService(root, { textEnabled = false, imageEnabled = false, hostFactory = Host.open, imageStart = null, legacyBlocked = async () => false, smokeBudgetRoot = null, imageBoundary = false, evidenceLevel = "host-delivery-unproven" } = {}) {
  await mkdir(root, { recursive: true, mode: 0o700 }); await safeDirectory(root);
  await mkdir(join(root, "records"), { recursive: true, mode: 0o700 });
  let catalog = null, providerCapabilities = null, discoveryError = null, mutation = null, execution = null, controller = null, ownedHost = null;
  const recordDir = id => { if (!collectionId(id)) throw Error("Invalid collection ID"); return join(root, "records", id); };
  const load = async id => loadCollection(await bounded(join(await safeDirectory(recordDir(id)), "collection.json"), L.transportBytes));
  const claims = async () => {
    const names = (await readdir(root)).filter(n => /^claim-\d{4}\.json$/.test(n)).sort();
    const result = []; let previous = null;
    for (const [i, name] of names.entries()) {
      if (name !== `claim-${String(i + 1).padStart(4, "0")}.json`) throw Error("Interrupted collection claim history");
      const bytes = await bounded(join(root, name), 32768), c = JSON.parse(bytes);
      if (c.kind !== "reword-collection-dispatch" || c.version !== 3 || c.sequence !== i + 1 || c.previousClaimSha256 !== previous || !collectionId(c.id)) throw Error("Invalid collection claim chain");
      const v = await load(c.collectionId);
      if (c.seal !== v.seal || c.runtimeSha256 !== v.envelope.runtimeSha256 || !(await bounded(join(recordDir(c.collectionId), "dispatch-intent.json"), 32768)).equals(bytes)) throw Error("Collection dispatch binding mismatch");
      result.push(c); previous = hash(bytes);
    }
    return result;
  };
  async function completed(c) {
    const dir = recordDir(c.collectionId), raw = await maybe(join(dir, "outcome.json"));
    if (!raw) return false;
    const o = JSON.parse(raw);
    if (o.dispatchId !== c.id || o.seal !== c.seal || o.status !== "awaiting-user-review" || !o.artifacts || !Array.isArray(o.artifacts)) return false;
    for (const a of o.artifacts) {
      if (!/^[a-z0-9.-]+$/.test(a.name)) return false;
      const bytes = await bounded(join(dir, a.name), L.transportBytes);
      if (bytes.length !== a.byteLength || hash(bytes) !== a.sha256) return false;
    }
    if (c.operation === "text") return o.stageRequests === 4 && o.completedStages === 4;
    return o.nativeCleanCompletion === true && typeof o.taskId === "string";
  }
  async function blocked(includeLegacy = true) {
    if (includeLegacy && await legacyBlocked()) return true;
    const all = await claims();
    // An intent without its matching global claim is also an uncertain boundary.
    for (const id of (await readdir(join(root, "records"))).filter(collectionId)) {
      const names = await readdir(recordDir(id));
      for (const n of names.filter(n => n.startsWith(".dispatch-intent.json.") && n.endsWith(".pending"))) {
        const final = await maybe(join(recordDir(id), "dispatch-intent.json"));
        if (!final || !final.equals(await bounded(join(recordDir(id), n), 32768))) return true;
      }
      if (names.includes("dispatch-intent.json") && !all.some(c => c.collectionId === id)) return true;
    }
    for (const n of (await readdir(root)).filter(n => n.startsWith(".claim-") && n.endsWith(".pending"))) {
      const target = n.match(/^\.(claim-\d{4}\.json)\./)?.[1], final = target ? await maybe(join(root, target)) : null;
      if (!final || !final.equals(await bounded(join(root, n), 32768))) return true;
    }
    return all.length > 0 && !(await completed(all.at(-1)));
  }
  async function refreshCatalog() {
    if (execution || mutation) throw Error("Wait for the owned operation before refreshing");
    const dir = join(root, "discovery"); await mkdir(dir, { recursive: true });
    const h = await hostFactory(dir);
    try { const c = await h.discover(); catalog = c.catalog; providerCapabilities = c.providerCapabilities; discoveryError = null; return catalog; }
    catch (e) { catalog = null; discoveryError = e.message; throw e; }
    finally { h.close(); }
  }
  async function capabilities() { return { kind: "reword-collections", version: 1, location: root, textEnabled, imageEnabled: imageEnabled && imageBoundary, imageBoundary, catalog, evidenceLevel, discoveryError, activeOrUncertain: await blocked(), mode: textEnabled || imageEnabled ? "explicit-execution" : "review-only", retention: "Prepare stores this collection and exact packages here until you deliberately remove only your owned state. Browser sources stay in memory. Runtime storage is managed by Codex." }; }
  async function list() {
    const entries = (await readdir(join(root, "records"))).filter(collectionId); const all = await claims(); const records = [];
    for (const id of entries) {
      const v = await load(id), dir = recordDir(id), claim = all.find(c => c.collectionId === id), outcome = await maybe(join(dir, "outcome.json"));
      const o = outcome ? JSON.parse(outcome) : null;
      const available = (await readdir(dir)).filter(downloadable);
      records.push({ id, seal: v.seal, operation: v.envelope.operation, memberPaths: v.envelope.members.map(m => m.path), runtime: v.envelope.runtime, resendOf: v.envelope.resendOf, location: dir,
        status: o?.status ?? (claim ? "active-or-uncertain" : "prepared"), error: o?.error ?? null, stageRequests: o?.stageRequests ?? (available.filter(n => /^stage-[1-4]-dispatch.json$/.test(n)).length),
        expectedOutputs: o?.expectedOutputs ?? v.envelope.expectedOutputs, actualExecutor: o?.actualExecutor ?? null, actualModel: o?.actualModel ?? null, actualEffort: o?.actualEffort ?? null,
        taskId: o?.taskId ?? null, artifacts: available, acceptedByUser: false });
    }
    return records;
  }
  async function exclusive(key, action) {
    if (mutation) { if (mutation.key === key) return mutation.promise; throw Error("Conflicting simultaneous collection request; no queue"); }
    const promise = action(); mutation = { key, promise };
    try { return await promise; } finally { mutation = null; }
  }
  async function prepare(bytes) {
    const identity = hash(bytes);
    return exclusive("prepare:" + identity, async () => {
      const v = await loadCollection(bytes), e = v.envelope, dir = recordDir(e.id);
      const prior = await maybe(join(dir, "collection.json"), L.transportBytes);
      if (prior) { if (hash(prior) !== v.seal) throw Error("Conflicting/stale collection identity"); return { id: e.id, seal: v.seal, duplicate: true }; }
      if ((await readdir(join(root, "records"))).length >= L.history) throw Error("Collection history limit reached");
      if (e.resendOf) await load(e.resendOf);
      await mkdir(dir, { mode: 0o700 });
      await durableFile(join(dir, "collection.json"), bytes);
      await write(join(dir, "source-manifest.json"), { collectionId: e.id, seal: v.seal, members: e.members.map(({ id, path, kind, format, sourceManifest, sourceSha256, packageSha256, promptSha256, settings, settingsSha256, omissions }) => ({ id, path, kind, format, sourceManifest, sourceSha256, packageSha256, promptSha256, settings, settingsSha256, omissions })), expectedOutputs: e.expectedOutputs });
      const prompt = e.operation === "text" ? (await prepareCollectionStage(e, "decompose")).prompt : imageCollectionPrompt(e);
      await durableFile(join(dir, "outgoing-prompt.txt"), prompt);
      await durableFile(join(dir, "collection-workbook.html"), await collectionWorkbook(e));
      for (const [i, m] of e.members.entries()) await durableFile(join(dir, `member-${i + 1}.zip`), Buffer.from(m.packageBase64, "base64"));
      return { id: e.id, seal: v.seal, prompt, location: dir };
    });
  }
  async function spendSmokeBudget(e, dispatchId) {
    if (!smokeBudgetRoot) return;
    await safeDirectory(smokeBudgetRoot);
    if (await maybe(join(smokeBudgetRoot, "smoke-stopped.json"))) throw Error("An authorized smoke failed or became uncertain; no additional model calls");
    for (const operation of ["text", "image"]) {
      const prior = await maybe(join(smokeBudgetRoot, operation + "-budget-spent.json"));
      if (prior) {
        const budget = JSON.parse(prior), all = await claims(), claim = all.find(c => c.id === budget.dispatchId);
        if (!claim || !await completed(claim)) throw Error("Prior smoke remains uncertain; no additional model calls");
      }
    }
    if (e.runtime?.model !== "gpt-5.6-sol" || e.runtime?.effort !== "medium") throw Error("Smoke runtime mismatch; no substitution");
    if (e.operation === "text" && (e.members.length !== 3 || e.members.some(m => m.kind !== "document") || e.members.reduce((n,m)=>n+m.reviewedBytes,0) > 12*1024)) throw Error("Authorized text smoke inventory mismatch");
    if (e.operation === "image" && e.members.length !== 2) throw Error("Authorized image smoke inventory mismatch");
    await write(join(smokeBudgetRoot, e.operation + "-budget-spent.json"), { kind: "collections-authorized-smoke-budget", version: 1, operation: e.operation, dispatchId, collectionId: e.id, maximumJobs: 1, maximumStageRequests: e.operation === "text" ? 4 : null, retries: 0, spent: true });
  }
  async function executeText(e, claim) {
    const dir = recordDir(e.id), history = {}, rawResponses = {}, outputs = [], artifacts = []; let stageRequests = 0, completedStages = 0, actual = null;
    const retain = async (name, data) => { const b = Buffer.from(typeof data === "string" ? data : canonical(data)); await durableFile(join(dir, name), b); artifacts.push({ name, byteLength: b.length, sha256: hash(b) }); };
    controller = new AbortController();
    try {
      ownedHost = await hostFactory(dir); const c = await ownedHost.discover();
      const r = resolveRuntime(c.catalog, e.runtime, "text"); if (!r.dispatchable) throw Error(r.reason);
      ownedHost.selectRuntime(e.runtime);
      for (const [index, stage] of COLLECTION_STAGES.entries()) {
        const task = await prepareCollectionStage(e, stage, history), n = index + 1;
        await retain(`stage-${n}-ticket.json`, task.ticket); await retain(`stage-${n}-prompt.txt`, task.prompt);
        const result = await ownedHost.run(dir, task.prompt, { signal: controller.signal,
          onDispatched: async identity => { await retain(`stage-${n}-dispatch.json`, { ...identity, dispatchId: claim.id, seal: claim.seal, stage, promptSha256: task.promptSha256, runtime: e.runtime }); stageRequests++; },
          onRawEvent: async event => { await appendFile(join(dir, `stage-${n}-events.jsonl`), JSON.stringify(event) + "\n", { mode: 0o600 }); },
          onRaw: async raw => { await retain(`stage-${n}-raw.json`, raw); },
        });
        actual = { executor: result.executor?.executor ?? null, model: result.executor?.model ?? null, effort: result.executor?.effort ?? null };
        const events = await maybe(join(dir, `stage-${n}-events.jsonl`), 4 * 1024 * 1024);
        if (events) artifacts.push({ name: `stage-${n}-events.jsonl`, byteLength: events.length, sha256: hash(events) });
        await retain(`stage-${n}-response.txt`, result.text);
        rawResponses[stage] = result.text;
        const parsed = parseCollectionResponse(result.text, task.ticket); await retain(`stage-${n}-validation.json`, parsed);
        history[stage] = parsed.results;
        if (!parsed.valid) throw Error("Structural response failure; missing: " + parsed.missing.join(", ") + "; " + parsed.errors.join("; "));
        completedStages++;
        if (stage === "final") for (const [mi, m] of e.members.entries()) {
          const text = parsed.results[m.id]; await retain(`member-${mi+1}-final.txt`, text);
          if (m.kind === "project") {
            const project = parseProjectFinal(text, sourceContext(fromWire(m.preparation))); await retain(`member-${mi+1}-project-review.json`, project);
            for (const [fi, f] of project.files.entries()) await retain(`member-${mi+1}-changed-${fi+1}.txt`, f.text);
            outputs.push(...m.expectedOutputs.map(o => ({ ...o, status: project.unchanged.includes(o.path) ? "unchanged" : "proposed-change", artifact: project.unchanged.includes(o.path) ? null : `member-${mi+1}-changed-${project.files.findIndex(f=>f.path===o.path)+1}.txt` })));
          } else outputs.push({ ...m.expectedOutputs[0], status: "returned-for-review", artifact: `member-${mi+1}-final.txt` });
        }
      }
      await retain("output-manifest.json", { collectionId: e.id, seal: claim.seal, outputs, acceptedByUser: false });
      await retain("collection-review.html", await collectionWorkbook(e, rawResponses));
      await write(join(dir, "outcome.json"), { dispatchId: claim.id, seal: claim.seal, status: "awaiting-user-review", stageRequests, completedStages, expectedOutputs: outputs, actualExecutor: actual.executor, actualModel: actual.model, actualEffort: actual.effort, artifacts, acceptedByUser: false });
    } catch (error) {
      await retain("collection-review.html", await collectionWorkbook(e, rawResponses)).catch(() => {});
      if (smokeBudgetRoot) await write(join(smokeBudgetRoot, "smoke-stopped.json"), { dispatchId: claim.id, reason: error.message }).catch(() => {});
      await write(join(dir, "outcome.json"), { dispatchId: claim.id, seal: claim.seal, status: "failed-or-uncertain", error: error.message, stageRequests, completedStages, expectedOutputs: e.expectedOutputs.map(o => outputs.find(x=>x.id===o.id) ?? o), artifacts, actualExecutor: actual?.executor ?? null, actualModel: actual?.model ?? null, actualEffort: actual?.effort ?? null, acceptedByUser: false });
    } finally { ownedHost?.close(); ownedHost = null; controller = null; }
  }
  async function dispatch(id, seal) {
    return exclusive("dispatch:" + id + ":" + seal, async () => {
      const v = await load(id); if (v.seal !== seal) throw Error("Stale outgoing confirmation");
      const e = v.envelope, all = await claims(), existing = all.find(c => c.collectionId === id);
      if (existing) return { dispatchId: existing.id, duplicate: true };
      if (execution || await blocked()) throw Error("Owned active or uncertain dispatch blocks another send");
      if (e.operation === "text" ? !textEnabled : !imageEnabled || !imageBoundary || !imageStart) throw Error("This operation is review-only or its effective boundary is unestablished");
      if (e.operation === "image" && (!providerCapabilities?.imageGeneration || !providerCapabilities?.namespaceTools)) throw Error("Official provider image namespace capability is unavailable; no fallback");
      const runtime = resolveRuntime(catalog, e.runtime, e.operation); if (!runtime.dispatchable) throw Error(runtime.reason);
      const claim = { kind: "reword-collection-dispatch", version: 3, id: randomUUID(), collectionId: id, seal, sequence: all.length + 1, previousClaimSha256: all.length ? hash(await bounded(join(root, `claim-${String(all.length).padStart(4, "0")}.json`), 32768)) : null, runtimeSha256: e.runtimeSha256, operation: e.operation, resendOf: e.resendOf, createdAt: new Date().toISOString() };
      await spendSmokeBudget(e, claim.id);
      // Same synced bytes on both sides before any native/model launch boundary.
      await write(join(recordDir(id), "dispatch-intent.json"), claim);
      await write(join(root, `claim-${String(claim.sequence).padStart(4, "0")}.json`), claim);
      execution = (e.operation === "text" ? executeText(e, claim) : imageStart({ root, dir: recordDir(id), envelope: e, claim, smokeBudgetRoot })).catch(async error => {
        if (smokeBudgetRoot) await write(join(smokeBudgetRoot, "smoke-stopped.json"), { dispatchId: claim.id, reason: error.message }).catch(() => {});
      }).finally(() => { execution = null; });
      execution.catch(() => {}); return { dispatchId: claim.id, duplicate: false };
    });
  }
  async function artifact(id, name) {
    if (!downloadable(name)) throw Error("Unknown collection artifact");
    await load(id); return bounded(join(recordDir(id), name), L.transportBytes);
  }
  return { capabilities, list, prepare, dispatch, artifact, refreshCatalog, blocked, close: async () => { controller?.abort(); ownedHost?.close(); await execution; }, cancel: () => { if (!controller) throw Error("No owned cancellable text process"); controller.abort(); return { localCancellationRequested: true, providerCancellationConfirmed: false }; } };
}
