import type {ImportedReview} from '../../../../image-companion/portable/browser';
export type {ImportedReview};
export const IMPORT_LIMITS={count:3,bytes:96*1024*1024,fileBytes:64*1024*1024} as const;
export interface ReviewEntry {review:ImportedReview;bundle:Uint8Array;bundleHash:string;name:string;retainedBytes:number}
export function addReview(current:readonly ReviewEntry[],entry:ReviewEntry):{entries:readonly ReviewEntry[];duplicate:boolean}{
 const same=current.find(r=>r.review.registration.registrationId===entry.review.registration.registrationId);
 if(same){if(same.bundleHash!==entry.bundleHash)throw new Error('This registration is already imported with different bundle bytes. Remove it explicitly before inspecting a different bundle.');return {entries:current,duplicate:true};}
 if(current.length>=IMPORT_LIMITS.count||current.reduce((n,r)=>n+r.retainedBytes,entry.retainedBytes)>IMPORT_LIMITS.bytes)throw new Error('Import collection limit: three reviews and 96 MiB total retained artifacts and ZIP bytes. Remove a review explicitly to make room.');
 return {entries:[...current,entry],duplicate:false};
}
/** A disposable worker contains bounded inflation and canonical reconstruction.
 * It cannot read CLI paths. Imported HTML is compared as bytes, never opened. */
export async function importReview(file:File,signal:AbortSignal):Promise<ReviewEntry>{
 if(file.size>IMPORT_LIMITS.fileBytes)throw new Error('Review ZIP exceeds 64 MiB.');
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(signal.aborted)throw new Error('Import cancelled.');
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 const bundleHash=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
 const review=await new Promise<ImportedReview>((resolve,reject)=>{
  const worker=new Worker(new URL('./validate.worker.ts',import.meta.url),{type:'module'});
  const finish=(error?:Error,value?:ImportedReview)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);worker.terminate();if(error)reject(error);else resolve(value!);};
  const abort=()=>finish(new Error('Import cancelled.'));
  const timer=setTimeout(()=>finish(new Error('Validation exceeded the 60-second browser limit. No review was imported.')),60000);
  signal.addEventListener('abort',abort,{once:true});
  worker.onerror=()=>finish(new Error('Review validator could not run. No review was imported.'));
  worker.onmessage=(e:MessageEvent<{ok:boolean;review:ImportedReview;error:string}>)=>e.data.ok?finish(undefined,e.data.review):finish(new Error(e.data.error));
  if(signal.aborted)abort();else worker.postMessage(bytes.buffer.slice(0));
 });
 const retainedBytes=bytes.length+[...review.files.values()].reduce((n,b)=>n+b.length,0);
 return {review,bundle:bytes,bundleHash,name:file.name,retainedBytes};
}
