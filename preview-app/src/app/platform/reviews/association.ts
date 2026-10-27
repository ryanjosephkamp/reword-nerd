import type {ImagePortalState} from '../../../image/reducer';
import type {ImportedReview} from './importReview';
export interface ReviewAssociation {session:number;itemId:string;incarnation:number;reviewRevision:number;packageSha256:string;pairKey:string}
export function associationCandidate(review:ImportedReview,state:ImagePortalState|null):{binding:ReviewAssociation|null;reason:string}{
 const item=state?.items.find(i=>i.id===state.focusedItemId);
 if(!state||!item)return {binding:null,reason:'Select an image in Images, review its settings, then build its package to compare bindings.'};
 if(item.sourceHash!==review.registration.origin.referenceSha256)return {binding:null,reason:'Reference mismatch: the selected image has different original bytes. This review remains available on its own.'};
 const built=state.builtOutput;
 if(!built||state.buildStatus!=='ready'||state.confirmedReviewGeneration!==state.reviewGeneration||built.builtForSessionGeneration!==state.sessionGeneration||built.builtForReviewGeneration!==state.reviewGeneration||built.buildGeneration!==state.buildGeneration)return {binding:null,reason:'Build the current reviewed image package first. An old build cannot establish association.'};
 const preview=built.previewPairs.find(p=>p.occurrenceId===item.id);
 const pair=built.manifest.pairs.find(p=>p.key===preview?.key);
 const origin=review.registration.origin;
 if(!preview||!pair||built.packageSha256!==origin.packageSha256||preview.sourceHash!==origin.referenceSha256||pair.source.sha256!==origin.referenceSha256||pair.key!==origin.pairKey||pair.artifacts.prompt.sha256!==origin.promptSha256||preview.prompt!==review.checked.pkg.prompt)return {binding:null,reason:'Package or prompt mismatch: source identity, order, settings and saved profile must match the original package. No association was made.'};
 return {binding:{session:state.sessionGeneration,itemId:item.id,incarnation:item.incarnation,reviewRevision:item.reviewRevision,packageSha256:built.packageSha256,pairKey:pair.key},reason:'Exact original package, reference identity and prompt match the selected in-memory image. Association is optional; it does not accept or replace either image.'};
}
export function associationIsCurrent(binding:ReviewAssociation,candidate:ReviewAssociation|null){return candidate!==null&&Object.keys(binding).every(k=>binding[k as keyof ReviewAssociation]===candidate[k as keyof ReviewAssociation]);}
