import { constants } from 'node:fs';
import { lstat, open, writeFile, mkdir, rename, unlink, rmdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import {fail} from './portable/runtime';
export {ImageJobError,fail} from './portable/runtime';
export const hash=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
export const utf8=(bytes:Uint8Array)=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
export async function readBounded(path:string,limit:number):Promise<Buffer>{
 const before=await lstat(path);if(!before.isFile()||before.isSymbolicLink()||before.size>limit)fail('FILE_LIMIT',`${basename(path)} must be a regular file within ${limit} bytes.`);
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const stat=await fd.stat();if(!stat.isFile()||stat.size>limit)fail('FILE_LIMIT','Invalid file type or size.');const bytes=Buffer.alloc(Math.min(limit+1,stat.size+1));let count=0;while(count<bytes.length){const read=await fd.read(bytes,count,bytes.length-count,null);if(!read.bytesRead)break;count+=read.bytesRead;}if(count>stat.size||count>limit)fail('FILE_CHANGED','File grew while reading.');return bytes.subarray(0,count);}finally{await fd.close();}
}
export async function directory(path:string){const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink())fail('UNSAFE_PATH','Job directories cannot be symbolic links.');}
export async function immutable(path:string,data:Uint8Array|string){await writeFile(path,data,{flag:'wx',mode:0o600});}
export async function save(root:string,state:unknown){const tmp=join(root,`.state-${randomUUID()}.tmp`);await immutable(tmp,JSON.stringify(state,null,2)+'\n');await rename(tmp,join(root,'state.json'));}
export async function lock<T>(root:string,work:()=>Promise<T>):Promise<T>{
 await directory(root);const path=join(root,'.lock');
 try{await mkdir(path,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const recovery=join(root,'.lock-recovery');try{await mkdir(recovery,{mode:0o700});}catch{fail('JOB_BUSY','Recovery guard exists; inspect interrupted recovery.');}
 try{await directory(path);let owner:{pid:number};try{owner=JSON.parse(utf8(await readBounded(join(path,'owner.json'),1024)));}catch{fail('JOB_BUSY','Cannot verify lock owner.');}if(!Number.isSafeInteger(owner.pid)||owner.pid<1)fail('JOB_BUSY','Invalid lock owner.');try{process.kill(owner.pid,0);fail('JOB_BUSY','Another command owns this job.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}await unlink(join(path,'owner.json'));await rmdir(path);await mkdir(path,{mode:0o700});}finally{await rmdir(recovery);}}
 const token=randomUUID();await immutable(join(path,'owner.json'),JSON.stringify({pid:process.pid,token}));
 try{return await work();}finally{const owner=JSON.parse(utf8(await readBounded(join(path,'owner.json'),1024)));if(owner.token===token){await unlink(join(path,'owner.json'));await rmdir(path);}}
}

export async function immutableOrSame(path:string,data:Uint8Array|string){try{await immutable(path,data);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;const bytes=typeof data==='string'?Buffer.from(data):Buffer.from(data);const existing=await readBounded(path,bytes.byteLength);if(!existing.equals(bytes))fail('RECOVERY_CONFLICT','Retained partial artifact differs; retry with a fresh attempt.');}}
