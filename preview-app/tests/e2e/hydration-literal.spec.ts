import {test,expect} from '@playwright/test';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const out='output/studio/connected-text/browser';
test('literal Studio export is accepted by the separately built Node runner',async({page})=>{
 mkdirSync(out,{recursive:true});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const literal="\uFEFFOwned text café\r\n$& $$ $` $'\r\n<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>\r\n<<<INSERT_STAGE_2_REWRITE_RESPONSE>>>\r\n<<<INSERT_STAGE_3_VERIFICATION_RESPONSE>>>\r\n  ";
 await page.goto('/');await page.getByRole('button',{name:/^Remove Urban gardens/}).click();
 await page.getByLabel('Import documents').setInputFiles({name:'literal.txt',mimeType:'text/plain',buffer:Buffer.from(literal)});
 await page.getByRole('button',{name:'Edit source',exact:true}).click();
 const reviewed=await page.getByRole('textbox',{name:'Document source'}).inputValue();
 await page.getByRole('button',{name:'Review complete',exact:true}).click();await page.getByRole('button',{name:'Build package',exact:true}).click();
 const workspace=page.getByRole('region',{name:'Prompt workspace',exact:true});await expect(workspace).toBeVisible();
 const download=page.waitForEvent('download');await workspace.getByRole('button',{name:'Download ZIP',exact:true}).click();await(await download).saveAs(`${out}/literal-package.zip`);
 const inspected=JSON.parse(execFileSync(process.execPath,['companion/cli.mjs','inspect',`${out}/literal-package.zip`],{encoding:'utf8'}));
 await workspace.getByRole('button',{name:/Guided workflow/}).click();
 for(const stage of ['Decompose','Rewrite','Verify','Final']){await workspace.getByRole('button',{name:new RegExp(`${stage}$`)}).click();await workspace.getByLabel('Model response',{exact:true}).fill(stage+' '+literal);}
 for(const mode of ['Images','Projects','Runs','Text']){await page.getByRole('navigation',{name:'Workspace modes'}).getByRole('button',{name:mode,exact:true}).click();const start=page.getByRole('button',{name:'START LOCAL SESSION'});if(await start.isVisible())await start.click();}
 await expect(workspace.getByLabel('Model response',{exact:true})).toHaveValue('Final '+literal.replace(/\r\n/g,'\n'));
 const progress=page.waitForEvent('download');await workspace.getByRole('button',{name:'Save progress HTML',exact:true}).click();await(await progress).saveAs(`${out}/literal-progress.html`);
 await page.screenshot({path:`${out}/literal-studio.png`,fullPage:true});
 const bytes=readFileSync(`${out}/literal-package.zip`);
 expect(errors).toEqual([]);
 writeFileSync(`${out}/receipt.json`,JSON.stringify({realBrowserExport:true,separatelyBuiltNodeInspection:inspected,packageSha256:createHash('sha256').update(bytes).digest('hex'),sourceReviewUsesBrowserLF:reviewed===literal.replace(/\r\n/g,'\n'),literalModeRetention:true,fixtureResponses:true,newModelCalls:0,pageErrors:errors},null,2));
});
