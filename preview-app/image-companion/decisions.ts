import {readBounded} from './io';
import {nodeRuntime} from './nodeRuntime';
import {DECISION_LIMITS,createDecisionValidator} from './portable/decisions';
import {RETAINED_LIMITS} from './portable/retained';
export async function inspectDecisions(path:string,reviewPath:string){
 const bytes=await readBounded(path,DECISION_LIMITS.bytes),review=await readBounded(reviewPath,RETAINED_LIMITS.archiveBytes);
 return (await createDecisionValidator(nodeRuntime).inspect(bytes,review)).summary;
}
