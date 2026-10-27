// Loaded only by the owned offline browser test, never by the production CLI.
import { writeSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createService } from "../server.mjs";
import { runCollectionImage } from "./image-run.mjs";
import { normalizeCatalog } from "../../src/collections/runtime.mjs";
import { sourceContext } from "../../src/collections/prepare.ts";
import { sourceBoundaryToken } from "../../src/prompting/renderPromptSet.ts";
import { canonical, fromWire } from "../../src/collections/codec.ts";
export { OWNED_DOCS, OWNED_PROJECT, imageFixture } from "./fixtures.ts";
export async function browserFixture(root,dist) {
 const calls=[];
 const hostFactory=async()=>({choice:null,
   discover:async()=>({catalog:normalizeCatalog([{data:[{model:"gpt-5.6-sol",displayName:"GPT-5.6-Sol",supportedReasoningEfforts:[{reasoningEffort:"medium"},{reasoningEffort:"high"}],inputModalities:["text","image"]},{model:"gpt-6-astra",displayName:"GPT-6-Astra",supportedReasoningEfforts:[{reasoningEffort:"high"},{reasoningEffort:"xhigh"}],inputModalities:["text","image"]}],nextCursor:null}]),providerCapabilities:{imageGeneration:true,namespaceTools:true},executor:"DETERMINISTIC OFFLINE FIXTURE"}),
   selectRuntime(choice){this.choice=choice;},
   async run(dir,prompt,hooks){await hooks.onDispatched({threadId:"offline-browser-fixture"});calls.push({operation:"text",runtime:this.choice,prompt});
     const e=JSON.parse(await readFile(join(dir,"collection.json"),"utf8")),ticket=JSON.parse(prompt.match(/Ticket: (.+)/)[1]),{members,...identity}=ticket;
     const results=members.map((m,i)=>{let response=fromWire(e.members[i].preparation).reviewedExtractedText;
       if(ticket.stage==="final"&&e.members[i].kind==="project"){const c=sourceContext(fromWire(e.members[i].preparation)),b=sourceBoundaryToken(c.reviewedTreeHash,c.includedFiles);response=`<<<CHANGED_FILES>>>\n${b} BEGIN CHANGED FILES\nNone.\n${b} END CHANGED FILES\n<<<END_CHANGED_FILES>>>\n\n<<<UNCHANGED_PATHS>>>\n${c.includedFiles.map(f=>"- "+f.path).join("\n")}\n<<<END_UNCHANGED_PATHS>>>\n\n<<<EXCLUDED_PATHS>>>\n${c.excludedPaths.map(p=>"- "+p).join("\n")||"None."}\n<<<END_EXCLUDED_PATHS>>>\n\n<<<RISK_MANIFEST>>>\nNone.\n<<<END_RISK_MANIFEST>>>`;}
       return{...m,response};});
     const result={text:canonical({...identity,results}),executor:{executor:"DETERMINISTIC OFFLINE FIXTURE",...this.choice}};await hooks.onRawEvent({fixture:true,text:result.text});await hooks.onRaw(result);return result;
   },close(){},
 });
 const imageStart=({dir,claim})=>runCollectionImage(dir,claim.seal,{runtimeCheck:async()=>({executor:"DETERMINISTIC OFFLINE FIXTURE",binarySha256:"fixture"}),nativeSpawn:(_exe,args,options)=>{calls.push({operation:"image",args});writeSync(options.stdio[1],[{type:"thread.started",thread_id:"owned-offline-image-fixture"},{type:"item.completed",item:{type:"agent_message",text:"image-1/rendition and image-2/rendition acknowledged. No generation occurred."}},{type:"turn.completed"}].map(v=>JSON.stringify(v)).join("\n")+"\n");return{};},supervision:async()=>({exit:{code:0,signal:null},reason:null})});
 const service=await createService({root,dist,collectionOptions:{textEnabled:true,imageEnabled:true,imageBoundary:true,hostFactory,imageStart,evidenceLevel:"deterministic-fixture"}});
 return{service,calls};
}
