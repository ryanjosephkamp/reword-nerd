import {mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {loadImagePackage} from './package';
import {inspectPng} from './png';
import {capabilitySchema,capabilityBlock,HOST_DISCOVERY,type ImageCapability} from './capabilities';
import {directory,fail,hash,immutable,immutableOrSame,lock,readBounded,save,utf8} from './io';
import {renderImageReview} from './review';
export function validateResultBudget(results:readonly {byteLength:number;width:number;height:number}[]){
 const bytes=results.reduce((sum,r)=>sum+r.byteLength,0);const pixels=results.reduce((sum,r)=>sum+r.width*r.height,0);
 if(bytes>JOB_LIMITS.retainedResultBytes||pixels>JOB_LIMITS.retainedResultPixels)fail('RESULT_BUDGET','Retained results exceed the 32 MiB or 32 megapixel job budget. Start a fresh job; prior results remain unchanged.');
}
import {JOB_LIMITS,executionSchema,ticketSchema,receiptSchema,resultSchema,stateSchema,type Execution,type ImageTicket,type State} from './portable/jobContracts';
export {JOB_LIMITS,ticketSchema,receiptSchema,stateSchema,type Execution,type ImageTicket,type HostOutputReceipt} from './portable/jobContracts';
const json=(value:unknown)=>JSON.stringify(value,null,2)+'\n';
function parse<T>(schema:z.ZodType<T>,bytes:Uint8Array):T{try{return schema.parse(JSON.parse(utf8(bytes)));}catch{fail('INVALID_RECORD','Invalid or unsupported JSON record.');}}
async function load(root:string){
 await directory(root);for(const dir of ['tickets','results','inbox'])await directory(join(root,dir));
 const state=parse(stateSchema,await readBounded(join(root,'state.json'),JOB_LIMITS.stateBytes));
 const pkg=await loadImagePackage(await readBounded(join(root,'package.zip'),JOB_LIMITS.archiveBytes));
 const bound={packageSha256:pkg.packageSha256,pairKey:pkg.pairKey,referenceSha256:pkg.referenceSha256,promptSha256:pkg.promptSha256,configurationSha256:hash(JSON.stringify(pkg.configuration))};
 for(const [k,v] of Object.entries(bound))if(state[k as keyof State]!==v)fail('CUSTODY','Job package binding changed.');
 if(hash(await readBounded(join(root,'reference.png'),JOB_LIMITS.resultBytes))!==pkg.referenceSha256||hash(await readBounded(join(root,'prompt.txt'),256*1024))!==pkg.promptSha256)fail('CUSTODY','Prepared reference or prompt changed.');
 validateResultBudget(state.attempts.flatMap(a=>a.result?[a.result]:[]));
 let revision=1;const prior:string[]=[];const ids=new Set<string>();
 for(const [index,a] of state.attempts.entries()){
  const t=a.ticket;if(ids.has(t.ticketId)||t.attempt!==index+1||t.revision<revision||t.revision>revision+1||t.jobId!==state.jobId||!isDeepStrictEqual(t.execution,state.execution)||!isDeepStrictEqual(t.priorResultHashes,prior))fail('CUSTODY','Attempt chain changed.');ids.add(t.ticketId);revision=t.revision;
  for(const [k,v] of Object.entries(bound))if(t[k as keyof ImageTicket]!==v)fail('CUSTODY','Attempt package binding changed.');
  const disk=parse(ticketSchema,await readBounded(join(root,'tickets',`${t.ticketId}.json`),JOB_LIMITS.receiptBytes));if(!isDeepStrictEqual(disk,t))fail('CUSTODY','Ticket file changed.');
  if(hash(await readBounded(join(root,'tickets',`${t.ticketId}.prompt.txt`),256*1024))!==t.promptSha256)fail('CUSTODY','Ticket prompt changed.');
  if(a.result&&capabilityBlock(t.capability,t.execution.mode)!==null)fail('CUSTODY','Unsupported historical capability cannot have a result.');
  if(a.result){const raw=await readBounded(join(root,'results',`${t.ticketId}.png`),JOB_LIMITS.resultBytes);const info=inspectPng(raw);if(hash(raw)!==a.result.sha256||raw.byteLength!==a.result.byteLength||info.width!==a.result.width||info.height!==a.result.height||a.result.identicalToReference!==(a.result.sha256===t.referenceSha256))fail('CUSTODY','Recorded image changed.');
   const metadata=parse(resultSchema,await readBounded(join(root,'results',`${t.ticketId}.json`),JOB_LIMITS.receiptBytes));if(!isDeepStrictEqual(metadata,a.result))fail('CUSTODY','Result receipt changed.');
   if(a.result.receipt.ticketId!==t.ticketId||a.result.receipt.referenceSha256!==t.referenceSha256||a.result.receipt.promptSha256!==t.promptSha256||a.result.receipt.outputSha256!==a.result.sha256)fail('CUSTODY','Host output binding changed.');prior.push(a.result.sha256);
  }
  const current=t.ticketId===state.currentTicketId;
  if(!current&&a.status!=='superseded')fail('CUSTODY','Historical attempt was made current.');
  if((a.status==='recorded'&&!a.result)||(a.result&&a.status!=='recorded'&&a.status!=='superseded')||(current&&a.status==='superseded')||((a.status==='failed'||a.status==='unsupported')&&!a.reason)||((a.status==='pending'||a.status==='recorded')&&a.reason!==null))fail('CUSTODY','Invalid attempt outcome.');
  if(current&&capabilityBlock(t.capability,t.execution.mode)!==null&&a.status!=='unsupported')fail('CUSTODY','Unsupported capability cannot have a result.');
 }
 if(state.attempts.length?state.currentTicketId!==state.attempts.at(-1)!.ticket.ticketId||state.revision!==revision:state.currentTicketId!==null||state.revision!==1)fail('CUSTODY','Current attempt pointer changed.');
 return {state,pkg};
}
/** Offline structural inspection only; never registers, accepts or executes a job. */
export async function inspectResult(path:string){
 const bytes=await readBounded(resolve(path),JOB_LIMITS.resultBytes);
 const info=inspectPng(bytes);
 return {scope:'standalone-file-inspection',validation:'supported-png-structure',sha256:hash(bytes),byteLength:bytes.length,...info,metadataVerification:'Not performed. caBX contents remain opaque; no signature, authorship or provenance claim.',registeredToJob:false,acceptedByUser:false};
}
export async function inspectPackage(path:string){const p=await loadImagePackage(await readBounded(resolve(path),JOB_LIMITS.archiveBytes));return {supported:true,packageSha256:p.packageSha256,pairKey:p.pairKey,referenceSha256:p.referenceSha256,promptSha256:p.promptSha256,configuration:p.configuration,checksumMeaning:'Consistency only; not authorship or safety of requested content.'};}
export async function prepareJob(packagePath:string,jobPath:string,execution:Execution={mode:'host-assisted',host:'unknown',model:null}){
 const raw=await readBounded(resolve(packagePath),JOB_LIMITS.archiveBytes);const p=await loadImagePackage(raw);const exec=executionSchema.parse(execution);const root=resolve(jobPath);
 await mkdir(root,{mode:0o700});for(const dir of ['tickets','results','inbox'])await mkdir(join(root,dir),{mode:0o700});
 await immutable(join(root,'package.zip'),raw);await immutable(join(root,'reference.png'),p.referenceBytes);await immutable(join(root,'prompt.txt'),p.prompt);
 const state:State={schemaVersion:1,jobId:randomUUID(),packageSha256:p.packageSha256,pairKey:p.pairKey,referenceSha256:p.referenceSha256,promptSha256:p.promptSha256,configurationSha256:hash(JSON.stringify(p.configuration)),execution:exec,revision:1,attempts:[],currentTicketId:null};await save(root,state);
 return {jobPath:root,jobId:state.jobId,packageSha256:p.packageSha256,referencePath:join(root,'reference.png'),reviewRequired:true};
}
function task(root:string,a:State['attempts'][number]){return {status:a.status,reason:a.reason,ticket:a.ticket,ticketPath:join(root,'tickets',`${a.ticket.ticketId}.json`),promptPath:join(root,'tickets',`${a.ticket.ticketId}.prompt.txt`),referencePath:join(root,'reference.png'),resultExpected:'Exact unmodified PNG output file plus host-reported receipt. No automatic acceptance.',toolInvocation:a.status==='pending'&&a.ticket.execution.mode==='host-assisted'?{tool:'image_gen.imagegen',argumentsFrom:{promptPath:join(root,'tickets',`${a.ticket.ticketId}.prompt.txt`),referenced_image_paths:[join(root,'reference.png')]}}:null};}
export async function nextAttempt(jobPath:string,options:{retry?:boolean;revise?:boolean;capability?:ImageCapability}={}){const root=resolve(jobPath);return lock(root,async()=>{
 const {state}=await load(root);const current=state.attempts.at(-1);
 if(current&&!options.retry&&!options.revise)return task(root,current);
 if(state.attempts.length>=JOB_LIMITS.attempts)fail('ATTEMPT_LIMIT','Maximum 64 attempts reached.');
 const cap=capabilitySchema.parse(options.capability??HOST_DISCOVERY);const reason=capabilityBlock(cap,state.execution.mode);
 if(current)current.status='superseded';if(options.revise)state.revision++;
 if(state.revision>64)fail('REVISION_LIMIT','Maximum revisions reached.');
 const t:ImageTicket={schemaVersion:1,jobId:state.jobId,ticketId:randomUUID(),packageSha256:state.packageSha256,pairKey:state.pairKey,referenceSha256:state.referenceSha256,promptSha256:state.promptSha256,configurationSha256:state.configurationSha256,operation:'faithful-rendition',attempt:state.attempts.length+1,revision:state.revision,priorResultHashes:state.attempts.flatMap(a=>a.result?[a.result.sha256]:[]),execution:state.execution,capability:cap};
 await immutable(join(root,'tickets',`${t.ticketId}.json`),json(t));await immutable(join(root,'tickets',`${t.ticketId}.prompt.txt`),await readBounded(join(root,'prompt.txt'),256*1024));
 const a:State['attempts'][number]={ticket:t,status:reason?'unsupported':'pending',reason,result:null};state.attempts.push(a);state.currentTicketId=t.ticketId;await save(root,state);return task(root,a);
 });}
async function verifyTicket(root:string,state:State,path:string){const t=parse(ticketSchema,await readBounded(resolve(path),JOB_LIMITS.receiptBytes));const current=state.attempts.at(-1);if(t.jobId!==state.jobId)fail('WRONG_JOB','Ticket belongs to another job.');if(!current||t.ticketId!==state.currentTicketId||!isDeepStrictEqual(t,current.ticket))fail('STALE_TICKET','Ticket is not the exact current attempt.');return current;}
export async function recordResult(jobPath:string,ticketPath:string,resultPath:string,receiptPath:string){const root=resolve(jobPath);return lock(root,async()=>{
 const {state}=await load(root);const a=await verifyTicket(root,state,ticketPath);const raw=await readBounded(resolve(resultPath),JOB_LIMITS.resultBytes);const info=inspectPng(raw);const sha=hash(raw);const receipt=parse(receiptSchema,await readBounded(resolve(receiptPath),JOB_LIMITS.receiptBytes));
 if(receipt.ticketId!==a.ticket.ticketId||receipt.promptSha256!==a.ticket.promptSha256||receipt.referenceSha256!==a.ticket.referenceSha256||receipt.outputSha256!==sha)fail('WRONG_OUTPUT','Output receipt does not bind this ticket, reference, prompt and exact image.');
 if(a.ticket.execution.mode==='fixture'&&(receipt.executor!=='deterministic-fixture'||receipt.model!=='none'||receipt.tool!==null))fail('EXECUTION_LABEL','Fixture results must remain labeled as fixtures.');
 if(a.ticket.execution.mode==='host-assisted'&&receipt.tool!==a.ticket.capability.tool)fail('EXECUTION_LABEL','Host tool does not match the ticket capability declaration.');
 const record={sha256:sha,byteLength:raw.byteLength,mimeType:'image/png' as const,width:info.width,height:info.height,identicalToReference:sha===a.ticket.referenceSha256,receipt};
 if(a.result){if(isDeepStrictEqual(a.result,record))return {idempotent:true,result:a.result,reviewRequired:true};fail('CONFLICTING_OUTPUT','Attempt already has a different output or receipt.');}
 if(a.status!=='pending')fail('NOT_PENDING','This attempt is not executable.');
 validateResultBudget([...state.attempts.flatMap(attempt=>attempt.result?[attempt.result]:[]),record]);
 await immutableOrSame(join(root,'results',`${a.ticket.ticketId}.png`),raw);await immutableOrSame(join(root,'results',`${a.ticket.ticketId}.json`),json(record));a.result=record;a.status='recorded';await save(root,state);return {idempotent:false,result:record,reviewRequired:true};
 });}
export async function recordFailure(jobPath:string,ticketPath:string,reason:string){const root=resolve(jobPath);if(!reason.trim()||reason.length>2000)fail('ARGUMENT','Provide a bounded failure reason.');return lock(root,async()=>{const {state}=await load(root);const a=await verifyTicket(root,state,ticketPath);if(a.status==='failed'&&a.reason===reason)return {idempotent:true};if(a.status!=='pending')fail('NOT_PENDING','Only pending attempts can fail.');a.status='failed';a.reason=reason;await save(root,state);return {status:'failed',reason};});}
export async function getStatus(jobPath:string){const root=resolve(jobPath);return lock(root,async()=>{const {state,pkg}=await load(root);const current=state.attempts.at(-1);return {jobId:state.jobId,packageSha256:state.packageSha256,pairKey:state.pairKey,referenceSha256:state.referenceSha256,promptSha256:state.promptSha256,savedConfiguration:pkg.configuration,execution:state.execution,revision:state.revision,status:current?.status==='recorded'?'awaiting-user-review':current?.status??'prepared',reviewRequired:true,acceptedByUser:false,attempts:state.attempts};});}
export async function exportJob(jobPath:string,outPath:string){const root=resolve(jobPath);return lock(root,async()=>{const {state,pkg}=await load(root);const out=resolve(outPath);await mkdir(out,{mode:0o700});await mkdir(join(out,'raw'),{mode:0o700});
 await immutable(join(out,'package.zip'),await readBounded(join(root,'package.zip'),JOB_LIMITS.archiveBytes));await immutable(join(out,'reference.png'),pkg.referenceBytes);await immutable(join(out,'prompt.txt'),pkg.prompt);await immutable(join(out,'saved-configuration.json'),json(pkg.configuration));
 const attempts=[];for(const a of state.attempts){const id=a.ticket.ticketId;await immutable(join(out,'raw',`${id}.ticket.json`),json(a.ticket));await immutable(join(out,'raw',`${id}.prompt.txt`),await readBounded(join(root,'tickets',`${id}.prompt.txt`),256*1024));let resultBase64: string|undefined;if(a.result){const raw=await readBounded(join(root,'results',`${id}.png`),JOB_LIMITS.resultBytes);await immutable(join(out,'raw',`${id}.png`),raw);await immutable(join(out,'raw',`${id}.receipt.json`),json(a.result));resultBase64=raw.toString('base64');}
 attempts.push({attempt:a.ticket.attempt,revision:a.ticket.revision,ticketId:id,status:a.status,resultSha256:a.result?.sha256,resultBase64,width:a.result?.width,height:a.result?.height,reason:a.reason??undefined,executor:a.result?.receipt.executor,model:a.result?.receipt.model});}
 const info=inspectPng(pkg.referenceBytes);const review=renderImageReview({jobId:state.jobId,packageSha256:state.packageSha256,pairKey:state.pairKey,displayName:pkg.displayName,prompt:pkg.prompt,promptSha256:pkg.promptSha256,referenceSha256:pkg.referenceSha256,referenceBase64:Buffer.from(pkg.referenceBytes).toString('base64'),width:info.width,height:info.height,execution:state.execution,attempts,currentTicketId:state.currentTicketId});await immutable(join(out,'review.html'),review);await immutable(join(out,'audit.json'),json({state,savedConfiguration:pkg.configuration,reviewRequired:true,acceptedByUser:false,receiptMeaning:'Host metadata is reported, not independently authenticated. Hashes establish consistency, not authorship or semantic fidelity.'}));return {output:out,reviewPath:join(out,'review.html'),auditPath:join(out,'audit.json'),reviewRequired:true};});}
