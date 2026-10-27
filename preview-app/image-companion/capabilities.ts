import { z } from 'zod';
export const capabilitySchema=z.object({schemaVersion:z.literal(1),adapter:z.enum(['codex-imagegen-v1','deterministic-fixture','unsupported']),tool:z.string().max(200).nullable(),referenceFileInput:z.boolean(),exactOutputArtifact:z.boolean(),smokeAuthorized:z.boolean(),observation:z.string().min(1).max(2000)}).strict();
export type ImageCapability=z.infer<typeof capabilitySchema>;
export const HOST_DISCOVERY:ImageCapability={schemaVersion:1,adapter:'codex-imagegen-v1',tool:'image_gen.imagegen',referenceFileInput:true,exactOutputArtifact:false,smokeAuthorized:false,observation:'Tool descriptor exposed in this Codex task: prompt plus referenced_image_paths supports local reference input. Result type is unknown; exact returned artifact transport has not been demonstrated. No real image smoke was explicitly authorized or run. This is a recorded task observation, not live discovery by the CLI.'};
export const FIXTURE_CAPABILITY:ImageCapability={schemaVersion:1,adapter:'deterministic-fixture',tool:null,referenceFileInput:true,exactOutputArtifact:true,smokeAuthorized:false,observation:'Offline deterministic owned PNG fixture. No model request; fixture bytes only.'};
export function capabilityBlock(cap:ImageCapability,mode:'fixture'|'host-assisted'):string|null{
 if(mode==='fixture')return cap.adapter==='deterministic-fixture'?null:'Fixture execution requires the deterministic fixture adapter.';
 if(cap.adapter!=='codex-imagegen-v1'||cap.tool!=='image_gen.imagegen'||!cap.referenceFileInput)return 'Unsupported reference-image host capability.';
 if(!cap.smokeAuthorized)return 'A real image smoke requires explicit user authorization; none is recorded.';
 if(!cap.exactOutputArtifact)return 'Exact returned image artifact transport has not been established.';
 return null;
}
