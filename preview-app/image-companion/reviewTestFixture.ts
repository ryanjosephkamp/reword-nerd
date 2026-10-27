import {readFile} from 'node:fs/promises';
import {readRetainedBundle} from './retained';
import {createImagePortalItem} from '../src/image/contracts';
import {createInitialImagePortalState} from '../src/image/reducer';
export async function setup(){
 const bundle=new Uint8Array(await readFile('image-companion/testdata/retained-image-review-v1.zip'));const review=await readRetainedBundle(bundle);const p=review.checked.pkg,m=p.manifest.pairs[0];
 const item=createImagePortalItem({id:'owned-test-selection',incarnation:1,sourceBytes:new Blob([Uint8Array.from(p.referenceBytes)]),byteCount:p.referenceBytes.length,sourceHash:p.referenceSha256,mimeType:'image/png',fileExtension:'png',width:m.source.width,height:m.source.height,provenance:m.source.provenance,settings:m.configuration.settings});
 const state={...createInitialImagePortalState(),items:[item],focusedItemId:item.id,sessionGeneration:1,reviewGeneration:1,confirmedReviewGeneration:1,buildGeneration:1,buildStatus:'ready' as const,builtOutput:{packageName:'reword-nerd-image-prompt-package.zip' as const,packageBytes:new Blob([Uint8Array.from(review.files.get('source-package.zip')!)]),packageByteCount:review.files.get('source-package.zip')!.length,packageSha256:p.packageSha256,itemCount:1,builtForSessionGeneration:1,builtForReviewGeneration:1,buildGeneration:1,manifest:p.manifest,previewPairs:[{occurrenceId:item.id,sourceHash:p.referenceSha256,key:p.pairKey,displayName:p.displayName,sourceFilename:'reference.png',sourceBytes:item.sourceBytes,mimeType:'image/png' as const,width:m.source.width,height:m.source.height,provenance:m.source.provenance,profileLabel:m.configuration.profile.label,prompt:p.prompt,runCard:'',warnings:[]}]}};
 return {review,state,bundle};
}
