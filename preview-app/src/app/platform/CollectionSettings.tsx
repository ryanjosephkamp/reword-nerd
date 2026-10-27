import { useId } from "react";
export type SettingPatch = Record<string, string | boolean>;
const textFields = { tone: ["preserve","academic","professional","technical","plain"], formality: ["preserve","standard","formal"], length: ["preserve","concise","expanded"], outputLanguage: null, customRequirements: null };
const imageFields = { aspectRatio: ["match-source","provider-default","1:1","4:3","3:4","16:9","9:16"], sizeIntent: ["match-source-where-supported","highest-practical-quality"], preserveVisibleText: ["true","false"], backgroundBehavior: ["preserve-source","provider-default"], requestedChanges: null, mustPreserve: null };
const labels: Record<string,string> = {tone:"Tone",formality:"Formality",length:"Length",outputLanguage:"Output language",customRequirements:"Custom requirements",aspectRatio:"Aspect ratio",sizeIntent:"Size intent",preserveVisibleText:"Preserve visible text",backgroundBehavior:"Background",requestedChanges:"Requested changes",mustPreserve:"Must preserve"};
export function CollectionSettings({operation, value, onChange, inherited}: {operation:"text"|"image";value:SettingPatch;onChange:(p:SettingPatch)=>void;inherited?:SettingPatch}) {
  const id=useId();
  return <div className="collection-settings">{Object.entries(operation==="text"?textFields:imageFields).map(([key,choices])=>{
    const active=Object.hasOwn(value,key), current=value[key] ?? inherited?.[key] ?? choices?.[0] ?? "";
    const change=(next:string)=>onChange({...value,[key]:key==="preserveVisibleText"?next==="true":next});
    return <div key={key}><label><input type="checkbox" checked={active} onChange={e=>{const next={...value};if(e.target.checked)next[key]=key==="preserveVisibleText"?String(current)==="true":current;else delete next[key];onChange(next);}} /> Override {labels[key]}</label>
      <label className="sr-only" htmlFor={`${id}-${key}`}>{labels[key]}</label>{choices ? <select id={`${id}-${key}`} disabled={!active} value={String(current)} onChange={e=>change(e.target.value)}>{choices.map(v=><option key={v}>{v}</option>)}</select> : <textarea id={`${id}-${key}`} disabled={!active} value={String(current)} maxLength={key==="outputLanguage"?1024:2000} rows={2} onChange={e=>change(e.target.value)} />}
    </div>;
  })}</div>;
}
