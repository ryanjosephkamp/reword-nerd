import { useWorkspaceState } from '../../../workspace/Workspace';
import {ReviewDecisions} from "./ReviewDecisions";
import {useEffect,useRef,useState} from 'react';
import {DownloadSimple,FileZip,ShieldCheck,X,LinkSimple} from '@phosphor-icons/react';
import type {ImagePortalState} from '../../../image/reducer';
import {addReview,importReview,type ReviewEntry} from './importReview';
import {associationCandidate,associationIsCurrent,type ReviewAssociation} from './association';
import './reviews.css';
function download(bytes:Uint8Array,name:string,type:string){
 const url=URL.createObjectURL(new Blob([Uint8Array.from(bytes)],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function ExactImage({bytes,alt}:{bytes:Uint8Array;alt:string}){
 const ref=useRef<HTMLImageElement>(null);
 useEffect(()=>{const url=URL.createObjectURL(new Blob([Uint8Array.from(bytes)],{type:'image/png'}));const node=ref.current;if(node)node.src=url;return()=>{if(node)node.removeAttribute('src');URL.revokeObjectURL(url);};},[bytes]);
 return <img ref={ref} alt={alt}/>;
}
export function ReviewDetail({entry,imageState,onRemove,removeDisabled=false}:{entry:ReviewEntry;imageState:ImagePortalState|null;onRemove:()=>void;removeDisabled?:boolean}){
 const {registration:r,checked,files}=entry.review;
 const [association,setAssociation]=useWorkspaceState<ReviewAssociation|null>(`review:${entry.review.registration.registrationId}:association`, null);
 const candidate=associationCandidate(entry.review,imageState);
 const linked=association&&associationIsCurrent(association,candidate.binding);
 const raw=files.get('returned.png')!,reference=files.get('reference.png')!;
 return <article className="runs-card imported-review" aria-label="Imported image review">
  <header className="review-title"><div><span className="studio-eyebrow">IMPORTED EVIDENCE · ORIGINAL RECORD</span><h2>{checked.pkg.displayName}</h2></div><button className="review-button" disabled={removeDisabled} onClick={onRemove} aria-label="Remove this imported review"><X size={16}/> Remove review</button></header>
  <p className="review-status"><ShieldCheck size={18}/> Package consistency checked · original registration awaits review</p>
  <div className="review-comparison"><figure><ExactImage bytes={reference} alt="Original reference image"/><figcaption>Original reference <small>{checked.pkg.manifest.pairs[0].source.width} × {checked.pkg.manifest.pairs[0].source.height}</small></figcaption><button className="review-button" onClick={()=>download(reference,'original-reference.png','image/png')}><DownloadSimple/> Download reference</button></figure><figure><ExactImage bytes={raw} alt="Retained host-generated image, not accepted"/><figcaption>Retained host output <small>{r.output.width} × {r.output.height}</small></figcaption><button className="review-button" onClick={()=>download(raw,'retained-output.png','image/png')}><DownloadSimple/> Download exact output</button></figure></div>
  <p className="runs-caption">Original PNG bytes, including opaque caBX metadata, are preserved. Checksums establish consistency, not authorship. Import does not accept a result or replace a source.</p>
  <div className="review-history"><section><span className="studio-eyebrow">01 / ORIGINAL GENERATION</span><h3>Earlier host call</h3><p>{r.originalExecutor.executor} / {r.originalExecutor.tool ?? 'Tool unknown'}</p><p>Model / version: {r.originalExecutor.model ?? 'not exposed'}</p></section><section><span className="studio-eyebrow">02 / HISTORICAL VALIDATION</span><h3>Failed · preserved</h3><p>{checked.current.reason}</p></section><section><span className="studio-eyebrow">03 / OFFLINE REGISTRATION</span><h3>Awaiting user review</h3><p>{r.localAction.validator}</p><p>New model calls: 0 · accepted by user: false</p></section></div>
  <section className="review-association" aria-label="Source association"><h3><LinkSimple size={18}/> Associate with selected image</h3><p>{candidate.reason}</p>{association&&<p role="status">{linked?'Associated with the matching in-memory image. No bytes were replaced.':'Previous association is stale: the image selection, review or package changed. No current association is asserted.'}</p>}<button className="review-button" disabled={!candidate.binding||Boolean(linked)} onClick={()=>{if(candidate.binding)setAssociation(candidate.binding);}}>{linked?'Associated':'Associate selected image'}</button>{association&&<button className="review-button" onClick={()=>setAssociation(null)}>Remove association</button>}</section>
  <ReviewDecisions entry={entry} association={association?{status:linked?"matching-at-action":"stale-at-action",selection:association}:{status:"not-associated",selection:null}}/>
  <details><summary>Run details and original history</summary><dl className="review-metadata">{Object.entries({Registration:r.registrationId,'Origin job':r.origin.jobId,'Origin ticket':r.origin.ticketId,'Bundle SHA-256':entry.bundleHash,'Package SHA-256':r.origin.packageSha256,'Reference SHA-256':r.origin.referenceSha256,'Prompt SHA-256':r.origin.promptSha256,'Output SHA-256':r.output.sha256,'Output byte length':r.output.byteLength,'Registration time':r.createdAt}).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>{checked.state.attempts.map(a=><p key={a.ticket.ticketId}>Attempt {a.ticket.attempt} / revision {a.ticket.revision}: {a.status} — {a.reason ?? 'No failure reason'}</p>)}</details>
  <details><summary>Exact prepared prompt</summary><pre>{checked.pkg.prompt}</pre></details>
  <details><summary>Saved configuration · does not authenticate a provider</summary><pre>{JSON.stringify(checked.pkg.configuration,null,2)}</pre></details>
  <details><summary>Artifact inventory ({r.artifacts.length + 4} files)</summary><ul className="review-inventory">{entry.review.manifest.artifacts.map(a=><li key={a.path}><strong>{a.path}</strong><span>{a.byteLength} bytes</span><code>{a.sha256}</code></li>)}</ul><p>Imported review.html is validated as bytes. It is never rendered or executed here.</p></details>
  <div className="review-downloads"><button className="review-button" onClick={()=>download(entry.bundle,'retained-image-review.zip','application/zip')}><FileZip size={17}/> Download original review ZIP</button><button className="review-button" onClick={()=>download(files.get('audit.json')!,'retained-audit.json','application/json')}>Download audit</button><button className="review-button" onClick={()=>download(files.get('host-output-receipt.json')!,'original-host-receipt.json','application/json')}>Download original receipt</button></div>
 </article>;
}
export function ReviewImports({imageState}:{imageState:ImagePortalState|null}){
 const [entries,setEntries]=useWorkspaceState<readonly ReviewEntry[]>("review:entries", []),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const controller=useRef<AbortController|null>(null),input=useRef<HTMLInputElement>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 const select=async(file:File)=>{
  if(controller.current)return;
  const run=new AbortController();controller.current=run;setBusy(true);setError('');setMessage('Checking ZIP structure, original bindings and exact artifacts…');
  try{const entry=await importReview(file,run.signal);const next=addReview(entries,entry);setEntries(next.entries);setMessage(next.duplicate?'This exact review is already imported. Existing review state was preserved.':'Review imported. No source was associated or accepted.');}
  catch(e){setMessage('');setError(e instanceof Error?e.message:'Import failed.');}
  finally{controller.current=null;setBusy(false);}
 };
 return <section className="review-imports" aria-labelledby="review-import-heading"><article className="runs-card review-intake"><span className="studio-eyebrow">PORTABLE IMAGE REVIEW</span><h2 id="review-import-heading">Inspect a retained result.</h2><p>Select an exported v1 review ZIP. Validation runs locally in this browser; no CLI directory access or model call is involved.</p><input ref={input} aria-label="Select portable image review ZIP" type="file" accept=".zip,application/zip" disabled={busy} onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(file)void select(file);}}/><p className="runs-caption">Up to 64 MiB per ZIP; 96 MiB expanded, 32 entries. At most three imported reviews and 96 MiB of retained ZIP/artifact bytes in this tab. PNG and metadata bounds are unchanged. Enable workspace remembering to recover this collection after reload.</p>{busy&&<button className="review-button" onClick={()=>controller.current?.abort()}>Cancel import</button>}<p role="status" aria-live="polite">{message}</p>{error&&<p role="alert" className="review-error">{error}</p>}</article>{entries.map(entry=><ReviewDetail key={entry.review.registration.registrationId} entry={entry} imageState={imageState} removeDisabled={busy} onRemove={()=>{if(busy)return;setEntries(current=>current.filter(e=>e!==entry));setMessage('Imported review removed. Image sources and other workflows are unchanged.');input.current?.focus();}}/>)}</section>;
}
