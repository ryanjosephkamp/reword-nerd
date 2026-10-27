import {setup} from "./reviewTestFixture";
import {expect,it} from 'vitest';
import {associationCandidate,associationIsCurrent} from '../src/app/platform/reviews/association';
import {addReview,type ReviewEntry} from '../src/app/platform/reviews/importReview';
it('deterministic association check: exact validated package, prompt and selected identity required; association goes stale on edits',async()=>{
 const {review,state}=await setup();const result=associationCandidate(review,state);expect(result.binding).not.toBeNull();expect(associationIsCurrent(result.binding!,associationCandidate(review,state).binding)).toBe(true);
 for(const bad of [null,{...state,focusedItemId:null},{...state,items:[{...state.items[0],sourceHash:'0'.repeat(64)}]},{...state,reviewGeneration:2},{...state,builtOutput:{...state.builtOutput,packageSha256:'0'.repeat(64)}},{...state,builtOutput:{...state.builtOutput,previewPairs:[{...state.builtOutput.previewPairs[0],prompt:'wrong'}]}}])expect(associationCandidate(review,bad).binding).toBeNull();
 expect(associationIsCurrent(result.binding!,{...result.binding!,incarnation:2})).toBe(false);expect(review.registration.acceptedByUser).toBe(false);
});
it('duplicate import is idempotent, conflicting identity rejected and collection bounded',async()=>{
 const {review,bundle}=await setup();const entry:ReviewEntry={review,bundle,bundleHash:'a',name:'owned.zip',retainedBytes:1};const first=addReview([],entry);expect(addReview(first.entries,entry)).toEqual({entries:first.entries,duplicate:true});expect(()=>addReview(first.entries,{...entry,bundleHash:'b'})).toThrow('different bundle');
 const other={...entry,review:{...review,registration:{...review.registration,registrationId:'another'}}};expect(()=>addReview(first.entries,{...other,retainedBytes:96*1024*1024})).toThrow('limit');expect(()=>addReview([entry,entry,entry],other)).toThrow('limit');expect(first.entries).toHaveLength(1);
});