import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_IMAGE_PROMPT_SETTINGS } from '../src/image/contracts';
import { buildImagePromptPackage, type ImagePackageSnapshot } from '../src/image/export';
import { imagePromptProfile } from '../src/image/profiles';
import { loadImagePackage } from './package';
import { createImageFixture } from './fixtures';
import { FIXTURE_CAPABILITY } from './capabilities';
import { hash } from './io';
import { inspectPng } from './png';
import { exportJob, getStatus, inspectResult, nextAttempt, prepareJob, recordFailure, recordResult } from './runner';

const digest='3a483154c86debc68790707d77ae6f669cd858e2ac611fd8d185b955a32ba55a';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
const observed=()=>readFile(new URL('./testdata/host-smoke-cabx.png',import.meta.url));
describe('recorded caBX image as an offline regression vector',()=>{
 it('validates the exact historical output without stripping metadata or changing bytes',async()=>{
  const raw=await observed();expect(raw.length).toBe(927002);expect(hash(raw)).toBe(digest);
  expect(inspectPng(raw)).toEqual({width:1586,height:992,mimeType:'image/png'});
  expect(hash(raw)).toBe(digest);
  expect(raw.readUInt32BE(33)).toBe(21844);expect(raw.toString('ascii',37,41)).toBe('caBX');
 });
 it('exposes a read-only CLI inspection seam without acceptance or job registration',async()=>{
  expect(await inspectResult(resolve('image-companion/testdata/host-smoke-cabx.png'))).toMatchObject({scope:'standalone-file-inspection',validation:'supported-png-structure',sha256:digest,byteLength:927002,width:1586,height:992,registeredToJob:false,acceptedByUser:false});
 });
 it('round-trips a real canonical schema-1 export using the caBX image as reference',async()=>{
  const raw=await observed(),info=inspectPng(raw),profile=imagePromptProfile(DEFAULT_IMAGE_PROMPT_SETTINGS.modelFamily);
  const sourceBytes=new Blob([Uint8Array.from(raw).buffer],{type:'image/png'});
  const snapshot:ImagePackageSnapshot={sessionGeneration:1,reviewGeneration:1,confirmedReviewGeneration:1,items:[{
   occurrenceId:'offline-cabx-reference',incarnation:1,sourceBytes,byteCount:raw.length,sourceHash:digest,mimeType:'image/png',fileExtension:'png',
   dimensions:{width:info.width,height:info.height,megapixels:info.width*info.height/1_000_000},
   provenance:{intakeKind:'direct',sourceName:'host-smoke-cabx.png',sourcePath:null,containerChain:[],containerName:null,containerHash:null,containerPath:null,pageNumber:null,relationshipId:null},
   settings:{...DEFAULT_IMAGE_PROMPT_SETTINGS},ocr:{status:'off',detectedText:null,reviewedText:null,operationGeneration:0,reviewRevision:0},warnings:[],reviewRevision:1,
   expectedProfileVersion:profile.profileVersion,expectedProfileVerifiedAt:profile.lastVerifiedAt,
  }]};
  const built=await buildImagePromptPackage(snapshot,{hash:async blob=>hash(new Uint8Array(await blob.arrayBuffer())),decoder:{decode:async blob=>{
   const supplied=new Uint8Array(await blob.arrayBuffer());expect(hash(supplied)).toBe(digest);const dimensions=inspectPng(supplied);return{width:dimensions.width,height:dimensions.height,close:()=>undefined};
  }}});
  expect(built.ok).toBe(true);if(!built.ok)throw Error(built.error.code);
  const bytes=new Uint8Array(await built.output.packageBytes.arrayBuffer()),loaded=await loadImagePackage(bytes);
  expect(loaded.packageSha256).toBe(hash(bytes));expect(loaded.referenceSha256).toBe(digest);expect(Buffer.from(loaded.referenceBytes)).toEqual(raw);
 });
 it('replays retained bytes offline through record, reload and standalone export with exact custody',async()=>{
  const base=resolve('output/studio/image-metadata-tests');await mkdir(base,{recursive:true});
  const root=await mkdtemp(join(base,'replay-'));roots.push(root);
  const fixture=await createImageFixture(),raw=await observed();
  const pkg=join(root,'selected.zip'),job=join(root,'job'),image=join(root,'returned.png'),receipt=join(root,'receipt.json');
  await writeFile(pkg,fixture.packageBytes);await writeFile(image,raw);
  // This is only a deterministic replay test. It does not represent a new host call.
  await prepareJob(pkg,job,{mode:'fixture',host:'deterministic-fixture',model:'none'});
  const first=await nextAttempt(job,{capability:FIXTURE_CAPABILITY});
  await recordFailure(job,first.ticketPath,'Synthetic test of a preserved prior validation failure.');
  const oldTicket=await readFile(first.ticketPath);
  const next=await nextAttempt(job,{revise:true,capability:FIXTURE_CAPABILITY});
  await writeFile(receipt,JSON.stringify({schemaVersion:1,ticketId:next.ticket.ticketId,referenceSha256:next.ticket.referenceSha256,promptSha256:next.ticket.promptSha256,outputSha256:digest,executor:'deterministic-fixture',model:'none',tool:null}));
  await expect(recordResult(job,first.ticketPath,image,receipt)).rejects.toMatchObject({code:'STALE_TICKET'});
  expect(await recordResult(job,next.ticketPath,image,receipt)).toMatchObject({idempotent:false,reviewRequired:true,result:{sha256:digest}});
  expect(await recordResult(job,next.ticketPath,image,receipt)).toMatchObject({idempotent:true});
  expect(await readFile(first.ticketPath)).toEqual(oldTicket);
  const state=await getStatus(job);expect(state).toMatchObject({acceptedByUser:false,status:'awaiting-user-review',revision:2});
  expect(state.attempts[0]).toMatchObject({status:'superseded',reason:'Synthetic test of a preserved prior validation failure.',result:null});
  const out=join(root,'review');await exportJob(job,out);
  expect(await readFile(join(out,'raw',next.ticket.ticketId+'.png'))).toEqual(raw);
  expect(new Uint8Array(await readFile(join(out,'package.zip')))).toEqual(fixture.packageBytes);
  const html=await readFile(join(out,'review.html'),'utf8');
  expect(html).toContain('data:image/png;base64,'+raw.toString('base64'));
  expect(html).toContain('Fixture demonstration');
  expect(html).not.toContain('data:image/svg+xml');
 });
});
