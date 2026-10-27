import { mkdir,mkdtemp,readFile,writeFile,rm,readdir,symlink,lstat } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { afterEach,describe,expect,it } from 'vitest';
import JSZip from 'jszip';
import { crc32,deflateRawSync } from 'node:zlib';
import { exportRetained,readRegistration,registerRetained,validateRetainedBundle,validateRetainedOrigin,RETAINED_LIMITS,type RetainedSelection } from './retained';
import { hash } from './io';

const ticket='ca7603bb-f270-45f1-9c24-ee99582f29fc',digest='3a483154c86debc68790707d77ae6f669cd858e2ac611fd8d185b955a32ba55a';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function evidence(){const data=JSON.parse(await readFile(new URL('./testdata/retained-origin.json',import.meta.url),'utf8')) as Record<string,string>;const files=new Map(Object.entries(data).map(([name,b64])=>[name,Buffer.from(b64,'base64')]));files.set('returned.png',await readFile(new URL('./testdata/host-smoke-cabx.png',import.meta.url)));return files;}
async function setup(){const base=resolve('output/studio/retained-tests');await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,'case-'));roots.push(root);const origin=join(root,'origin');await mkdir(join(origin,'tickets'),{recursive:true});await mkdir(join(origin,'inbox'));const files=await evidence();for(const[name,bytes]of files){const path=name==='source-package.zip'?'package.zip':name==='returned.png'?'inbox/raw-return.png':name==='host-output-receipt.json'?'inbox/receipt.json':name.replace(/^origin\//,'');await writeFile(join(origin,path),bytes);}const selection:RetainedSelection={origin,ticket,result:join(origin,'inbox/raw-return.png'),receipt:join(origin,'inbox/receipt.json'),expectedSha256:digest};return{root,origin,files,selection,dest:join(root,'registration')};}
function changeJson(files:Map<string,Buffer>,path:string,change:(value:ReturnType<typeof JSON.parse>)=>void){const value=JSON.parse(files.get(path)!.toString());change(value);files.set(path,Buffer.from(JSON.stringify(value)));}
async function makeBundle(){const h=await setup();await registerRetained(h.selection,h.dest);const exported=await exportRetained(h.dest,join(h.root,'export'));return{...h,exported,bytes:await readFile(exported.bundlePath)};}
async function mutateBundle(bytes:Uint8Array,change:(zip:JSZip)=>Promise<void>,rehash=false){const zip=await JSZip.loadAsync(bytes);await change(zip);if(rehash){const manifest=JSON.parse(await zip.file('manifest.json')!.async('string'));for(const a of manifest.artifacts){const value=await zip.file(a.path)!.async('uint8array');a.sha256=hash(value);a.byteLength=value.length;}zip.file('manifest.json',JSON.stringify(manifest,null,2)+'\n',{createFolders:false});}return zip.generateAsync({type:'uint8array',compression:'DEFLATE',platform:'UNIX'});}
// A raw ZIP encoder permits adversarial duplicate names / false expanded sizes.
function rawZip(entries:{name:string;data:Buffer;declaredSize?:number}[]){const locals:Buffer[]=[],centrals:Buffer[]=[];let offset=0;for(const e of entries){const name=Buffer.from(e.name),data=deflateRawSync(e.data),local=Buffer.alloc(30),central=Buffer.alloc(46),crc=crc32(e.data);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(e.declaredSize??e.data.length,22);local.writeUInt16LE(name.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(e.declaredSize??e.data.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);locals.push(local,name,data);centrals.push(central,name);offset+=local.length+name.length+data.length;}const directory=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,directory,end]);}

describe('offline retained-host-output registration',()=>{
 it('keeps origin files read-only and receipt ticket unchanged; creates a separate action without capability flags',async()=>{
  const h=await setup();const before=await readFile(join(h.origin,'state.json'));await writeFile(join(h.origin,'DO-NOT-COPY.txt'),'unselected');const r=await registerRetained(h.selection,h.dest);expect(r).toMatchObject({idempotent:false,newModelCalls:0,acceptedByUser:false,status:'awaiting-user-review'});
  expect(await readFile(join(h.origin,'state.json'))).toEqual(before);expect(await readdir(h.origin)).not.toContain('.lock');expect(await readdir(h.dest)).not.toContain('DO-NOT-COPY.txt');
  const loaded=await readRegistration(h.dest);expect(loaded.registration.origin.status).toBe('failed');expect(loaded.registration.registrationId).not.toBe(ticket);expect(loaded.registration).not.toHaveProperty('capability');expect(loaded.registration.originalExecutor).toEqual({executor:'Codex desktop',model:null,tool:'image_gen.imagegen'});expect(loaded.registration.localAction.newModelCalls).toBe(0);expect(Buffer.from(loaded.files.get('host-output-receipt.json')!)).toEqual(h.files.get('host-output-receipt.json'));expect(JSON.parse(Buffer.from(loaded.files.get('host-output-receipt.json')!).toString()).ticketId).toBe(ticket);
  expect(await registerRetained(h.selection,h.dest)).toMatchObject({idempotent:true,registrationId:r.registrationId});
 });
 it.each(['source','state-reference','state-prompt','ticket','ticket-prompt','receipt-ticket','receipt-reference','receipt-prompt','receipt-output','output','history'])('rejects wrong %s binding before creating a destination',async kind=>{
  const h=await setup();if(kind==='source')await writeFile(join(h.origin,'package.zip'),'not a ZIP');
  if(kind==='state-reference'||kind==='state-prompt'){const p=join(h.origin,'state.json'),s=JSON.parse(await readFile(p,'utf8'));s[kind==='state-reference'?'referenceSha256':'promptSha256']='0'.repeat(64);await writeFile(p,JSON.stringify(s));}
  if(kind==='ticket')await writeFile(join(h.origin,`tickets/${ticket}.json`),'{}');
  if(kind==='ticket-prompt')await writeFile(join(h.origin,`tickets/${ticket}.prompt.txt`),'changed');
  if(kind.startsWith('receipt-')){const s=JSON.parse(await readFile(h.selection.receipt,'utf8'));s[{'receipt-ticket':'ticketId','receipt-reference':'referenceSha256','receipt-prompt':'promptSha256','receipt-output':'outputSha256'}[kind]!]=kind==='receipt-ticket'?'00000000-0000-4000-8000-000000000000':'0'.repeat(64);await writeFile(h.selection.receipt,JSON.stringify(s));}
  if(kind==='output')await writeFile(h.selection.result,'not an image');
  if(kind==='history'){const p=join(h.origin,'state.json'),s=JSON.parse(await readFile(p,'utf8'));s.currentTicketId='00000000-0000-4000-8000-000000000000';await writeFile(p,JSON.stringify(s));}
  await expect(registerRetained(h.selection,h.dest)).rejects.toThrow();await expect(lstat(h.dest)).rejects.toMatchObject({code:'ENOENT'});
 });
 it('rejects symlink leaves and parent aliases, traversal and origin-contained destinations',async()=>{
  const h=await setup(),alias=join(h.root,'alias');await symlink(h.origin,alias);await expect(registerRetained({...h.selection,origin:alias},h.dest)).rejects.toThrow(/links/);
  const leaf=join(h.root,'image-link.png');await symlink(h.selection.result,leaf);await expect(registerRetained({...h.selection,result:leaf},h.dest)).rejects.toThrow(/links/);
  await expect(registerRetained({...h.selection,result:h.origin+'/inbox/../inbox/raw-return.png'},h.dest)).rejects.toThrow(/traversal/);
  await expect(registerRetained(h.selection,join(h.origin,'new'))).rejects.toThrow(/outside/);
 });
 it('resumes interrupted artifact publication with the original registration ID',async()=>{
  const h=await setup();const first=await registerRetained(h.selection,h.dest);await rm(join(h.dest,'complete.json'));await rm(join(h.dest,'returned.png'));await writeFile(join(h.dest,'.retained-00000000-0000-4000-8000-000000000000.tmp'),'partial orphan');
  await expect(readRegistration(h.dest)).rejects.toThrow();const again=await registerRetained(h.selection,h.dest);expect(again).toMatchObject({registrationId:first.registrationId,idempotent:false});expect((await readRegistration(h.dest)).registration.output.sha256).toBe(digest);
 });
 it('refuses conflicting retained artifacts or different origin evidence without overwriting',async()=>{
  const h=await setup();await registerRetained(h.selection,h.dest);await writeFile(join(h.dest,'returned.png'),'conflict');await expect(registerRetained(h.selection,h.dest)).rejects.toThrow(/conflict/i);expect(await readFile(join(h.dest,'returned.png'),'utf8')).toBe('conflict');
  const original=await readFile(h.selection.receipt,'utf8');await writeFile(h.selection.receipt,original+' ');await expect(registerRetained(h.selection,h.dest)).rejects.toThrow(/different input/);
 });
 it('does not claim an occupied unrelated directory or accept an altered completion record',async()=>{
  const h=await setup();await mkdir(h.dest);await writeFile(join(h.dest,'personal.txt'),'leave');await expect(registerRetained(h.selection,h.dest)).rejects.toThrow();expect(await readFile(join(h.dest,'personal.txt'),'utf8')).toBe('leave');const owned=join(h.root,'owned');await registerRetained(h.selection,owned);await writeFile(join(owned,'complete.json'),'{}');await expect(readRegistration(owned)).rejects.toThrow(/completion/);
 });
 it('preserves a coherent multi-attempt failure history as exact evidence',async()=>{
  const files=await evidence();const state=JSON.parse(files.get('origin/state.json')!.toString()),previous=structuredClone(state.attempts[0]);
  previous.ticket.ticketId='00000000-0000-4000-8000-000000000001';previous.status='superseded';previous.reason='Earlier synthetic history failure.';
  state.attempts[0].ticket.attempt=2;state.attempts[0].ticket.revision=2;state.revision=2;
  state.attempts.unshift(previous);files.set('origin/state.json',Buffer.from(JSON.stringify(state)));
  files.set(`origin/tickets/${previous.ticket.ticketId}.json`,Buffer.from(JSON.stringify(previous.ticket)));
  files.set(`origin/tickets/${previous.ticket.ticketId}.prompt.txt`,files.get('prompt.txt')!);
  files.set(`origin/tickets/${ticket}.json`,Buffer.from(JSON.stringify(state.attempts[1].ticket)));
  const validated=await validateRetainedOrigin(files,ticket);expect(validated.state.attempts).toHaveLength(2);expect(validated.state.attempts[0].reason).toBe('Earlier synthetic history failure.');expect(validated.origin.attempt).toBe(2);expect(validated.artifacts.find(a=>a.path==='origin/state.json')!.sha256).toBe(hash(files.get('origin/state.json')!));
 });
 it('enforces bounded, unregistered origin history and preserves extra failed history',async()=>{
  const files=await evidence();changeJson(files,'origin/state.json',s=>{s.attempts[0].result={};});await expect(validateRetainedOrigin(files,ticket)).rejects.toThrow();
  const f=await evidence();changeJson(f,'origin/state.json',s=>{s.attempts=Array.from({length:9},()=>s.attempts[0]);});await expect(validateRetainedOrigin(f,ticket)).rejects.toThrow(/eight/);
 });
});

describe('portable retained review bundle',()=>{
 it('validates real retained bytes, preserved raw origin records and canonical standalone HTML',async()=>{
  const h=await makeBundle();expect(await validateRetainedBundle(h.bytes)).toMatchObject({kind:'reword-nerd-retained-image-review-bundle',originTicketId:ticket,outputSha256:digest,newModelCalls:0,acceptedByUser:false});const z=await JSZip.loadAsync(h.bytes);expect(await z.file('returned.png')!.async('nodebuffer')).toEqual(h.files.get('returned.png'));expect(await z.file('origin/state.json')!.async('nodebuffer')).toEqual(h.files.get('origin/state.json'));const html=await z.file('review.html')!.async('string');expect(html).toContain('Offline retained-output registration');expect(html).toContain('original host attempt remains failed');expect(html).not.toContain('Fixture demonstration');
 });
 it.each(['output','manifest-identity','registration-origin','html-rehashed','receipt','duplicate-inventory','extra'])('rejects %s bundle tampering',async kind=>{
  const h=await makeBundle();const changed=await mutateBundle(h.bytes,async z=>{
   if(kind==='output')z.file('returned.png','bad');
   if(kind==='manifest-identity'||kind==='duplicate-inventory'){const m=JSON.parse(await z.file('manifest.json')!.async('string'));if(kind==='manifest-identity')m.originTicketId='00000000-0000-4000-8000-000000000000';else m.artifacts.push(m.artifacts[0]);z.file('manifest.json',JSON.stringify(m,null,2)+'\n');}
   if(kind==='registration-origin'){const r=JSON.parse(await z.file('registration.json')!.async('string'));r.origin.ticketId='00000000-0000-4000-8000-000000000000';z.file('registration.json',JSON.stringify(r,null,2)+'\n');}
   if(kind==='html-rehashed')z.file('review.html','<script>globalThis.bundlePwned=true</script>');
   if(kind==='receipt')z.file('host-output-receipt.json','{}');
   if(kind==='extra')z.file('unexpected.txt','unlisted',{createFolders:false});
  },kind==='html-rehashed'||kind==='registration-origin');await expect(validateRetainedBundle(changed)).rejects.toThrow();expect('bundlePwned' in globalThis).toBe(false);
 });
 it('rejects duplicate/alias/traversal names and declared expansion before inflation',async()=>{
  for(const names of [['manifest.json','manifest.json'],['manifest.json','MANIFEST.json'],['../manifest.json'],['a/../manifest.json'],['a%2fmanifest.json']])await expect(validateRetainedBundle(rawZip(names.map(name=>({name,data:Buffer.from('{}')}))))).rejects.toThrow(/duplicate|aliased|unsafe/);
  await expect(validateRetainedBundle(rawZip([{name:'a',data:Buffer.alloc(0),declaredSize:RETAINED_LIMITS.entryBytes+1}]))).rejects.toThrow(/entry/);
  await expect(validateRetainedBundle(rawZip(Array.from({length:3},(_,i)=>({name:`file${i}`,data:Buffer.alloc(0),declaredSize:RETAINED_LIMITS.entryBytes}))))).rejects.toThrow(/expanded/);
 });
 it('rejects byte/count bounds, corrupt compression and trailing data',async()=>{
  await expect(validateRetainedBundle(new Uint8Array(RETAINED_LIMITS.archiveBytes+1))).rejects.toThrow(/64 MiB/);
  await expect(validateRetainedBundle(rawZip(Array.from({length:33},(_,i)=>({name:`file${i}`,data:Buffer.alloc(0)}))))).rejects.toThrow(/count/);
  const h=await makeBundle();await expect(validateRetainedBundle(Buffer.concat([h.bytes,Buffer.from('trailing')]))).rejects.toThrow(/trailing/);
  const raw=rawZip([{name:'a',data:Buffer.alloc(1000),declaredSize:1}]);await expect(validateRetainedBundle(raw)).rejects.toThrow(/corrupt|expanded/);
 });
});
