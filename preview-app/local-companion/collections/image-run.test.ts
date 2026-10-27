import { it, expect } from "vitest";
import { mkdir, mkdtemp, symlink, rename } from "node:fs/promises";
import { writeSync } from "node:fs";
import { join } from "node:path";
import { createCollectionService } from "./service.mjs";
import { runCollectionImage } from "./image-run.mjs";
import { imageFixture } from "./fixtures";
import { canonical } from "../../src/collections/codec";
import { imageCollectionPrompt } from "../../src/collections/stages";
import { normalizeCatalog } from "../../src/collections/runtime.mjs";
const catalog=()=>normalizeCatalog([{data:[{model:"gpt-5.6-sol",displayName:"Sol",supportedReasoningEfforts:[{reasoningEffort:"medium"}],inputModalities:["text","image"]}],nextCursor:null}]);
const hostFactory=async()=>({discover:async()=>({catalog:catalog(),providerCapabilities:{imageGeneration:true,namespaceTools:true}}),close(){}});
const runtimeCheck=async()=>({executor:"OFFLINE NATIVE-RUNNER SUBSTITUTE",binarySha256:"fixture"});
it("final runner consumes exactly selected references in two sequential image dispatches and retains identities without claiming generation",async()=>{
  const parent="output/studio/collections/test-images";await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,"owned-"));let taskCalls=0;
  const fixture=await imageFixture();
  const imageStart=async({dir,claim}:{dir:string;claim:{seal:string}})=>runCollectionImage(dir,claim.seal,{
    runtimeCheck,
    nativeSpawn:(_exe:string,args:string[],options:{stdio:unknown[]})=>{
      taskCalls++;expect(args.slice(-2)).toEqual(["--","-"]);expect(args[args.indexOf("--model")+1]).toBe("gpt-5.6-sol");expect(args).toContain('model_reasoning_effort="medium"');
      expect(args.slice(args.indexOf("--image")+1,-2)).toHaveLength(2);
      writeSync(options.stdio[1] as number,[{type:"thread.started",thread_id:`offline-task-${taskCalls}`},{type:"item.completed",item:{type:"agent_message",text:"Acknowledged image-1/rendition and image-2/rendition; offline fixture only."}},{type:"turn.completed"}].map(v=>JSON.stringify(v)).join("\n")+"\n");return {};
    },
    supervision:async(_child:unknown,{prompt}:{prompt:string})=>{expect(prompt).toContain("one SEPARATE");return{exit:{code:0,signal:null},reason:null};},
  });
  let service=await createCollectionService(root,{imageEnabled:true,imageBoundary:true,imageStart,hostFactory});await service.refreshCatalog();
  for(let i=0;i<2;i++){
    const e={...fixture.envelope,id:crypto.randomUUID()};const prepared=await service.prepare(Buffer.from(canonical(e)));await service.dispatch(prepared.id,prepared.seal);
    for(let n=0;n<200;n++){if(!(await service.blocked()))break;await new Promise(ok=>setTimeout(ok,10));}
    const record=(await service.list()).find((r:{id:string})=>r.id===e.id);expect(record.status).toBe("awaiting-user-review");
    expect(record.expectedOutputs.map((o:{id:string})=>o.id)).toEqual(["image-1/rendition","image-2/rendition"]);expect(record.expectedOutputs.every((o:{status:string})=>o.status==="missing")).toBe(true);
    const input=JSON.parse((await service.artifact(e.id,"native-input.json")).toString());
    expect(input.references.map((r:{ordinal:number})=>r.ordinal)).toEqual([1,2]);
    for(const [n,r] of input.references.entries())expect(await service.artifact(e.id,r.name)).toEqual(Buffer.from(fixture.references[n]));
    expect((await service.artifact(e.id,"outgoing-prompt.txt")).toString()).toBe(imageCollectionPrompt(e));
  }
  expect(taskCalls).toBe(2);await service.close();service=await createCollectionService(root);expect((await service.list())).toHaveLength(2);expect(await service.blocked()).toBe(false);await service.close();
});
it("fails native startup on a symlinked collection envelope before spawn",async()=>{
  const parent="output/studio/collections/test-images";await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,"symlink-"));const e=(await imageFixture()).envelope;
  const service=await createCollectionService(root);const p=await service.prepare(Buffer.from(canonical(e)));const dir=join(root,"records",e.id),file=join(dir,"collection.json"),copy=join(dir,"copy.json");await rename(file,copy);await symlink(copy,file);
  let called=false;await expect(runCollectionImage(dir,p.seal,{runtimeCheck:async()=>{called=true;return{};}})).rejects.toThrow();expect(called).toBe(false);await service.close();
});
it("retains unknown native error items as uncertain even with a zero exit and completed turn",async()=>{
 const parent="output/studio/collections/test-images";await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,"native-error-"));
 const service=await createCollectionService(root,{imageEnabled:true,imageBoundary:true,hostFactory,imageStart:({dir,claim}:{dir:string;claim:{seal:string}})=>runCollectionImage(dir,claim.seal,{runtimeCheck,nativeSpawn:(_exe:string,_args:string[],options:{stdio:unknown[]})=>{writeSync(options.stdio[1] as number,[{type:"thread.started",thread_id:"fixture-error-only"},{type:"item.completed",item:{type:"error",message:"Unknown native tool failure"}},{type:"turn.completed"}].map(v=>JSON.stringify(v)).join("\n")+"\n");return{};},supervision:async()=>({exit:{code:0,signal:null},reason:null})})});
 await service.refreshCatalog();const p=await service.prepare(Buffer.from(canonical((await imageFixture()).envelope)));await service.dispatch(p.id,p.seal);
 let record;for(let n=0;n<200;n++){record=(await service.list())[0];if(record.status!=="active-or-uncertain")break;await new Promise(ok=>setTimeout(ok,10));}
 expect(record.status).toBe("failed-or-uncertain");expect(await service.blocked()).toBe(true);expect(JSON.parse((await service.artifact(p.id,"task-outcome.json")).toString()).startupWarnings).toEqual(["Unknown native tool failure"]);await service.close();
});
