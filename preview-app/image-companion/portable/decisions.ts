import {z} from 'zod';
import {encode,utf8,equalData,equalBytes,fail,type ReviewRuntime} from './runtime';
import {createRetainedValidator,RETAINED_LIMITS} from './retained';
export const DECISION_LIMITS=Object.freeze({bytes:512*1024,notesBytes:8192,revisions:32});
const sha=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().uuid();
const subjectSchema=z.object({bundleSha256:sha,registrationId:id,packageSha256:sha,referenceSha256:sha,promptSha256:sha,outputSha256:sha}).strict();
const selectionSchema=z.object({session:z.number().int().nonnegative(),itemId:z.string().min(1).max(200),incarnation:z.number().int().positive(),reviewRevision:z.number().int().nonnegative(),packageSha256:sha,pairKey:z.string().min(1).max(256)}).strict();
const associationSchema=z.discriminatedUnion('status',[
 z.object({status:z.literal('not-associated'),selection:z.null()}).strict(),
 z.object({status:z.literal('matching-at-action'),selection:selectionSchema}).strict(),
 z.object({status:z.literal('stale-at-action'),selection:selectionSchema}).strict(),
]);
export const decisionSchema=z.enum(['notes-only','accept','request-changes','reject']);
const actionSchema=z.object({schemaVersion:z.literal(1),kind:z.literal('explicit-user-review-action'),actionId:id,revision:z.number().int().min(1).max(DECISION_LIMITS.revisions),recordedAt:z.iso.datetime(),subject:subjectSchema,decision:decisionSchema,notes:z.string().max(DECISION_LIMITS.notesBytes),association:associationSchema,previousActionSha256:sha.nullable(),authorship:z.literal('local-user-action-not-authenticated'),modelVerification:z.literal('not-asserted')}).strict();
const exportSchema=z.object({schemaVersion:z.literal(1),kind:z.literal('reword-nerd-user-review-decisions'),subject:subjectSchema,actions:z.array(actionSchema).min(1).max(DECISION_LIMITS.revisions)}).strict();
export type Decision=z.infer<typeof decisionSchema>;
export type DecisionAction=z.infer<typeof actionSchema>;
export type DecisionExport=z.infer<typeof exportSchema>;
export type DecisionSubject=z.infer<typeof subjectSchema>;
export type DecisionAssociation=z.infer<typeof associationSchema>;
export const decisionBytes=(value:unknown)=>encode(JSON.stringify(value,null,2)+'\n');
export function subjectForReview(bundleSha256:string,registration:{registrationId:string;origin:{packageSha256:string;referenceSha256:string;promptSha256:string};output:{sha256:string}}):DecisionSubject{
 return subjectSchema.parse({bundleSha256,registrationId:registration.registrationId,packageSha256:registration.origin.packageSha256,referenceSha256:registration.origin.referenceSha256,promptSha256:registration.origin.promptSha256,outputSha256:registration.output.sha256});
}
/** Content consistency only. A chain cannot authenticate a human, timestamp or decision. */
export function createDecisionValidator(runtime:ReviewRuntime){
 async function validate(bytes:Uint8Array,expected:DecisionSubject){
  if(bytes.length>DECISION_LIMITS.bytes)fail('DECISION_LIMIT','Decision JSON exceeds 512 KiB.');
  let record:DecisionExport;
  try{record=exportSchema.parse(JSON.parse(utf8(bytes)));}catch{fail('INVALID_DECISION','Invalid or unsupported decision record.');}
  if(!equalData(record.subject,subjectSchema.parse(expected)))fail('DECISION_BINDING','Decision belongs to a different review bundle or image identity.');
  let prior:string|null=null;const ids=new Set<string>();let timestamp='';
  for(const [index,a] of record.actions.entries()){
   if(!equalData(a.subject,expected)||a.revision!==index+1||a.previousActionSha256!==prior||ids.has(a.actionId))fail('DECISION_CHAIN','Decision revision, identity or prior action hash changed.');
   if(encode(a.notes).length>DECISION_LIMITS.notesBytes)fail('DECISION_LIMIT','Notes exceed 8192 UTF-8 bytes.');
   if(a.decision==='notes-only'&&!a.notes.trim())fail('EMPTY_NOTES','A notes-only action requires explicitly entered notes.');
   if(timestamp&&Date.parse(a.recordedAt)<Date.parse(timestamp))fail('DECISION_CHAIN','Revision timestamps move backwards.');
   if(a.association.selection&&a.association.selection.packageSha256!==expected.packageSha256)fail('DECISION_BINDING','Association snapshot names a different package.');
   timestamp=a.recordedAt;ids.add(a.actionId);prior=await runtime.hash(decisionBytes(a));
  }
  // Do not normalize or silently discard duplicate JSON keys / noncanonical encoding.
  if(!equalBytes(bytes,decisionBytes(record)))fail('DECISION_ENCODING','Decision JSON must use its canonical export encoding.');
  return record;
 }
 async function append(previous:DecisionExport|null,subject:DecisionSubject,input:{decision:Decision;notes:string;association:DecisionAssociation;actionId:string;recordedAt:string}){
  if(input.notes.length>DECISION_LIMITS.notesBytes||encode(input.notes).length>DECISION_LIMITS.notesBytes)fail('DECISION_LIMIT','Notes exceed 8192 UTF-8 bytes.');
  const owned=subjectSchema.parse(subject);
  if(previous)await validate(decisionBytes(previous),owned);
  const actions=previous?.actions??[];
  if(actions.length>=DECISION_LIMITS.revisions)fail('DECISION_LIMIT','The 32-revision limit is reached. Export this history; earlier revisions remain intact.');
  const next:DecisionAction={schemaVersion:1,kind:'explicit-user-review-action',actionId:input.actionId,revision:actions.length+1,recordedAt:input.recordedAt,subject:owned,decision:input.decision,notes:input.notes,association:input.association,previousActionSha256:actions.length?await runtime.hash(decisionBytes(actions.at(-1)!)):null,authorship:'local-user-action-not-authenticated',modelVerification:'not-asserted'};
  const result=await validate(decisionBytes({schemaVersion:1,kind:'reword-nerd-user-review-decisions',subject:owned,actions:[...actions,next]}),owned);
  return result;
 }
 async function inspect(bytes:Uint8Array,bundle:Uint8Array){
  if(bytes.length>DECISION_LIMITS.bytes)fail('DECISION_LIMIT','Decision JSON exceeds 512 KiB.');
  if(bundle.length>RETAINED_LIMITS.archiveBytes)fail('BUNDLE_LIMIT','Review ZIP exceeds 64 MiB.');
  bytes=Uint8Array.from(bytes);bundle=Uint8Array.from(bundle);
  // The selected v1 review is always fully validated, not trusted from its filename/hash alone.
  const review=await createRetainedValidator(runtime).readRetainedBundle(bundle);
  const expected=subjectForReview(await runtime.hash(bundle),review.registration);
  const record=await validate(bytes,expected);
  for(const a of record.actions)if(a.association.selection&&a.association.selection.pairKey!==review.registration.origin.pairKey)fail('DECISION_BINDING','Association snapshot names a different reference pair.');
  const latestDecision=[...record.actions].reverse().find(a=>a.decision!=='notes-only')?.decision??null;
  return {record,summary:{kind:record.kind,schemaVersion:1,registrationId:expected.registrationId,bundleSha256:expected.bundleSha256,outputSha256:expected.outputSha256,revisions:record.actions.length,latestExplicitDecision:latestDecision,originalAcceptedByUser:review.registration.acceptedByUser,modelVerification:'not-asserted',authorshipVerification:'not-performed',associationVerification:'historical local assertion only; current browser state not inspected',newModelCalls:0}};
 }
 return {validate,append,inspect};
}
