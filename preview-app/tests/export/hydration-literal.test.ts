import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { CURATED_MODEL_PROFILES } from '../../src/domain/profiles';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { renderPromptBundle } from '../../src/prompting/renderPromptSet';
import { hydrateBoundPrompt } from '../../src/prompting/hydratePrompt';
import { buildPromptPackage } from '../../src/export/package';
import { createWorkbookProgress, updateWorkbookResponse, renderWorkbookProgressHtml, parseWorkbookProgressHtml } from '../../src/export/artifacts';
import { createFixtureInput } from '../../companion/fixtures';

const stages = ['decompose','rewrite','verify','final'] as const;
const literal = '\uFEFF café 🌍\r\n$& $$ $` $\'\r\n<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>\r\n<<<INSERT_STAGE_2_REWRITE_RESPONSE>>>\r\n<<<INSERT_STAGE_3_VERIFICATION_RESPONSE>>>\r\n  ';

describe('bound canonical text hydration', () => {
 it.each(CURATED_MODEL_PROFILES)('inserts only generated spans for $id without changing canonical source or settings', profile => {
  const bundle = renderPromptBundle(literal, {...DEFAULT_SETTINGS,customRequirements:literal}, profile);
  const responses = {decompose:'D '+literal,rewrite:'R '+literal,verify:'V '+literal};
  for (const stage of stages) {
   const slots=bundle.manualBindings![stage]; const original=bundle.manual[stage];
   const expected=[...slots].reverse().reduce((text,slot)=>text.slice(0,slot.start)+responses[slot.stage]+text.slice(slot.end),original);
   const hydrated=hydrateBoundPrompt(original,slots,responses);
   expect(hydrated).toBe(expected); expect(hydrated).toContain(literal);
   expect(new TextEncoder().encode(hydrated)).toEqual(new TextEncoder().encode(expected));
   expect(slots).toHaveLength(stages.indexOf(stage));
  }
 });
 it('runs the standalone browser script with literal prerequisites and round-trips exact state', async () => {
  const built=await buildPromptPackage([createFixtureInput({text:literal})]);
  if(!built.ok)throw Error(built.error.code);
  const workbook=built.workbooks[0]; let progress=createWorkbookProgress(workbook);
  const dom=new JSDOM(renderWorkbookProgressHtml(workbook,progress),{runScripts:'dangerously'});
  for(const stage of stages){
   const value=stage+' '+literal;
   const input=dom.window.document.querySelector(`[data-response-stage="${stage}"]`) as HTMLTextAreaElement;
   // DOM textareas normalize CRLF. Inject exact prior state via the public workbook
   // progress payload separately below; user edits follow browser LF semantics.
   input.value=value; input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
   progress=updateWorkbookResponse(workbook,progress,stage,input.value);
   for(const next of stages){const textarea=dom.window.document.querySelector(`[data-prompt-stage="${next}"]`) as HTMLTextAreaElement;expect(textarea.value).toBe(progress.manual.prompts[next].text.replace(/\r\n?/g,'\n'));}
  }
  dom.window.close();
  let exact=createWorkbookProgress(workbook);
  for(const stage of stages)exact=updateWorkbookResponse(workbook,exact,stage,stage+' '+literal);
  const html=renderWorkbookProgressHtml(workbook,exact);
  const restored=parseWorkbookProgressHtml(workbook,html);
  expect(restored.responses).toEqual(exact.responses);
  for(const stage of stages)expect(restored.manual.prompts[stage].text).toBe(exact.manual.prompts[stage].text);
 });
});
