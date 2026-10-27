import {nodeRuntime} from './nodeRuntime';
import {createRetainedValidator,RETAINED_LIMITS} from './portable/retained';
export {RETAINED_LIMITS,type RetainedRegistration,type RetainedReviewManifest} from './portable/retained';
export const {validateRetainedOrigin,validateRetainedBundle,readRetainedBundle}=createRetainedValidator(nodeRuntime);
const {registration,renderedFiles,manifest,parse,file,exact,identical,json,registrationSchema,digest,uuid}=createRetainedValidator(nodeRuntime);
type Files=Map<string,Uint8Array>;
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, link, unlink } from 'node:fs/promises';
import { dirname, join, parse as parsePath, relative, resolve, sep } from 'node:path';
import JSZip from 'jszip';
import {stateSchema,JOB_LIMITS} from './portable/jobContracts';
import { directory, fail, hash, immutable, lock, readBounded } from './io';

/** Reject symbolic links in every existing path component, not only the selected leaf. */
async function safePath(input:string,allowMissingLeaf=false){
 if(input.split(/[\\/]/).includes('..'))fail('UNSAFE_PATH','Parent traversal is not allowed.');
 const full=resolve(input);let current=parsePath(full).root;const parts=full.slice(current.length).split(sep);
 for(const [i,part] of parts.entries()){
  current=join(current,part);
  try{const stat=await lstat(current);if(stat.isSymbolicLink())fail('UNSAFE_PATH','Symbolic links are not allowed in selected paths.');if(i<parts.length-1&&!stat.isDirectory())fail('UNSAFE_PATH','Non-directory path component.');}
  catch(error){if(allowMissingLeaf&&i===parts.length-1&&(error as NodeJS.ErrnoException).code==='ENOENT')return full;throw error;}
 }
 return full;
}

