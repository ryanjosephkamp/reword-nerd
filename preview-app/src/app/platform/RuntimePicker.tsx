import { useId, useState } from "react";
import { resolveRuntime, type RuntimeCatalog, type RuntimeChoice } from "../../collections/runtime.mjs";
import { forgetRuntimes, recentRuntimes, rememberRuntime } from "../../collections/preferences";

export function RuntimePicker({ catalog, value, onChange, refresh, operation = "text" }: {
  catalog: RuntimeCatalog | null; value: RuntimeChoice | null; onChange: (choice: RuntimeChoice | null) => void;
  refresh: () => void; operation?: "text" | "image";
}) {
  const id = useId();
  const [remember, setRemember] = useState(false), [notice, setNotice] = useState("");
  const [recent, setRecent] = useState(() => { try { return recentRuntimes(window.localStorage); } catch { return []; } });
  const model = value?.model ?? "", effort = value?.effort ?? "";
  const matches = catalog?.models.filter(m => m.id.toLowerCase() === model.toLowerCase() || m.name.toLowerCase() === model.toLowerCase()) ?? [];
  let status = "Select a model and effort before confirming. No default execution model is selected.";
  try { if (model && effort) { const r = resolveRuntime(catalog, { model, effort }, operation); status = r.dispatchable ? `Requested: ${r.model} / ${r.effort}. Catalog availability; execution identity is reported separately.` : r.reason!; } } catch (e) { status = (e as Error).message; }
  function change(next: RuntimeChoice) {
    onChange(next);
    if (remember) {
      try { const r = resolveRuntime(catalog, next, operation); if (r.dispatchable) { rememberRuntime(window.localStorage, { model: r.model, effort: r.effort }); setRecent(recentRuntimes(window.localStorage)); } } catch { /* Incomplete choice is visible and never persisted. */ }
    }
  }
  return <fieldset className="collection-runtime"><legend>Codex execution model and effort</legend>
    <label htmlFor={`${id}-model`}>Search catalog or type an identifier</label>
    <input id={`${id}-model`} list={`${id}-models`} maxLength={256} value={model} placeholder="Choose explicitly" autoComplete="off" onChange={e => change({ model: e.target.value, effort: "" })} />
    <datalist id={`${id}-models`}>{catalog?.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</datalist>
    <label htmlFor={`${id}-effort`}>Effort</label>
    {matches.length === 1 ? <select id={`${id}-effort`} value={effort} onChange={e => change({ model, effort: e.target.value })}><option value="">Choose effort</option>{matches[0].efforts.map(e => <option key={e} value={e}>{e}</option>)}</select>
      : <input id={`${id}-effort`} value={effort} maxLength={32} placeholder="Effort identifier (unverified)" onChange={e => change({ model, effort: e.target.value })} />}
    <p role="status">{status}</p>
    <p>{catalog ? `${catalog.source} · ${catalog.fetchedAt}` : "Catalog unavailable. Manual export needs no model choice."} Context capacity: unknown.</p>
    {operation === "image" && <p>Conversation model is separate from the image generator. Image model: harness-managed/unknown.</p>}
    <button type="button" className="studio-secondary" onClick={refresh}>Refresh runtime catalog</button>
    <button type="button" className="studio-secondary" onClick={() => onChange(null)}>Clear current runtime choice</button>
    <label><input type="checkbox" checked={remember} onChange={e => { setRemember(e.target.checked); if (e.target.checked && value) { try { const r = resolveRuntime(catalog, value, operation); if (r.dispatchable) { rememberRuntime(window.localStorage, { model: r.model, effort: r.effort }); setRecent(recentRuntimes(window.localStorage)); } } catch { /* Must finish a valid choice first. */ } } }} />Remember recent choices on this device</label>
    {recent.length > 0 && <label>Recent choices (revalidated)<select value="" onChange={e => { const next = recent[Number(e.target.value)]; if (next) onChange(next); }}><option value="">Recall a visible choice</option>{recent.map((r, i) => <option key={`${r.model}/${r.effort}`} value={i}>{r.model} / {r.effort}</option>)}</select></label>}
    <button type="button" className="studio-secondary" onClick={() => { forgetRuntimes(window.localStorage); setRecent([]); setRemember(false); onChange(null); setNotice("Saved runtime choices forgotten."); }}>Forget runtime preferences</button>
    {notice && <p role="status">{notice}</p>}
  </fieldset>;
}
