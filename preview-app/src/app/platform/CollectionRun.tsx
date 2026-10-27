import { mergeSavedReferences } from "../../workspace/references";
import { useWorkspaceState } from '../../workspace/Workspace';
import { useEffect, useMemo, useRef, useState } from "react";
import type { ImagePortalState } from "../../image/reducer";
import { snapshotConfirmedImagePackage } from "../../image/export/snapshot";
import { imagePromptProfile } from "../../image/profiles";
import type { ImagePromptSettings } from "../../image/contracts";
import type { RewriteSettings } from "../../domain/settings";
import { renderPromptBundle } from "../../prompting";
import { prepareTextMember, prepareImageMember, freezeCollection, sourceContext, literalSettings, type CollectionEnvelope } from "../../collections/prepare";
import { canonical, digest, unbase64 } from "../../collections/codec";
import { prepareCollectionStage, imageCollectionPrompt, imageReferenceName } from "../../collections/stages";
import { COLLECTION_LIMITS as L } from "../../collections/limits";
import { resolveRuntime, type RuntimeCatalog, type RuntimeChoice } from "../../collections/runtime.mjs";
import { RuntimePicker } from "./RuntimePicker";
import { CollectionSettings, type SettingPatch } from "./CollectionSettings";
import { collectionRequest } from "./collectionClient";
import type { TextCandidate } from "./collectionSources";
import { collectionWorkbook } from "../../collections/workbook";
interface Capability {kind:string;session:string;location:string;catalog:RuntimeCatalog|null;textEnabled:boolean;imageEnabled:boolean;imageBoundary:boolean;activeOrUncertain:boolean;mode:string;retention:string;evidenceLevel:string}
interface RecordItem {id:string;seal:string;operation:string;status:string;error:string|null;memberPaths:string[];runtime:RuntimeChoice|null;actualExecutor:string|null;actualModel:string|null;actualEffort:string|null;stageRequests:number;taskId:string|null;artifacts:string[];expectedOutputs:{id:string;path:string;status:string;acknowledgedInTaskText?:boolean}[];resendOf:string|null}
function download(name:string, content:string|Uint8Array, type="application/octet-stream") {const url=URL.createObjectURL(new Blob([typeof content==="string"?content:Uint8Array.from(content)],{type}));const link=document.createElement("a");link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function FrozenImage({bytes,label}:{bytes:Blob;label:string}) {
  const ref=useRef<HTMLImageElement>(null);
  useEffect(()=>{const node=ref.current;if(!node)return;const next=URL.createObjectURL(bytes);node.src=next;return()=>{node.removeAttribute("src");URL.revokeObjectURL(next);};},[bytes]);
  return <img ref={ref} className="collection-reference-preview" alt={label}/>;
}
export function CollectionRun({sources,imageState}: {sources:TextCandidate[];imageState:ImagePortalState|null}) {
  const [operation,setOperation]=useWorkspaceState<"text"|"image">("collection:operation", "text"),[selected,setSelected]=useWorkspaceState<Record<string,boolean>>("collection:selected", {}),[paths,setPaths]=useWorkspaceState<Record<string,string>>("collection:paths", {});
  const [shared,setShared]=useWorkspaceState("collection:shared", ""),[textSettings,setTextSettings]=useWorkspaceState<SettingPatch>("collection:textSettings", {}),[imageSettings,setImageSettings]=useWorkspaceState<SettingPatch>("collection:imageSettings", {}),[overrides,setOverrides]=useWorkspaceState<Record<string,SettingPatch>>("collection:overrides", {});
  const [runtime,setRuntime]=useWorkspaceState<RuntimeChoice|null>("collection:runtime", null),[cap,setCap]=useState<Capability|null>(null),[records,setRecords]=useWorkspaceState<RecordItem[]>("collection:records", []),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [frozen,setFrozen]=useWorkspaceState<{envelope:CollectionEnvelope;seal:string;prompt:string;fingerprint:string;images:Blob[]}|null>("collection:frozen", null),[confirmed,setConfirmed]=useState<string|null>(null),[resendOf,setResendOf]=useWorkspaceState<string|null>("collection:resendOf", null);
  const [available, setAvailable] = useState<Set<string>>(() => new Set());
  const candidates=useMemo(()=>operation==="text"?sources.map(s=>({key:`text:${s.id}`,path:s.path,reason:s.reason})):imageState?.items.map(i=>({key:`image:${i.id}`,path:i.provenance.sourcePath??i.provenance.sourceName,reason:i.mimeType!=="image/png"?"Connected images require PNG; keep this item for manual export.":i.ocr.status==="accepted"?"Accepted OCR stays intact; this image adapter cannot transmit it.":undefined}))??[],[operation,sources,imageState]);
  const sharedSettings=operation==="text"?textSettings:imageSettings;
  const fingerprint=JSON.stringify({operation,selected,paths,shared,textSettings,imageSettings,overrides,runtime,resendOf,sources:sources.filter(s=>selected[`text:${s.id}`]).map(s=>s.input),images:imageState?{session:imageState.sessionGeneration,revision:imageState.reviewGeneration,items:imageState.items.filter(i=>selected[`image:${i.id}`]).map(i=>({id:i.id,hash:i.sourceHash,settings:i.settings,ocr:i.ocr,provenance:i.provenance,revision:i.reviewRevision}))}:null});
  const current=useRef(fingerprint);useEffect(()=>{current.current=fingerprint;},[fingerprint]);
  const fresh=frozen?.fingerprint===fingerprint;
  useEffect(()=>{let active=true;void collectionRequest("capabilities").then(v=>{if(active && (v as Capability).kind==="reword-collections")setCap(v as Capability);}).catch(()=>{});return()=>{active=false;};},[]);
  async function refresh() {const v=await collectionRequest("status") as {records:RecordItem[]};setAvailable(new Set(v.records.map(r => r.id)));setRecords(prior => mergeSavedReferences(prior, v.records));const c=await collectionRequest("capabilities") as Capability;setCap(c);}
  const connected=Boolean(cap);
  useEffect(()=>{if(!connected)return;let active=true;const update=()=>collectionRequest("status").then(v=>{if(active){const incoming=(v as {records:RecordItem[]}).records;setAvailable(new Set(incoming.map(r => r.id)));setRecords(prior => mergeSavedReferences(prior,incoming));}}).catch(()=>{});void update();const timer=setInterval(update,2000);return()=>{active=false;clearInterval(timer);};},[connected, setRecords]);
  async function catalog() {setBusy(true);setError("");try{const v=await collectionRequest("catalog",cap?.session) as {catalog:RuntimeCatalog};setCap(c=>c?{...c,catalog:v.catalog}:c);setConfirmed(null);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function build() {
    setBusy(true);setError("");setConfirmed(null);const captured=fingerprint;
    try {
      const chosen=candidates.filter(c=>selected[c.key]);if(!chosen.length)throw Error("Select the exact sources to include.");
      const blocked=chosen.find(c=>c.reason);if(blocked)throw Error(blocked.reason);
      let choice:RuntimeChoice|null=runtime;
      if(runtime && cap?.catalog){const resolved=resolveRuntime(cap.catalog,runtime,operation);choice={model:resolved.model,effort:resolved.effort};}
      const members=[],images:Blob[]=[];
      if(operation==="text") for(const [ordinal,c] of chosen.entries()){
        const input=sources.find(s=>`text:${s.id}`===c.key)?.input;if(!input)throw Error("Source unavailable");
        const settings=literalSettings({...input.resolvedSettings,...sharedSettings,...overrides[c.key]} as RewriteSettings);
        const prepared={...input,resolvedSettings:settings,promptBundle:renderPromptBundle(input.reviewedExtractedText,settings,input.chosenProfile,sourceContext(input))};
        members.push(await prepareTextMember(`text-${ordinal+1}`,paths[c.key]??c.path,prepared));
      } else {
        if(!imageState)throw Error("Image sources unavailable");
        const clone={...imageState,confirmedReviewGeneration:imageState.reviewGeneration,items:imageState.items.map(i=>({...i,included:Boolean(selected[`image:${i.id}`])}))};
        const snapshot=snapshotConfirmedImagePackage(clone);if(!snapshot.ok)throw Error(snapshot.error.message);
        for(const [ordinal,item] of snapshot.snapshot.items.entries()){
          const key=`image:${item.occurrenceId}`,c=chosen.find(x=>x.key===key)!;
          const settings={...item.settings,...sharedSettings,...overrides[key]} as ImagePromptSettings;
          const profile=imagePromptProfile(settings.modelFamily);
          members.push(await prepareImageMember(`image-${ordinal+1}`,paths[key]??c.path,{...item,settings,expectedProfileVersion:profile.profileVersion,expectedProfileVerifiedAt:profile.lastVerifiedAt}));
          images.push(item.sourceBytes);
        }
      }
      const envelope=await freezeCollection(members,{id:crypto.randomUUID(),revision:1,sharedInstruction:shared,runtime:choice,resendOf});
      const prompt=operation==="text"?(await prepareCollectionStage(envelope,"decompose")).prompt:imageCollectionPrompt(envelope),seal=await digest(canonical(envelope));
      if(current.current!==captured)throw Error("Sources or settings changed while preparing; review the new selection.");
      setFrozen({envelope,seal,prompt,fingerprint:captured,images});
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  let runtimeReady=false,runtimeReason="Manual export requires no runtime choice.";
  try{if(frozen?.envelope.runtime){const r=resolveRuntime(cap?.catalog??null,frozen.envelope.runtime,operation);runtimeReady=r.dispatchable;runtimeReason=r.dispatchable?`${r.model} / ${r.effort}`:r.reason!;}}catch(e){runtimeReason=(e as Error).message;}
  async function send() {
    if(!cap || !frozen || !fresh || confirmed!==frozen.seal || !runtimeReady)return;
    setBusy(true);setError("");
    try{await collectionRequest("prepare",cap.session,canonical(frozen.envelope));await collectionRequest("dispatch",cap.session,canonical({id:frozen.envelope.id,seal:frozen.seal}));await refresh();}
    catch(e){setError((e as Error).message);await refresh().catch(()=>{});}finally{setBusy(false);}
  }
  async function resend(record:RecordItem) {
    setResendOf(record.id);setConfirmed(null);setFrozen(null);setOperation(record.operation as "text"|"image");
    setError("Resend selected. Choose the retained browser sources, review the new collection, then explicitly send. This creates a new usage-consuming dispatch with lineage.");
  }
  const enabled=operation==="text"?cap?.textEnabled:cap?.imageEnabled;
  return <article className="runs-card collection-run" aria-label="Codex collections">
    <span className="studio-eyebrow">ONE REVIEWED COLLECTION → CODEX</span><h2>Send reviewed sources together</h2>
    <p className="runs-caption">Image generator: managed by Codex; actual version unknown. Conversation-model choice and prompt-family guidance do not select the image generator.</p>
    {cap?.evidenceLevel === "deterministic-fixture" && <p role="status">DETERMINISTIC OFFLINE FIXTURE · no real model calls or generated images.</p>}
    <p>Select up to {L.textMembers} text documents/projects or {L.imageMembers} PNG references. Text runs Decompose → Rewrite → Verify → Final internally. Images request a separate rendition of every selected reference in one task.</p>
    <div role="group" aria-label="Collection operation"><button aria-pressed={operation==="text"} onClick={()=>setOperation("text")}>Documents & projects</button><button aria-pressed={operation==="image"} onClick={()=>setOperation("image")}>Image renditions</button></div>
    <p>Selection here is explicit; queued sources are not automatically included. Precedence: source settings → enabled shared overrides → enabled per-item overrides. The shared instruction applies to every item; item requirements supplement it.</p>
    <label>Shared task instruction<textarea value={shared} maxLength={8192} onChange={e=>setShared(e.target.value)} rows={3}/></label>
    <details><summary>Shared setting overrides</summary><CollectionSettings operation={operation} value={sharedSettings} onChange={operation==="text"?setTextSettings:setImageSettings}/></details>
    {!candidates.length&&<p>Add and review sources in Text, Projects or Images, then return here.</p>}
    <ul className="collection-source-list">{candidates.map(c=><li key={c.key}>
      <label><input type="checkbox" checked={selected[c.key]??false} onChange={e=>setSelected({...selected,[c.key]:e.target.checked})}/> {c.path}</label>
      {c.reason&&<p>{c.reason}</p>}
      <label>Collection path for {c.path}<input value={paths[c.key]??c.path} onChange={e=>setPaths({...paths,[c.key]:e.target.value})} maxLength={512}/></label>
      <details><summary>Per-item overrides for {c.path}</summary><CollectionSettings operation={operation} value={overrides[c.key]??{}} inherited={sharedSettings} onChange={v=>setOverrides({...overrides,[c.key]:v})}/></details>
    </li>)}</ul>
    <RuntimePicker catalog={cap?.catalog??null} value={runtime} onChange={setRuntime} refresh={()=>void catalog()} operation={operation}/>
    {operation==="image"&&<p>Conversation model and image generator are separate. Image generator: harness-managed / unknown. Outputs and review remain in Codex.</p>}
    <p className="runs-caption">Saved prompt guidance stays with each source. Runtime selection does not rewrite it. Context/token capacity is unknown; conservative byte limits apply. Unsupported items remain available for manual export or a smaller reviewed selection.</p>
    <button className="studio-secondary" disabled={busy} onClick={()=>void build()}>{busy?"Working…":"Prepare outgoing collection"}</button>
    {frozen&&<section aria-label="Outgoing collection review"><h3>Exact outgoing review</h3>
      {!fresh&&<p role="status">Source, selection, settings or runtime changed. Prepare again and renew confirmation.</p>}
      <p>Collection {frozen.envelope.id} · revision {frozen.envelope.revision} · {frozen.envelope.members.length} items · requested runtime: {runtimeReason}</p>
      <p>Original packages/binaries are retained in local custody when sent. Text delivery sends reviewed extraction and indexed project context; original binaries and embedded assets are not attachments. Image delivery sends the exact selected PNG bytes.</p>
      {frozen.envelope.members.map((m,i)=><details key={m.id}><summary>{i+1}. {m.path} · {m.kind} · {m.reviewedBytes} reviewed bytes / {m.originalBytes} original bytes</summary>
        {m.kind==="image"&&<FrozenImage bytes={frozen.images[i]} label={`Selected reference ${i+1}: ${m.path}`}/>}
        <pre>{canonical({id:m.id,format:m.format,settings:m.settings,sourceManifest:m.sourceManifest,sourceSha256:m.sourceSha256,packageSha256:m.packageSha256,promptSha256:m.promptSha256,...(m.kind==="image"?{referenceFilename:imageReferenceName(i,m.sourceSha256)}:{}),omissions:m.omissions,expectedOutputs:m.expectedOutputs})}</pre>
        <h4>Exact canonical member prompts</h4><pre tabIndex={0}>{m.imagePrompt??canonical(m.prompts)}</pre><button onClick={()=>download(`member-${i+1}.zip`,unbase64(m.packageBase64,L.packageBytes))}>Download exact {m.path} package</button>
      </details>)}
      <details><summary>Exact outgoing {frozen.envelope.operation==="text"?"Decompose stage":"task"} prompt</summary><pre tabIndex={0}>{frozen.prompt}</pre></details>
      <p>Expected output inventory</p><ul>{frozen.envelope.expectedOutputs.map(o=><li key={o.id}>{o.id} · {o.path} · missing until returned or inspected</li>)}</ul>
      <div className="local-run-downloads"><button disabled={busy} onClick={()=>download("collection.json",canonical(frozen.envelope),"application/json")}>Download exact collection</button><button disabled={busy} onClick={()=>download("outgoing-prompt.txt",frozen.prompt,"text/plain")}>Download exact outgoing prompt</button><button disabled={busy} onClick={()=>void collectionWorkbook(frozen.envelope).then(html=>download("collection-workbook.html",html,"text/html"))}>Download standalone collection workbook</button></div>
      <label className="local-run-confirm"><input type="checkbox" checked={fresh&&confirmed===frozen.seal} disabled={!fresh||busy} onChange={e=>setConfirmed(e.target.checked?frozen.seal:null)}/> I reviewed every selected item, representation, instruction, omission, expected output and runtime. Submit this frozen collection once.</label>
      <button className="studio-primary" disabled={busy||!fresh||confirmed!==frozen.seal||!enabled||!runtimeReady} onClick={()=>void send()}>Send collection to Codex</button>
      <p>{!cap?"Use the companion's own local UI for connected execution.":!enabled?"This operation is review-only; its execution boundary is not enabled.":"An explicit send may consume usage. No per-item send or stage copying is required."}</p>
    </section>}
    {cap&&<details><summary>Local custody and retention</summary><code>{cap.location}</code><p>{cap.retention} Close the companion and preserve needed artifacts before manually removing only this owned state. Unknown starts must be inspected; do not remove claims to retry.</p></details>}
    {error&&<p role="alert">{error}</p>}
    {records.length>0&&<section aria-label="Collection history"><h3>Retained collection history</h3><button onClick={()=>void refresh().catch(e=>setError(e.message))}>Refresh history</button>{records.map(r=><details key={r.id} open><summary>{r.memberPaths.join(", ")} · {r.status}</summary>
      <p>{r.id} · {r.stageRequests}/4 text stage requests · task {r.taskId??"identity not exposed"}</p><p>Requested: {r.runtime?.model??"none"} / {r.runtime?.effort??"none"}. Exposed actual: {r.actualExecutor??"unknown"} / {r.actualModel??"unknown"} / {r.actualEffort??"unknown"}. Acceptance remains yours.</p>
      {r.error&&<p>{r.error}</p>}<ul>{r.expectedOutputs.map(o=><li key={o.id}>{o.id}: {o.status}{o.acknowledgedInTaskText?"; ID mentioned in task text (not generation proof)":""}</li>)}</ul>
      <div className="local-run-downloads">{r.artifacts.filter(a=>!a.startsWith(".")).map(a=>available.has(r.id) ? <a key={a} href={`/api/collections/artifact/${r.id}/${a}`} download>{a}</a> : <span key={a}>{a} · reconnect its companion to download</span>)}</div>
      <button onClick={()=>void resend(r)}>Prepare explicit resend with lineage</button>
    </details>)}</section>}
  </article>;
}
