import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createCollectionService } from "./service.mjs";
import { textFixture, OWNED_DOCS } from "./fixtures";
import { canonical } from "../../src/collections/codec";
import { normalizeCatalog } from "../../src/collections/runtime.mjs";
import { parseStrictJson } from "../../src/collections/strictJson";
const root = "output/studio/collections/test-state";
async function state() { await mkdir(root, { recursive: true }); return mkdtemp(join(root,"owned-")); }
const catalog = () => normalizeCatalog([{ data: ["gpt-5.6-sol", "gpt-6-astra"].map(model => ({ model, displayName: model, supportedReasoningEfforts: [{ reasoningEffort: "medium" }, { reasoningEffort: "high" }], inputModalities: ["text", "image"] })), nextCursor: null }]);
function substitute({ fail = false, gate = Promise.resolve() } = {}) {
  const calls: string[] = [];
  const hostFactory = async () => ({
    choice: null as null | {model:string;effort:string},
    async discover() { return { catalog: catalog(), executor: "DETERMINISTIC OFFLINE SUBSTITUTE" }; },
    selectRuntime(runtime: {model:string;effort:string}) { this.choice = runtime; },
    async run(_dir: string, prompt: string, hooks: {onDispatched: (v:unknown)=>Promise<void>;onRaw: (v:unknown)=>Promise<void>;onRawEvent:(v:unknown)=>Promise<void>}) {
      await hooks.onDispatched({ threadId: "fixture-only" }); calls.push(prompt); await gate;
      const ticket = JSON.parse(prompt.match(/Ticket: (.+)/)![1]);
      const {members, ...identity} = ticket;
      const response = canonical({...identity, results: members.slice(0, fail ? 2 : undefined).map((m: {id:string}, i:number)=>({...m, response: OWNED_DOCS[i].text}))});
      const result = {text: response, executor: {executor:"DETERMINISTIC OFFLINE SUBSTITUTE",...this.choice}};
      await hooks.onRawEvent({type:"fixture",text:response}); await hooks.onRaw(result); return result;
    }, close() {},
  }); return { hostFactory, calls };
}
async function finish(service: Awaited<ReturnType<typeof createCollectionService>>) {
  for (let i=0;i<200;i++) { const records = await service.list(); if (!records.some((r:{status:string})=>r.status === "active-or-uncertain")) return records; await new Promise(ok=>setTimeout(ok,10)); }
  throw Error("Fixture did not complete");
}
describe("collection durable execution",()=>{
  it("retains four exact stages, two explicit sequential sends, duplicate return, lineage and restart downloads",async()=>{
    const dir=await state(), host=substitute(); let service=await createCollectionService(dir,{textEnabled:true,hostFactory:host.hostFactory});
    await service.refreshCatalog(); const first=await textFixture(); const p=await service.prepare(Buffer.from(canonical(first)));
    const dispatch=await service.dispatch(p.id,p.seal);
    expect(await service.dispatch(p.id,p.seal)).toEqual({dispatchId:dispatch.dispatchId,duplicate:true});
    expect((await finish(service))[0].status).toBe("awaiting-user-review"); expect(host.calls).toHaveLength(4);
    const second=await textFixture(); second.resendOf=first.id;
    const next=await service.prepare(Buffer.from(canonical(second))); await service.dispatch(next.id,next.seal);
    const records=await finish(service); expect(records).toHaveLength(2); expect(host.calls).toHaveLength(8);
    expect(records.find((r:{id:string})=>r.id===second.id)?.resendOf).toBe(first.id);
    await service.close(); service=await createCollectionService(dir);
    expect((await service.capabilities()).activeOrUncertain).toBe(false);
    expect((await service.artifact(first.id,"member-1-final.txt")).toString()).toBe(OWNED_DOCS[0].text);
    expect((await service.artifact(second.id,"stage-4-events.jsonl")).length).toBeGreaterThan(0);
    expect((await service.list()).every((r:{actualExecutor:string})=>r.actualExecutor==="DETERMINISTIC OFFLINE SUBSTITUTE")).toBe(true);
    await expect(service.dispatch(first.id,"0".repeat(64))).rejects.toThrow("Stale"); await service.close();
  });
  it("blocks simultaneous conflicting requests, retains malformed partial output, and never repairs or unlocks on restart",async()=>{
    let release!:()=>void; const gate=new Promise<void>(ok=>{release=ok;}),host=substitute({fail:true,gate}); const dir=await state();
    let service=await createCollectionService(dir,{textEnabled:true,hostFactory:host.hostFactory});await service.refreshCatalog();
    const first=await service.prepare(Buffer.from(canonical(await textFixture()))), second=await service.prepare(Buffer.from(canonical(await textFixture())));
    await service.dispatch(first.id,first.seal); await expect(service.dispatch(second.id,second.seal)).rejects.toThrow("active or uncertain");
    release(); expect((await finish(service)).find((r:{id:string})=>r.id===first.id)?.status).toBe("failed-or-uncertain");
    expect(host.calls).toHaveLength(1); const validation=JSON.parse((await service.artifact(first.id,"stage-1-validation.json")).toString());
    expect(Object.keys(validation.results)).toEqual(["doc-a","doc-b"]);expect(validation.missing).toEqual(["doc-c"]);
    await service.close();service=await createCollectionService(dir,{textEnabled:true,hostFactory:host.hostFactory});await service.refreshCatalog();
    await expect(service.dispatch(second.id,second.seal)).rejects.toThrow("active or uncertain");expect(host.calls).toHaveLength(1);await service.close();
  });
  it("retains an interrupted intent before the global claim as blocking evidence",async()=>{
    const dir=await state(),host=substitute(),service=await createCollectionService(dir,{textEnabled:true,hostFactory:host.hostFactory});await service.refreshCatalog();
    const first=await service.prepare(Buffer.from(canonical(await textFixture())));
    await writeFile(join(dir,"records",first.id,"dispatch-intent.json"),"{}");
    expect((await service.capabilities()).activeOrUncertain).toBe(true);
    const second=await service.prepare(Buffer.from(canonical(await textFixture())));
    await expect(service.dispatch(second.id,second.seal)).rejects.toThrow("active or uncertain");expect(host.calls).toHaveLength(0);await service.close();
  });
  it("spends the one-job smoke budget before launch and preserves it across restarts",async()=>{
    const dir=await state(),budget=join(dir,"authorization");await mkdir(budget);const host=substitute();
    let service=await createCollectionService(dir,{textEnabled:true,hostFactory:host.hostFactory,smokeBudgetRoot:budget});await service.refreshCatalog();
    const first=await service.prepare(Buffer.from(canonical(await textFixture())));await service.dispatch(first.id,first.seal);await finish(service);
    expect(JSON.parse(await readFile(join(budget,"text-budget-spent.json"),"utf8")).spent).toBe(true);await service.close();
    service=await createCollectionService(dir,{textEnabled:true,hostFactory:host.hostFactory,smokeBudgetRoot:budget});await service.refreshCatalog();
    const second=await service.prepare(Buffer.from(canonical(await textFixture())));await expect(service.dispatch(second.id,second.seal)).rejects.toThrow();expect(host.calls).toHaveLength(4);await service.close();
  });
});
describe("strict JSON data",()=>{
  it("preserves literal strings and rejects duplicate and malformed keys without repair",()=>{
    expect(parseStrictJson(' { "text": "雪\\r\\n$&" } ')).toEqual({text:"雪\r\n$&"});
    for(const raw of ['{"x":1,"x":2}','{"x":1,"\\u0078":2}','[1,]','{"x":1,}','1e999']) expect(()=>parseStrictJson(raw)).toThrow();
  });
});
it("a failed smoke blocks both budgets across a new state and never adds calls",async()=>{
 const dir=await state(),budget=join(dir,"authorization");await mkdir(budget);const host=substitute({fail:true});
 let service=await createCollectionService(dir,{textEnabled:true,hostFactory:host.hostFactory,smokeBudgetRoot:budget});await service.refreshCatalog();
 const first=await service.prepare(Buffer.from(canonical(await textFixture())));await service.dispatch(first.id,first.seal);await finish(service);
 expect(JSON.parse(await readFile(join(budget,"smoke-stopped.json"),"utf8")).dispatchId).toBeTruthy();await service.close();
 service=await createCollectionService(await state(),{textEnabled:true,hostFactory:host.hostFactory,smokeBudgetRoot:budget});await service.refreshCatalog();const another=await service.prepare(Buffer.from(canonical(await textFixture())));
 await expect(service.dispatch(another.id,another.seal)).rejects.toThrow(/smoke failed/);expect(host.calls).toHaveLength(1);await service.close();
});
it("a spent budget interrupted before claims blocks a fresh state without a retry",async()=>{
 const dir=await state(),budget=join(dir,"authorization");await mkdir(budget);await writeFile(join(budget,"image-budget-spent.json"),JSON.stringify({spent:true,dispatchId:"interrupted"}));const host=substitute();
 const service=await createCollectionService(dir,{textEnabled:true,hostFactory:host.hostFactory,smokeBudgetRoot:budget});await service.refreshCatalog();const p=await service.prepare(Buffer.from(canonical(await textFixture())));
 await expect(service.dispatch(p.id,p.seal)).rejects.toThrow(/Prior smoke remains uncertain/);expect(host.calls).toHaveLength(0);await service.close();
});
