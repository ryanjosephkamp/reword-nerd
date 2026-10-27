import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { textFixture, markdownFixture, strictCodeFixture, hostileHtmlFixture, hostileJsonFixture, createDocxFixture, createSelectablePdfFixture, sha256 } from './fixtures';
const out = 'output/studio/unified-platform';
test('real Text exports preserve originals and reviewed sources across all modes', async ({page}) => {
  mkdirSync(out,{recursive:true});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button',{name:/^Remove Urban gardens/}).click();
  const fixtures=[textFixture,markdownFixture,await createDocxFixture(),createSelectablePdfFixture(),strictCodeFixture,hostileHtmlFixture,hostileJsonFixture];
  await page.getByLabel('Import documents').setInputFiles(fixtures);
  await expect(page.locator('.studio-document-item')).toHaveCount(fixtures.length);
  const reviewed:Record<string,string>={};
  for(const fixture of fixtures){
    const name=fixture.name.replace(/\.(md|txt)$/i,'').replaceAll('-',' ');
    await page.locator('.studio-document-item').filter({hasText:name}).getByRole('button').first().click();
    await page.getByRole('button',{name:'Edit source',exact:true}).click();
    const source=page.getByRole('textbox',{name:'Document source'});
    await expect(source).not.toHaveValue('');
    if(fixture.name===textFixture.name)await source.fill(textFixture.buffer.toString('utf8')+'Reviewed Unicode: 東京 😀\n\n');
    reviewed[fixture.name]=await source.inputValue();
    await page.getByRole('button',{name:'Review complete',exact:true}).click();
  }
  expect(await page.evaluate(()=>Object.hasOwn(window,'__hostileOriginalExecuted'))).toBe(false);
  await page.getByRole('button',{name:'Build package',exact:true}).click();
  const workspace=page.getByRole('region',{name:'Prompt workspace',exact:true});
  await expect(workspace).toBeVisible();
  const fixtureResponse = 'Synthetic response for state-retention testing. No model was called.\n';
  await workspace.getByLabel('Model response', {exact:true}).first().fill(fixtureResponse);
  for(const mode of ['Images','Projects','Runs','Text']) {
    await page.getByRole('navigation',{name:'Workspace modes'}).getByRole('button',{name:mode,exact:true}).click();
    const start=page.getByRole('button',{name:'START LOCAL SESSION'});if(await start.isVisible())await start.click();
  }
  await expect(workspace).toBeVisible();
  await expect(workspace.getByLabel('Model response', {exact:true}).first()).toHaveValue(fixtureResponse);
  const progressEvent=page.waitForEvent('download');
  await workspace.getByRole('button',{name:'Save progress HTML',exact:true}).click();
  await (await progressEvent).saveAs(`${out}/text-workbook-progress.html`);
  const downloadEvent=page.waitForEvent('download');
  await workspace.getByRole('button',{name:'Download ZIP',exact:true}).click();
  const download=await downloadEvent;await download.saveAs(`${out}/text-manual-export.zip`);
  const stream=await download.createReadStream();const chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
  const bytes=Buffer.concat(chunks);const zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
  const manifest=JSON.parse(await zip.file('manifest.json')!.async('string'));
  expect(manifest.schemaVersion).toBe(6);expect(manifest.documents).toHaveLength(fixtures.length);
  for(const fixture of fixtures){const record=manifest.documents.find((d:{originalDisplayName:string})=>d.originalDisplayName===fixture.name);expect(await zip.file(record.original.path)!.async('nodebuffer')).toEqual(fixture.buffer);expect(await zip.file(record.reviewedExtraction.path)!.async('string')).toBe(reviewed[fixture.name]);}
  const duplicates=await page.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);return ids.filter((id,i)=>ids.indexOf(id)!==i)});expect(duplicates).toEqual([]);
  await page.screenshot({path:`${out}/text-package.png`,fullPage:true});
  await page.getByRole('button',{name:'Read',exact:true}).click();
  await page.locator('.studio-document-item').filter({hasText:'guide'}).getByRole('button').first().click();
  await page.screenshot({path:`${out}/text.png`,fullPage:true});
  await page.getByRole('navigation',{name:'Workspace modes'}).getByRole('button',{name:'Runs',exact:true}).click();
  await page.keyboard.press('Control+k');await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({path:`${out}/runs.png`,fullPage:true});
  expect(errors).toEqual([]);
  writeFileSync(`${out}/text-browser-receipt.json`,JSON.stringify({schemaVersion:manifest.schemaVersion,packageSha256:sha256(bytes),files:fixtures.map(f=>({name:f.name,originalSha256:sha256(f.buffer),reviewedSha256:sha256(reviewed[f.name])})),modeStateRetained:true,syntheticResponseRetained:true,standaloneProgressExported:true,duplicateIds:duplicates,pageErrors:errors},null,2));
});
test('themes persist only appearance and mobile mode navigation stays usable',async({page})=>{
 await page.goto('/');
 const colors=[];
 for(const palette of ['graphite','lime','amber','original']){await page.getByLabel('Color palette').selectOption(palette);for(const mode of ['dark','light']){const root=page.locator('.unified-platform').first();if(await root.getAttribute('data-appearance')!==mode)await page.getByRole('button',{name:`Switch to ${mode} appearance`}).click();await expect(root).toHaveAttribute('data-palette',palette);colors.push({palette,mode,accent:await root.evaluate(e=>getComputedStyle(e).getPropertyValue('--studio-mint'))});}}
 await page.reload();await expect(page.locator('.unified-platform').first()).toHaveAttribute('data-palette','original');await expect(page.locator('.unified-platform').first()).toHaveAttribute('data-appearance','light');
 await page.getByLabel('Color palette').selectOption('graphite');await page.getByRole('button',{name:'Switch to dark appearance'}).click();
 await page.setViewportSize({width:390,height:844});
 for(const mode of ['Text','Images','Projects','Runs']){await page.getByRole('navigation',{name:'Workspace modes'}).getByRole('button',{name:mode,exact:true}).click();const start=page.getByRole('button',{name:'START LOCAL SESSION'});if(await start.isVisible())await start.click();await expect(page.getByRole('navigation',{name:'Workspace modes'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);await page.screenshot({path:`${out}/mobile-${mode.toLowerCase()}.png`,fullPage:true});}
 writeFileSync(`${out}/themes-browser-receipt.json`,JSON.stringify({colors,persistence:true,mobileWidth:390},null,2));
});
