import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {createDecisionValidator,subjectForReview,decisionBytes,DECISION_LIMITS,type DecisionAssociation} from './portable/decisions';
import {nodeRuntime} from './nodeRuntime';
import {browserRuntime} from './portable/browser';
import {readRetainedBundle} from './retained';
const fixture=()=>readFile('image-companion/testdata/retained-image-review-v1.zip');
async function setup(){const bundle=await fixture();const review=await readRetainedBundle(bundle);const subject=subjectForReview(await nodeRuntime.hash(bundle),review.registration);return {bundle,review,subject};}
const action=(decision:'notes-only'|'accept'|'reject'|'request-changes'='notes-only',notes='  Unicode α 🚀\n<script>not executed</script>\n\n',association:DecisionAssociation={status:'not-associated',selection:null})=>({decision,notes,association,actionId:randomUUID(),recordedAt:'2026-09-08T20:00:00.000Z'});
it('exact bound revisions round-trip identically in Node and browser, without changing original records',async()=>{
 const {bundle,review,subject}=await setup();const before=JSON.stringify(review.registration);const node=createDecisionValidator(nodeRuntime),browser=createDecisionValidator(browserRuntime);
 const first=await node.append(null,subject,action());const bytes=decisionBytes(first),second=await node.append(first,subject,action('accept')),third=await node.append(second,subject,action('request-changes','Need larger typography.'));
 expect(decisionBytes(first)).toEqual(bytes);expect(third.actions).toHaveLength(3);expect(third.actions.slice(0,2)).toEqual(second.actions);
 expect(await browser.inspect(decisionBytes(third),bundle)).toEqual(await node.inspect(decisionBytes(third),bundle));expect(JSON.stringify(review.registration)).toBe(before);expect(review.registration.acceptedByUser).toBe(false);expect(review.checked.current.status).toBe('failed');
 const notes=await node.append(second,subject,action());expect((await node.inspect(decisionBytes(notes),bundle)).summary.latestExplicitDecision).toBe('accept');
});
it('wrong bundle/registration/reference/prompt/output identity and history tampering rejected',async()=>{
 const {subject,bundle}=await setup(),v=createDecisionValidator(nodeRuntime);const first=await v.append(null,subject,action('reject'));const second=await v.append(first,subject,action());
 for(const key of Object.keys(subject)){const wrong={...subject,[key]:key==='registrationId'?randomUUID():'0'.repeat(64)};await expect(v.validate(decisionBytes(second),wrong)).rejects.toThrow('different');}
 for(const mutate of [(r:typeof second)=>{r.actions[0].notes='changed';},(r:typeof second)=>{r.actions[1].revision=1;},(r:typeof second)=>{r.actions[1].actionId=r.actions[0].actionId;},(r:typeof second)=>{r.actions[1].recordedAt='2026-09-07T00:00:00.000Z';}]){const r=structuredClone(second);mutate(r);await expect(v.inspect(decisionBytes(r),bundle)).rejects.toThrow();}
});
it('bounded canonical JSON, no empty notes-only action, no unknown claims or schema widening',async()=>{
 const {subject}=await setup(),v=createDecisionValidator(nodeRuntime),r=await v.append(null,subject,action());
 await expect(v.append(r,subject,action('notes-only',''))).rejects.toThrow('notes');await expect(v.append(r,subject,action('notes-only','🚀'.repeat(2049)))).rejects.toThrow('8192');
 await expect(v.validate(new Uint8Array(DECISION_LIMITS.bytes+1),subject)).rejects.toThrow('512');
 for(const bad of [{...r,schemaVersion:2},{...r,modelVerified:true},{...r,actions:[{...r.actions[0],decision:'automatic-accept'}]}])await expect(v.validate(decisionBytes(bad),subject)).rejects.toThrow('unsupported');
 await expect(v.validate(new TextEncoder().encode(JSON.stringify(r)),subject)).rejects.toThrow('canonical');
 const duplicate=new TextEncoder().encode(new TextDecoder().decode(decisionBytes(r)).replace('"schemaVersion": 1,','"schemaVersion": 1, "schemaVersion": 1,'));await expect(v.validate(duplicate,subject)).rejects.toThrow('canonical');
 let full=r;for(let i=1;i<32;i++)full=await v.append(full,subject,action());await expect(v.append(full,subject,action())).rejects.toThrow('32-revision');expect(full.actions).toHaveLength(32);
});
it('association is a historical local assertion; stale state is explicit and wrong package/pair rejected',async()=>{
 const {subject,review,bundle}=await setup(),v=createDecisionValidator(nodeRuntime);const selection={session:1,itemId:'owned',incarnation:1,reviewRevision:1,packageSha256:subject.packageSha256,pairKey:review.registration.origin.pairKey};
 const r=await v.append(null,subject,action('accept','User chose imported output despite stale association',{status:'stale-at-action',selection}));expect((await v.inspect(decisionBytes(r),bundle)).record.actions[0].association.status).toBe('stale-at-action');
 await expect(v.append(null,subject,action('accept','',{status:'matching-at-action',selection:{...selection,packageSha256:'0'.repeat(64)}}))).rejects.toThrow('package');
 const bad=await v.append(null,subject,action('accept','',{status:'matching-at-action',selection:{...selection,pairKey:'wrong'}}));await expect(v.inspect(decisionBytes(bad),bundle)).rejects.toThrow('pair');
});
it('exports a labeled synthetic decisions-only demo without accepting the real retained output',async()=>{
 const {subject,bundle}=await setup(),v=createDecisionValidator(nodeRuntime);const r=await v.append(null,subject,action('notes-only','SYNTHETIC TEST NOTES — not the owner’s review or acceptance.\nOriginal evidence is unchanged.\n'));
 await mkdir('output/studio/review-decisions',{recursive:true});await writeFile('output/studio/review-decisions/synthetic-notes-only.json',decisionBytes(r));await writeFile('output/studio/review-decisions/synthetic-decision-receipt.json',JSON.stringify((await v.inspect(decisionBytes(r),bundle)).summary,null,2));
});