export interface RetainedSelection{origin:string;ticket:string;result:string;receipt:string;expectedSha256:string}
export async function readRetainedSelection(selection:RetainedSelection){
 if(!digest.safeParse(selection.expectedSha256).success||!uuid.safeParse(selection.ticket).success)fail('ARGUMENT','An exact ticket UUID and expected output SHA-256 are required.');
 const origin=await safePath(selection.origin);await directory(origin);await safePath(join(origin,'tickets'));await directory(join(origin,'tickets'));
 const files:Files=new Map();
 const stateRaw=await readBounded(join(origin,'state.json'),JOB_LIMITS.stateBytes);const state=parse(stateSchema,stateRaw);
 if(state.attempts.length>RETAINED_LIMITS.history||state.attempts.some(a=>a.result!==null))fail('UNSUPPORTED_HISTORY','At most eight origin attempts without registered results are supported.');
 files.set('origin/state.json',stateRaw);
 for(const [name,max] of [['package.zip',JOB_LIMITS.archiveBytes],['reference.png',JOB_LIMITS.resultBytes],['prompt.txt',64*1024]] as const)files.set(name==='package.zip'?'source-package.zip':name,await readBounded(join(origin,name),max));
 for(const a of state.attempts){for(const [suffix,max] of [['.json',JOB_LIMITS.receiptBytes],['.prompt.txt',64*1024]] as const){const path=`tickets/${a.ticket.ticketId}${suffix}`;files.set('origin/'+path,await readBounded(join(origin,path),max));}}
 files.set('returned.png',await readBounded(await safePath(selection.result),JOB_LIMITS.resultBytes));
 files.set('host-output-receipt.json',await readBounded(await safePath(selection.receipt),JOB_LIMITS.receiptBytes));
 if(hash(file(files,'returned.png'))!==selection.expectedSha256)fail('WRONG_OUTPUT','Selected output does not match its expected SHA-256.');
 if([...files.values()].reduce((n,b)=>n+b.length,0)>RETAINED_LIMITS.originBytes)fail('ORIGIN_LIMIT','Origin evidence exceeds 40 MiB.');
 const checked=await validateRetainedOrigin(files,selection.ticket);
 // Re-read precisely the selected files to detect concurrent origin changes.
 for(const [name,bytes] of files){let path:string;if(name==='returned.png')path=selection.result;else if(name==='host-output-receipt.json')path=selection.receipt;else path=join(origin,name==='source-package.zip'?'package.zip':name.replace(/^origin\//,''));identical(await readBounded(await safePath(path),bytes.length),bytes,'Selected origin changed during registration.');}
 return {files,checked};
}
/** Atomic complete-file publication; interrupted temp files are never interpreted. */
async function atomicSame(path:string,bytes:Uint8Array){
 try{identical(await readBounded(path,bytes.length),bytes,'Existing registration artifact conflicts.');return;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const temp=join(dirname(path),`.retained-${randomUUID()}.tmp`);await immutable(temp,bytes);
 try{try{await link(temp,path);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;identical(await readBounded(path,bytes.length),bytes,'Concurrent registration artifact conflicts.');}}finally{await unlink(temp);}
}
async function makeDirectories(root:string){for(const name of ['origin','origin/tickets']){try{await mkdir(join(root,name),{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}await directory(join(root,name));}}
async function checkDirectoryInventory(root:string,allowed:Set<string>){
 for(const sub of ['', 'origin','origin/tickets']){for(const entry of await readdir(join(root,sub),{withFileTypes:true})){const path=sub?sub+'/'+entry.name:entry.name;if(entry.isSymbolicLink())fail('UNSAFE_PATH','Registration contains a symbolic link.');if(entry.isDirectory()&&['origin','origin/tickets','.lock'].includes(path))continue;if(entry.isFile()&&(/^\.retained-[a-f0-9-]{36}\.tmp$/.test(entry.name)||allowed.has(path)))continue;fail('UNEXPECTED_ARTIFACT',`Unrecognized destination artifact: ${path}`);}}
}
export async function registerRetained(selection:RetainedSelection,destination:string){
 const {files,checked}=await readRetainedSelection(selection); // No destination is created until validation passes.
 const root=await safePath(destination,true),origin=resolve(selection.origin);
 if(root===origin||relative(origin,root).split(sep)[0]!=='..')fail('UNSAFE_PATH','Destination must be outside the origin job.');
 let fresh=false;try{await mkdir(root,{mode:0o700});fresh=true;}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;await directory(root);}
 if(fresh)await atomicSame(join(root,'registration.json'),json(registration(checked,randomUUID())));
 // Missing ownership record fails closed; never claim another existing directory.
 const owned=parse(registrationSchema,await readBounded(join(root,'registration.json'),RETAINED_LIMITS.manifestBytes));
 exact(owned,registration(checked,owned.registrationId,owned.createdAt),'Existing registration belongs to different input evidence.');
 return lock(root,async()=>{
  await makeDirectories(root);await checkDirectoryInventory(root,new Set([...files.keys(),'registration.json','complete.json']));
  let completed=false;try{completed=Boolean(await readBounded(join(root,'complete.json'),1024));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  for(const [name,bytes] of files)await atomicSame(join(root,name),bytes);
  await atomicSame(join(root,'complete.json'),json({schemaVersion:1,registrationSha256:hash(json(owned)),inputFingerprint:owned.inputFingerprint}));
  await readRegistration(root);
  return {registrationPath:root,registrationId:owned.registrationId,idempotent:completed,status:owned.status,acceptedByUser:false,newModelCalls:0};
 });
}
export async function readRegistration(path:string){
 const root=await safePath(path);await directory(root);await directory(join(root,'origin'));await directory(join(root,'origin/tickets'));
 const raw=await readBounded(join(root,'registration.json'),RETAINED_LIMITS.manifestBytes),reg=parse(registrationSchema,raw);
 if(reg.artifacts.reduce((n,a)=>n+a.byteLength,0)>RETAINED_LIMITS.originBytes)fail('ORIGIN_LIMIT','Origin inventory exceeds 40 MiB.');
 const files:Files=new Map();
 // Paths must match a strict finite family before any filesystem read.
 const seen=new Set<string>();for(const a of reg.artifacts){if(!/^(source-package\.zip|reference\.png|prompt\.txt|returned\.png|host-output-receipt\.json|origin\/state\.json|origin\/tickets\/[a-f0-9-]{36}\.(json|prompt\.txt))$/.test(a.path)||seen.has(a.path))fail('UNSAFE_PATH','Invalid or duplicate registration path.');seen.add(a.path);files.set(a.path,await readBounded(join(root,a.path),Math.min(a.byteLength,RETAINED_LIMITS.entryBytes)));}
 const checked=await validateRetainedOrigin(files,reg.origin.ticketId);exact(reg,registration(checked,reg.registrationId,reg.createdAt),'Registration does not match retained evidence.');
 identical(raw,json(reg),'Registration encoding changed.');
 identical(await readBounded(join(root,'complete.json'),1024),json({schemaVersion:1,registrationSha256:hash(raw),inputFingerprint:reg.inputFingerprint}),'Registration is incomplete or its completion record changed.');
 await checkDirectoryInventory(root,new Set([...files.keys(),'registration.json','complete.json']));
 return {registration:reg,files,checked};
}
export async function inspectRetainedBundle(path:string){return validateRetainedBundle(await readBounded(await safePath(path),RETAINED_LIMITS.archiveBytes));}
export async function exportRetained(path:string,destination:string){
 const {registration:reg,files,checked}=await readRegistration(path);const artifacts=renderedFiles(reg,files,checked);const m=await manifest(reg,artifacts);artifacts.set('manifest.json',json(m));
 const zip=new JSZip();for(const [name,value] of artifacts)zip.file(name,value,{createFolders:false,date:new Date('1980-01-01T00:00:00Z')});const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE',platform:'UNIX',compressionOptions:{level:6}});await validateRetainedBundle(bytes);
 const out=await safePath(destination,true);await mkdir(out,{mode:0o700});await makeDirectories(out);
 for(const [name,value] of artifacts)await atomicSame(join(out,name),value);await atomicSame(join(out,'retained-image-review.zip'),bytes);
 return {output:out,reviewPath:join(out,'review.html'),bundlePath:join(out,'retained-image-review.zip'),bundleSha256:hash(bytes),registrationId:reg.registrationId,status:'awaiting-user-review',acceptedByUser:false,newModelCalls:0};
}
