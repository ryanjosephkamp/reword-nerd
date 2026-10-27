import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {deflateSync,deflateRawSync} from 'node:zlib';
import {expect,it} from 'vitest';
import JSZip from 'jszip';
import {browserReviewValidator,browserRuntime} from './portable/browser';
import {validateRetainedBundle,readRetainedBundle} from './retained';
import {createPackageValidator} from './portable/package';
import {nodeRuntime} from './nodeRuntime';
const fixture=()=>readFile(new URL('./testdata/retained-image-review-v1.zip',import.meta.url));
it('real retained host output: browser/Node exact contract and artifact parity',async()=>{
 const bytes=await fixture();expect(createHash('sha256').update(bytes).digest('hex')).toBe('480f52ff9dfca6e95f28b4795dcdfa9b8526e2196c66ab1728e3587d9bf1130d');
 const a=await browserReviewValidator.readRetainedBundle(bytes),b=await readRetainedBundle(bytes);
 expect(a).toEqual(b);expect(a.registration.registrationId).toBe('b3e80575-855e-454a-909f-a936d2580dcd');
 expect(await browserRuntime.hash(a.files.get('returned.png')!)).toBe('3a483154c86debc68790707d77ae6f669cd858e2ac611fd8d185b955a32ba55a');
 expect(a.checked.current.status).toBe('failed');expect(a.registration.acceptedByUser).toBe(false);
});
it.each([true,false])('bounded inflater parity, trailing bytes and corrupt streams raw=%s',raw=>{
 const input=Buffer.from('  Unicode: α 🚀 $&\n'.repeat(100));const compressed=(raw?deflateRawSync:deflateSync)(input);
 for(const bytes of [compressed,Buffer.concat([compressed,Buffer.from('tail')])]){
  const a=browserRuntime.inflate(bytes,input.length,raw),b=nodeRuntime.inflate(bytes,input.length,raw);expect(a.consumed).toBe(b.consumed);expect(a.buffer).toEqual(Uint8Array.from(b.buffer));
 }
 for(const runtime of [browserRuntime,nodeRuntime]){
  expect(()=>runtime.inflate(compressed,1,raw)).toThrow();expect(()=>runtime.inflate(compressed.subarray(0,compressed.length-3),input.length,raw)).toThrow();
 }
});
it('rejects tampered records and script-like HTML even with updated inventory identically',async()=>{
 const bytes=await fixture();
 for(const [path,value]of [['review.html','<script>globalThis.pwned=true</script>'],['prompt.txt','wrong'],['returned.png','not a png'],['registration.json','{}'],['origin/state.json','{}']]){
  const zip=await JSZip.loadAsync(bytes);zip.file(path,value,{createFolders:false});
  const m=JSON.parse(await zip.file('manifest.json')!.async('string'));const entry=m.artifacts.find((a:{path:string})=>a.path===path);entry.sha256=await browserRuntime.hash(value);entry.byteLength=new TextEncoder().encode(value).length;zip.file('manifest.json',JSON.stringify(m,null,2)+'\n');
  const bad=await zip.generateAsync({type:'uint8array',compression:'DEFLATE',platform:'UNIX'});
  const results=await Promise.allSettled([validateRetainedBundle(bad),browserReviewValidator.validateRetainedBundle(bad)]);expect(results.every(r=>r.status==='rejected')).toBe(true);
 }
});
it('archive adapter rejects unsafe/alias/oversize inputs without widening bounds',async()=>{
 const {readArchive:a}=createPackageValidator(browserRuntime),{readArchive:b}=createPackageValidator(nodeRuntime);
 for(const names of [['../x'],['x','X'],['a%2fb'],['/x']]){const zip=new JSZip();for(const n of names)zip.file(n,'x',{createFolders:false});const bytes=await zip.generateAsync({type:'uint8array'});expect(()=>a(bytes)).toThrow();expect(()=>b(bytes)).toThrow();}
 const huge=new Uint8Array(64*1024*1024+1);await expect(browserReviewValidator.validateRetainedBundle(huge)).rejects.toThrow('64 MiB');
});
