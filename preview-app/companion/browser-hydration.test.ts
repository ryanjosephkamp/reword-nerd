import { mkdir, writeFile } from 'node:fs/promises';
import { it, expect } from 'vitest';
import { createFixtureInput } from './fixtures';
import { buildPromptPackage } from '../src/export/package';
import { createWorkbookProgress, updateWorkbookResponse, renderWorkbookProgressHtml } from '../src/export/artifacts';
it('prepares an owned literal browser fixture with exact expected prompts',async()=>{
 const literal="\uFEFFé\r\n$& $$ $` $'\r\n<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>\r\n<<<INSERT_STAGE_2_REWRITE_RESPONSE>>>\r\n<<<INSERT_STAGE_3_VERIFICATION_RESPONSE>>>\r\n  ";
 const built=await buildPromptPackage([createFixtureInput({text:literal})]);if(!built.ok)throw Error(built.error.code);
 const workbook=built.workbooks[0];let progress=createWorkbookProgress(workbook);
 const stages=['decompose','rewrite','verify','final'] as const;
 const snapshots=[];
 for(const stage of stages){progress=updateWorkbookResponse(workbook,progress,stage,stage+' '+literal);snapshots.push(progress);}
 const out='output/studio/connected-text/hydration-browser';await mkdir(out,{recursive:true});
 await writeFile(out+'/package.zip',new Uint8Array(await built.blob.arrayBuffer()));
 await writeFile(out+'/workbook.html',renderWorkbookProgressHtml(workbook,progress));
 await writeFile(out+'/expected.json',JSON.stringify({literal,snapshots}));
 expect(progress.responses.final).toContain(literal);
});
