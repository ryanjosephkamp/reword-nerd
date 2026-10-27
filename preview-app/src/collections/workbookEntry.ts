import { prepareCollectionStage, parseCollectionResponse, imageCollectionPrompt } from "./stages";
import { canonical, digest, fromWire } from "./codec";
import { COLLECTION_STAGES, COLLECTION_LIMITS as L, boundedText } from "./limits";
import type { CollectionEnvelope, CollectionResponses } from "./prepare";
import { parseProjectFinal } from "./projectResult";
import type { ExportSourceInput } from "../export";
interface WorkbookData {kind:"reword-collection-workbook";version:1;envelope:CollectionEnvelope;seal:string;rawResponses:Record<string,string>;rawResponseHashes:Record<string,string>}
const payload=document.getElementById("collection-data")!,app=document.getElementById("collection-app")!;
const element=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
const save=(name:string,bytes:string,type="text/plain")=>{const url=URL.createObjectURL(new Blob([bytes],{type}));const a=element("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
async function start() {
  const data=JSON.parse(payload.textContent??"") as WorkbookData;
  if(data.kind!=="reword-collection-workbook"||data.version!==1||await digest(canonical(data.envelope))!==data.seal)throw Error("Workbook collection identity mismatch");
  boundedText(canonical(data),L.transportBytes+4*L.responseBytes,"Workbook data");
  for(const [stage,raw] of Object.entries(data.rawResponses))if(!COLLECTION_STAGES.includes(stage as never)||await digest(raw)!==data.rawResponseHashes[stage])throw Error("Workbook response binding mismatch");
  async function render() {
    app.replaceChildren();const e=data.envelope,history:CollectionResponses={};
    app.append(element("h1","Reviewed collection workbook"),element("p",`${e.id} · revision ${e.revision} · ${e.members.length} items`),element("p","This standalone collection workbook v1 has no network or execution controls. It uses the same canonical stage builder as the connected runner. It is a distinct format from legacy single-document workbooks/imports. Runtime selection is optional for manual use."));
    const download=element("button","Download exact collection");download.onclick=()=>save("collection.json",canonical(e),"application/json");app.append(download);
    const progress=element("button","Save workbook progress");progress.onclick=()=>{const clone=document.documentElement.cloneNode(true) as HTMLElement;clone.querySelector("#collection-data")!.textContent=canonical(data).replaceAll("<","\\u003c");clone.querySelector("#collection-app")!.replaceChildren();save("collection-workbook-progress.html","<!doctype html>\n"+clone.outerHTML,"text/html");};app.append(progress);
    const inventory=element("ul");for(const item of e.expectedOutputs)inventory.append(element("li",`${item.id} · ${item.path} · expected; acceptance remains yours`));app.append(inventory);
    if(e.operation==="image") {app.append(element("pre",imageCollectionPrompt(e)),element("p","Use the exact member references and scoped task inventory. Image output import is not provided."));return;}
    for(const [index,stage] of COLLECTION_STAGES.entries()) {
      const section=element("section"),title=element("h2",`${index+1}. ${stage}`);section.append(title);app.append(section);
      let task;try{task=await prepareCollectionStage(e,stage,history);}catch(error){section.append(element("p",(error as Error).message));break;}
      const details=element("details"),summary=element("summary","Exact aggregate canonical prompt");details.append(summary,element("pre",task.prompt));section.append(details);
      const promptDownload=element("button",`Download ${stage} prompt`);promptDownload.onclick=()=>save(`${stage}-prompt.txt`,task.prompt);section.append(promptDownload);
      const raw=data.rawResponses[stage];
      if(raw!==undefined){const parsed=parseCollectionResponse(raw,task.ticket);history[stage]=parsed.results;section.append(element("pre",raw),element("p",parsed.valid?"Structurally complete; quality and acceptance remain your review.":`Structural failure retained. ${parsed.errors.join("; ")} Missing: ${parsed.missing.join(", ")}`));
        if(stage==="final"&&parsed.valid)for(const m of e.members){
          const button=element("button",`Download final ${m.path}`);button.onclick=()=>save(`${m.id}-final.txt`,parsed.results[m.id]);section.append(button);
          if(m.kind==="project")try{
            const preparation=fromWire(m.preparation) as ExportSourceInput;if(preparation.kind!=="project")throw Error("Missing reviewed project context");
            const context={reviewedTreeHash:preparation.project.reviewedTreeHash,includedFiles:preparation.project.entries.filter(f=>f.promptIncluded).map(f=>{if(f.reviewedText===null)throw Error("Missing reviewed project text");return{path:f.path,text:f.reviewedText};}),excludedPaths:preparation.project.entries.filter(f=>!f.promptIncluded).map(f=>f.path)};
            const proposal=parseProjectFinal(parsed.results[m.id],context),review=element("button",`Download project review ${m.path}`);review.onclick=()=>save(`${m.id}-project-review.json`,canonical(proposal),"application/json");section.append(review);
            for(const [ordinal,f] of proposal.files.entries()){const changed=element("button",`Download changed ${f.path}`);changed.onclick=()=>save(`${m.id}-changed-${ordinal+1}.txt`,f.text);section.append(changed);}
            section.append(element("p",`${m.path}: ${proposal.files.length} proposed changes, ${proposal.unchanged.length} unchanged, ${proposal.excluded.length} excluded; never applied or executed.`));
          }catch(error){section.append(element("p",`${m.path}: project structural failure retained. ${(error as Error).message}`));}
        }
        if(!parsed.valid)break;
      }else{const label=element("label",`Exact raw ${stage} response`),input=element("textarea");input.rows=10;input.id=`response-${stage}`;input.setAttribute("aria-label",`Exact raw ${stage} response`);label.append(input);section.append(label);
        const record=element("button",`Retain ${stage} response`),error=element("p");error.setAttribute("role","alert");record.onclick=async()=>{try{boundedText(input.value,L.responseBytes,"Raw response");data.rawResponses[stage]=input.value;data.rawResponseHashes[stage]=await digest(input.value);await render();}catch(e){error.textContent=(e as Error).message;}};section.append(record,error);break;}
    }
  }
  await render();
}
void start().catch(error=>{app.replaceChildren(element("h1","Workbook blocked"),element("p",error.message));});
