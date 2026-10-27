import {expect,test} from '@playwright/test';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
const out='output/studio/review-import';
const fixture='image-companion/testdata/retained-image-review-v1.zip';
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
test('real owned portable review import: custody, state, keyboard, themes and scoped removal',async({page})=>{
 test.setTimeout(120000);mkdirSync(out,{recursive:true});
 const errors:string[]=[],external:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname)&&url.protocol.startsWith('http')){external.push(url.href);return route.abort();}return route.continue();});
 await page.goto('/?mode=runs');await page.getByLabel('Select portable image review ZIP').setInputFiles(fixture);
 const review=page.locator('.imported-review');await expect(review).toBeVisible({timeout:60000});
 await expect(review.getByRole('button',{name:'Associate selected image'})).toBeDisabled();
 await expect(review.getByRole('img',{name:'Original reference image'})).toBeVisible();
 expect(await review.getByRole('img',{name:'Retained host-generated image, not accepted'}).evaluate((e:HTMLImageElement)=>({width:e.naturalWidth,height:e.naturalHeight}))).toEqual({width:1586,height:992});
 const downloads:Record<string,string>={};
 for(const [name,file] of [['Download exact output','returned.png'],['Download reference','reference.png'],['Download original review ZIP','retained-image-review.zip'],['Download original receipt','receipt.json'],['Download audit','audit.json']]){
  const event=page.waitForEvent('download');await review.getByRole('button',{name,exact:true}).click();const d=await event;await d.saveAs(`${out}/download-${file}`);downloads[file]=hash(readFileSync(`${out}/download-${file}`));
 }
 expect(downloads['returned.png']).toBe('3a483154c86debc68790707d77ae6f669cd858e2ac611fd8d185b955a32ba55a');expect(downloads['retained-image-review.zip']).toBe('480f52ff9dfca6e95f28b4795dcdfa9b8526e2196c66ab1728e3587d9bf1130d');
 await page.getByLabel('Select portable image review ZIP').setInputFiles(fixture);await expect(page.getByText('This exact review is already imported. Existing review state was preserved.')).toBeVisible();await expect(review).toHaveCount(1);
 const modes=page.getByRole('navigation',{name:'Workspace modes'});
 await modes.getByRole('button',{name:'Text',exact:true}).click();await page.getByRole('button',{name:'Edit source',exact:true}).click();await page.getByRole('textbox',{name:'Document source'}).fill('Owned review-import state test\nWhitespace:  α 🚀\n\n');
 await modes.getByRole('button',{name:'Images',exact:true}).click();const start=page.getByRole('button',{name:'START LOCAL SESSION'});if(await start.isVisible())await start.click();
 await page.getByLabel('Add image files').setInputFiles({name:'mismatch.png',mimeType:'image/png',buffer:readFileSync(`${out}/download-returned.png`)});
 await expect(page.getByRole('button',{name:/Focus mismatch.png/})).toBeVisible();
 await page.getByRole('button',{name:'CONFIRM IMAGE SET',exact:true}).click();await page.getByRole('button',{name:'BUILD PACKAGE',exact:true}).click();await expect(page.getByRole('button',{name:'DOWNLOAD ZIP',exact:true})).toBeEnabled();
 const imageDownload=page.waitForEvent('download');await page.getByRole('button',{name:'DOWNLOAD ZIP',exact:true}).click();await (await imageDownload).saveAs(`${out}/manual-image-package.zip`);
 const imageZip=await JSZip.loadAsync(readFileSync(`${out}/manual-image-package.zip`));const imageManifest=JSON.parse(await imageZip.file('manifest.json')!.async('string'));expect(imageManifest.schemaVersion).toBe(1);expect(hash(await imageZip.file(imageManifest.pairs[0].source.path)!.async('uint8array'))).toBe(downloads['returned.png']);
 await modes.getByRole('button',{name:'Runs',exact:true}).click();await expect(review.getByText(/Reference mismatch:/)).toBeVisible();await expect(review.getByRole('button',{name:'Associate selected image'})).toBeDisabled();
 await page.keyboard.press('Control+k');await expect(page.getByRole('dialog')).toHaveCount(0);
 await review.getByText('Run details and original history',{exact:true}).focus();await page.keyboard.press('Enter');await expect(review.getByText('b3e80575-855e-454a-909f-a936d2580dcd',{exact:true})).toBeVisible();await page.keyboard.press('Enter');
 const palettes=[];for(const palette of ['graphite','lime','amber','original']){await page.getByLabel('Color palette').selectOption(palette);for(const appearance of ['dark','light']){const root=page.locator('.unified-platform');if(await root.getAttribute('data-appearance')!==appearance)await page.getByRole('button',{name:`Switch to ${appearance} appearance`}).click();await expect(review).toBeVisible();palettes.push({palette,appearance,accent:await root.evaluate(e=>getComputedStyle(e).getPropertyValue('--studio-mint'))});}}
 await page.getByLabel('Color palette').selectOption('graphite');await page.getByRole('button',{name:'Switch to dark appearance'}).click();await page.screenshot({path:`${out}/runs-desktop.png`,fullPage:true});
 await review.scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/comparison-desktop.png`});
 for(const mode of ['Projects','Text','Images','Runs']){await modes.getByRole('button',{name:mode,exact:true}).click();await page.screenshot({path:`${out}/${mode.toLowerCase()}-desktop.png`,fullPage:true});}
 await modes.getByRole('button',{name:'Text',exact:true}).click();await expect(page.getByRole('textbox',{name:'Document source'})).toHaveValue('Owned review-import state test\nWhitespace:  α 🚀\n\n');await modes.getByRole('button',{name:'Images',exact:true}).click();await expect(page.getByRole('button',{name:/Focus mismatch.png/})).toBeVisible();await expect(page.getByRole('button',{name:'DOWNLOAD ZIP',exact:true})).toBeEnabled();await modes.getByRole('button',{name:'Runs',exact:true}).click();await expect(review).toHaveCount(1);
 const bad=await JSZip.loadAsync(readFileSync(fixture));bad.file('review.html','<script>window.__reviewExecuted=true</script>',{createFolders:false});await page.getByLabel('Select portable image review ZIP').setInputFiles({name:'tampered.zip',mimeType:'application/zip',buffer:Buffer.from(await bad.generateAsync({type:'uint8array',compression:'DEFLATE',platform:'UNIX'}))});await expect(page.getByRole('alert')).toContainText('Bundle inventory');await expect(review).toHaveCount(1);expect(await page.evaluate(()=>Object.hasOwn(window,'__reviewExecuted'))).toBe(false);
 const mobile=[];for(const width of [390,320]){await page.setViewportSize({width,height:844});await expect(review).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);await page.screenshot({path:`${out}/runs-mobile-${width}.png`,fullPage:true});mobile.push(width);}
 await review.getByRole('button',{name:'Remove this imported review'}).click();await expect(review).toHaveCount(0);await expect(page.getByLabel('Select portable image review ZIP')).toBeFocused();await modes.getByRole('button',{name:'Images',exact:true}).click();await expect(page.getByRole('button',{name:/Focus mismatch.png/})).toBeVisible();
 const ids=await page.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);return ids.filter((x,i)=>ids.indexOf(x)!==i);});expect(ids).toEqual([]);expect(errors).toEqual([]);expect(external).toEqual([]);
 writeFileSync(`${out}/browser-receipt.json`,JSON.stringify({fixture:'real retained host output, no new generation',downloads,duplicateImportPreserved:true,tamperRejected:true,sourceMismatchRejected:true,sourceAcceptance:false,modeStatePreserved:true,imagePackageRetained:true,manualImageExportCustody:true,scopedClear:true,keyboard:true,mobileWidths:mobile,palettes,duplicateIds:ids,pageErrors:errors,externalRequests:external,browserPlugin:'Browser plugin not available; repository Playwright used'},null,2));
});

test('owned project review survives Runs import and mode switches',async({page})=>{
 await page.goto('/?mode=projects');const quick=page.getByRole('dialog',{name:'Quick start'});if(await quick.isVisible())await quick.getByRole('button',{name:'Close quick start'}).click();
 const zip=new JSZip();zip.file('README.md','# Owned project\n');zip.file('src/example.ts','// Original comment\nexport const answer = 42;\n');const bytes=await zip.generateAsync({type:'nodebuffer'});
 const input=page.locator('section[aria-label="Projects and advanced sources"] input[type=file]').first();await input.setInputFiles({name:'owned-project.zip',mimeType:'application/zip',buffer:bytes});
 await page.getByRole('combobox',{name:'Project classification'}).selectOption('general-text');
 const file=page.getByRole('list',{name:'Project files'}).getByRole('button').filter({hasText:'src/example.ts'});await file.click();
 const text='// Reviewed comment\nexport const answer = 42;\n';await page.getByLabel('Reviewed text for src/example.ts').fill(text);await page.getByLabel('Reviewed text for src/example.ts').blur();
 const modes=page.getByRole('navigation',{name:'Workspace modes'});await modes.getByRole('button',{name:'Runs',exact:true}).click();await page.getByLabel('Select portable image review ZIP').setInputFiles(fixture);await expect(page.locator('.imported-review')).toBeVisible({timeout:60000});
 for(const name of ['Text','Images','Runs','Projects']){await modes.getByRole('button',{name,exact:true}).click();const start=page.getByRole('button',{name:'START LOCAL SESSION'});if(await start.isVisible())await start.click();}await expect(page.getByLabel('Reviewed text for src/example.ts')).toHaveValue(text);await expect(page.getByRole('combobox',{name:'Project classification'})).toHaveValue('general-text');
 await page.screenshot({path:`${out}/projects-review-desktop.png`,fullPage:true});
 writeFileSync(`${out}/project-state-receipt.json`,JSON.stringify({ownedSyntheticProject:true,reviewTextRetained:true,executableSyntaxUnchanged:true,projectSelectionRetained:true,classificationRetained:true,reviewImportIndependent:true,codeExecuted:false},null,2));
});
