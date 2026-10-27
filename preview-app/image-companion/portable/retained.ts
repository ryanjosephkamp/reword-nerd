import {z} from 'zod';
import {stateSchema,receiptSchema,ticketSchema,JOB_LIMITS} from './jobContracts';
import {createPackageValidator} from './package';
import {createPngInspector} from './png';
import {createReviewRenderer} from './review';
import {encode,utf8,base64,equalBytes,equalData as isDeepStrictEqual,fail,type ReviewRuntime} from './runtime';
export const RETAINED_LIMITS = Object.freeze({archiveBytes:64*1024*1024,expandedBytes:96*1024*1024,entryBytes:48*1024*1024,entries:32,manifestBytes:256*1024,originBytes:40*1024*1024,history:8});
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const uuid=z.string().uuid();
const inventoryItem=z.object({path:z.string().max(180),byteLength:z.number().int().nonnegative().max(RETAINED_LIMITS.entryBytes),sha256:digest}).strict();
const inventorySchema=z.array(inventoryItem).max(RETAINED_LIMITS.entries);
const registrationSchema=z.object({schemaVersion:z.literal(1),kind:z.literal('reword-nerd-retained-image-registration'),registrationId:uuid,createdAt:z.iso.datetime(),operation:z.literal('offline-retained-output-registration'),status:z.literal('awaiting-user-review'),acceptedByUser:z.literal(false),localAction:z.object({executor:z.literal('Reword Nerd local image companion'),validator:z.literal('retained-image-review-v1'),newModelCalls:z.literal(0)}).strict(),origin:z.object({jobId:uuid,ticketId:uuid,attempt:z.number().int().positive(),revision:z.number().int().positive(),status:z.literal('failed'),stateSha256:digest,ticketSha256:digest,receiptSha256:digest,packageSha256:digest,pairKey:z.string().max(256),referenceSha256:digest,promptSha256:digest,configurationSha256:digest}).strict(),output:z.object({sha256:digest,byteLength:z.number().int().positive().max(JOB_LIMITS.resultBytes),width:z.number().int().positive(),height:z.number().int().positive(),mimeType:z.literal('image/png')}).strict(),originalExecutor:z.object({executor:z.string().max(200),model:z.string().max(200).nullable(),tool:z.string().max(200).nullable()}).strict(),inputFingerprint:digest,artifacts:inventorySchema}).strict();
export type RetainedRegistration=z.infer<typeof registrationSchema>;
const manifestSchema=z.object({schemaVersion:z.literal(1),kind:z.literal('reword-nerd-retained-image-review-bundle'),registrationId:uuid,registrationSha256:digest,inputFingerprint:digest,originJobId:uuid,originTicketId:uuid,packageSha256:digest,referenceSha256:digest,promptSha256:digest,outputSha256:digest,status:z.literal('awaiting-user-review'),acceptedByUser:z.literal(false),artifacts:inventorySchema}).strict();
export type RetainedReviewManifest=z.infer<typeof manifestSchema>;
export function createRetainedValidator(runtime:ReviewRuntime){
const {loadImagePackage,readArchive}=createPackageValidator(runtime);
const inspectPng=createPngInspector(runtime),renderImageReview=createReviewRenderer(runtime),hash=runtime.hash;
const json=(value:unknown)=>encode(JSON.stringify(value,null,2)+'\n');
type Files=Map<string,Uint8Array>;
function parse<T>(schema:z.ZodType<T>,bytes:Uint8Array):T{try{return schema.parse(JSON.parse(utf8(bytes)));}catch{fail('INVALID_RECORD','Invalid bounded retained-review record.');}}
const file=(files:Files,path:string)=>files.get(path)??fail('MISSING_ARTIFACT',`Missing ${path}.`);
async function inventory(files:Files){return Promise.all([...files].sort(([a],[b])=>a.localeCompare(b,'en')).map(async ([path,bytes])=>({path,byteLength:bytes.length,sha256:await hash(bytes)})));}
function exact(a:unknown,b:unknown,message:string){if(!isDeepStrictEqual(a,b))fail('BINDING',message);}
function identical(a:Uint8Array,b:Uint8Array,message:string){if(!equalBytes(a,b))fail('CUSTODY',message);}
function limited(files:Files){if(files.size>RETAINED_LIMITS.entries||[...files.values()].reduce((n,b)=>n+b.length,0)>RETAINED_LIMITS.expandedBytes)fail('BUNDLE_LIMIT','Retained artifacts exceed aggregate limits.');}
/** Validate a coherent, bounded evidence snapshot entirely in memory. No source locks/writes. */
async function validateRetainedOrigin(files:Files,selectedTicket:string){
 if(!uuid.safeParse(selectedTicket).success)fail('ARGUMENT','Select an exact original ticket UUID.');
 limited(files);
 if([...files.values()].reduce((n,b)=>n+b.length,0)>RETAINED_LIMITS.originBytes)fail('ORIGIN_LIMIT','Origin evidence exceeds 40 MiB.');
 for(const [name,bytes] of files){const bound=name==='source-package.zip'?JOB_LIMITS.archiveBytes:name==='origin/state.json'?JOB_LIMITS.stateBytes:name.endsWith('.prompt.txt')||name==='prompt.txt'?64*1024:name.endsWith('.json')?JOB_LIMITS.receiptBytes:JOB_LIMITS.resultBytes;if(bytes.length>bound)fail('ORIGIN_LIMIT','An origin artifact exceeds its declared limit.');}
 const state=parse(stateSchema,file(files,'origin/state.json'));
 if(state.attempts.length<1||state.attempts.length>RETAINED_LIMITS.history||state.attempts.some(a=>a.result!==null))fail('UNSUPPORTED_HISTORY','This slice supports up to eight origin attempts without previously registered results.');
 const current=state.attempts.at(-1)!;
 if(state.execution.mode!=='host-assisted'||state.currentTicketId!==selectedTicket||current.ticket.ticketId!==selectedTicket||current.status!=='failed'||!current.reason)fail('ORIGIN_STATE','Select the current failed host attempt; original status is not rewritten.');
 const pkg=await loadImagePackage(file(files,'source-package.zip'));
 const binding={packageSha256:pkg.packageSha256,pairKey:pkg.pairKey,referenceSha256:pkg.referenceSha256,promptSha256:pkg.promptSha256,configurationSha256:await hash(JSON.stringify(pkg.configuration))};
 for(const [key,value] of Object.entries(binding))exact(state[key as keyof typeof state],value,'Origin state/package binding changed.');
 identical(file(files,'reference.png'),pkg.referenceBytes,'Original reference differs from canonical package.');
 if(await hash(file(files,'prompt.txt'))!==pkg.promptSha256)fail('BINDING','Original prompt differs from canonical package.');
 const expected=new Set(['origin/state.json','source-package.zip','reference.png','prompt.txt','returned.png','host-output-receipt.json']);
 const ids=new Set<string>();let revision=1;
 for(const [index,a] of state.attempts.entries()){
  const t=a.ticket;
  if(ids.has(t.ticketId)||t.jobId!==state.jobId||t.attempt!==index+1||t.revision<revision||t.revision>revision+1||t.priorResultHashes.length||!isDeepStrictEqual(t.execution,state.execution))fail('ORIGIN_CHAIN','Origin attempt chain is inconsistent.');
  if(index<state.attempts.length-1&&a.status!=='superseded')fail('ORIGIN_CHAIN','Historical attempts must remain superseded.');
  ids.add(t.ticketId);revision=t.revision;
  for(const [key,value] of Object.entries(binding))exact(t[key as keyof typeof t],value,'Origin ticket/package binding changed.');
  const ticketPath=`origin/tickets/${t.ticketId}.json`,promptPath=`origin/tickets/${t.ticketId}.prompt.txt`;
  expected.add(ticketPath);expected.add(promptPath);
  exact(parse(ticketSchema,file(files,ticketPath)),t,'Original immutable ticket differs from history.');
  identical(file(files,promptPath),file(files,'prompt.txt'),'Original ticket prompt changed.');
 }
 if(state.revision!==revision)fail('ORIGIN_CHAIN','Origin revision changed.');
 exact([...files.keys()].sort(),[...expected].sort(),'Unexpected origin artifacts.');
 const raw=file(files,'returned.png'),info=inspectPng(raw),receipt=parse(receiptSchema,file(files,'host-output-receipt.json'));
 if(receipt.ticketId!==selectedTicket||receipt.referenceSha256!==pkg.referenceSha256||receipt.promptSha256!==pkg.promptSha256||receipt.outputSha256!==await hash(raw))fail('WRONG_OUTPUT','Original receipt does not bind this ticket/reference/prompt/output.');
 if(receipt.tool!==current.ticket.capability.tool||receipt.tool!=='image_gen.imagegen')fail('ORIGIN_EXECUTOR','Original tool receipt does not match the ticket.');
 // These are preserved historical declarations only; no capability is activated.
 const artifacts=await inventory(files);
 return {state,pkg,current,receipt,artifacts,inputFingerprint:await hash(json(artifacts)),origin:{jobId:state.jobId,ticketId:selectedTicket,attempt:current.ticket.attempt,revision:current.ticket.revision,status:'failed' as const,stateSha256:await hash(file(files,'origin/state.json')),ticketSha256:await hash(file(files,`origin/tickets/${selectedTicket}.json`)),receiptSha256:await hash(file(files,'host-output-receipt.json')),...binding},output:{sha256:await hash(raw),byteLength:raw.length,...info},originalExecutor:{executor:receipt.executor,model:receipt.model,tool:receipt.tool}};
}
function registration(checked:Awaited<ReturnType<typeof validateRetainedOrigin>>,id:string,createdAt=new Date().toISOString()):RetainedRegistration{
 return {schemaVersion:1,kind:'reword-nerd-retained-image-registration',registrationId:id,createdAt,operation:'offline-retained-output-registration',status:'awaiting-user-review',acceptedByUser:false,localAction:{executor:'Reword Nerd local image companion',validator:'retained-image-review-v1',newModelCalls:0},origin:checked.origin,output:checked.output,originalExecutor:checked.originalExecutor,inputFingerprint:checked.inputFingerprint,artifacts:checked.artifacts};
}
function renderedFiles(reg:RetainedRegistration,files:Files,checked:Awaited<ReturnType<typeof validateRetainedOrigin>>){
 const ref=inspectPng(file(files,'reference.png'));
 const model={jobId:reg.origin.jobId,packageSha256:reg.origin.packageSha256,pairKey:reg.origin.pairKey,displayName:checked.pkg.displayName,prompt:checked.pkg.prompt,promptSha256:reg.origin.promptSha256,referenceSha256:reg.origin.referenceSha256,referenceBase64:base64(file(files,'reference.png')),width:ref.width,height:ref.height,execution:checked.state.execution,attempts:checked.state.attempts.map(a=>({attempt:a.ticket.attempt,revision:a.ticket.revision,ticketId:a.ticket.ticketId,status:a.status,reason:a.reason??undefined,...(a.ticket.ticketId===reg.origin.ticketId?{resultSha256:reg.output.sha256,resultBase64:base64(file(files,'returned.png')),width:reg.output.width,height:reg.output.height,executor:reg.originalExecutor.executor,model:reg.originalExecutor.model}:{})})),currentTicketId:reg.origin.ticketId,retainedRegistration:{id:reg.registrationId,validator:reg.localAction.validator}};
 const result:Files=new Map(files);result.set('registration.json',json(reg));result.set('saved-configuration.json',json(checked.pkg.configuration));result.set('review.html',encode(renderImageReview(model)));result.set('audit.json',json({kind:'retained-image-review-audit',schemaVersion:1,registration:reg,originState:checked.state,originalOutputReceipt:checked.receipt,acceptedByUser:false,meaning:'Offline registration of previously returned bytes. Original failure and original receipt unchanged. No new generation. Checksums establish consistency, not authorship.'}));limited(result);return result;
}
async function manifest(reg:RetainedRegistration,files:Files):Promise<RetainedReviewManifest>{return {schemaVersion:1,kind:'reword-nerd-retained-image-review-bundle',registrationId:reg.registrationId,registrationSha256:await hash(file(files,'registration.json')),inputFingerprint:reg.inputFingerprint,originJobId:reg.origin.jobId,originTicketId:reg.origin.ticketId,packageSha256:reg.origin.packageSha256,referenceSha256:reg.origin.referenceSha256,promptSha256:reg.origin.promptSha256,outputSha256:reg.output.sha256,status:'awaiting-user-review',acceptedByUser:false,artifacts:await inventory(files)};}
async function readRetainedBundle(bytes:Uint8Array){
 if(bytes.length>RETAINED_LIMITS.archiveBytes)fail('BUNDLE_LIMIT','Review ZIP exceeds 64 MiB.');
 const files=readArchive(Uint8Array.from(bytes),RETAINED_LIMITS);const manifestRaw=file(files,'manifest.json');if(manifestRaw.length>RETAINED_LIMITS.manifestBytes)fail('BUNDLE_LIMIT','Manifest exceeds 256 KiB.');const m=parse(manifestSchema,manifestRaw);files.delete('manifest.json');
 const raw=file(files,'registration.json');if(raw.length>RETAINED_LIMITS.manifestBytes)fail('BUNDLE_LIMIT','Registration exceeds 256 KiB.');const reg=parse(registrationSchema,raw);
 exact(m.artifacts,await inventory(files),'Bundle inventory, sizes or hashes differ.');
 const source:Files=new Map();for(const a of reg.artifacts){if(source.has(a.path))fail('BINDING','Duplicate origin inventory.');source.set(a.path,file(files,a.path));}
 const checked=await validateRetainedOrigin(source,reg.origin.ticketId);exact(reg,registration(checked,reg.registrationId,reg.createdAt),'Bundle registration/origin binding differs.');
 const expected=renderedFiles(reg,source,checked);exact(await inventory(files),await inventory(expected),'Bundle contains noncanonical review or undeclared artifacts.');
 for(const [name,value] of expected)identical(file(files,name),value,'Bundle artifact differs from canonical review.');
 exact(m,await manifest(reg,expected),'Bundle manifest identity differs.');identical(manifestRaw,json(m),'Bundle manifest encoding changed.');
 return {summary:{kind:m.kind,schemaVersion:1,registrationId:reg.registrationId,originJobId:reg.origin.jobId,originTicketId:reg.origin.ticketId,outputSha256:reg.output.sha256,status:'awaiting-user-review',acceptedByUser:false,newModelCalls:0,artifactCount:files.size},registration:reg,files,checked,manifest:m};
}

async function validateRetainedBundle(bytes:Uint8Array){return (await readRetainedBundle(bytes)).summary;}
return {validateRetainedOrigin,validateRetainedBundle,readRetainedBundle,registration,renderedFiles,manifest,parse,file,inventory,exact,identical,limited,json,registrationSchema,manifestSchema,digest,uuid};
}
