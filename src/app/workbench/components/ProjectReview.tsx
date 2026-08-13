import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectClassification, ProjectEntry, WorkspaceProject } from "../../../domain";
import { previewObjectUrls } from "../objectUrlRegistry";

interface ProjectReviewProps {
  project: WorkspaceProject;
  onSelect(path: string): void;
  onEdit(path: string, text: string): void;
  onInclusion(path: string, promptIncluded: boolean, packageIncluded: boolean): void;
  onClassification(classification: ProjectClassification, rootDocument: string | null): void;
  onConfirm(): void;
}

function entryStatus(entry: ProjectEntry): string {
  if (entry.promptIncluded) return "PROMPT";
  if (entry.packageIncluded) return "PACKAGE";
  return "EXCLUDED";
}

const rasterMimeByExtension: Readonly<Record<string, string>> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
};

function StaticAssetPreview({ entry }: { entry: ProjectEntry }) {
  const extension = entry.path.slice(entry.path.lastIndexOf(".")).toLowerCase();
  const mimeType = rasterMimeByExtension[extension];
  const [lease, setLease] = useState<ReturnType<typeof previewObjectUrls.acquire> | null>(null);
  useEffect(() => {
    if (!mimeType) return;
    let active = true;
    const next = previewObjectUrls.acquire(`${entry.originalHash}:${mimeType}`, entry.originalBytes, mimeType);
    queueMicrotask(() => {
      if (active) setLease(next);
    });
    return () => {
      active = false;
      next.release();
    };
  }, [entry.originalBytes, entry.originalHash, mimeType]);
  if (!mimeType) return <p>Static binary asset metadata only. This format is not rendered in the browser preview.</p>;
  return lease ? <img className="project-static-asset" src={lease.url} alt={`Static preview of ${entry.path}`} /> : null;
}

function ProjectTextEditor({ entry, onEdit, onDirtyChange }: {
  entry: ProjectEntry;
  onEdit(path: string, text: string): void;
  onDirtyChange(dirty: boolean): void;
}) {
  const [draft, setDraft] = useState(entry.reviewedText ?? "");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submittedRef = useRef(entry.reviewedText ?? "");
  useEffect(() => {
    if ((entry.reviewedText ?? "") === submittedRef.current) onDirtyChange(false);
  }, [entry.reviewedText, onDirtyChange]);
  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
  }, []);
  const submit = useCallback((value: string) => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (submittedRef.current === value) return;
    submittedRef.current = value;
    onEdit(entry.path, value);
  }, [entry.path, onEdit]);
  return <textarea
    aria-label={`Reviewed text for ${entry.path}`}
    spellCheck={false}
    value={draft}
    onBlur={() => submit(draft)}
    onChange={(event) => {
      const value = event.currentTarget.value;
      setDraft(value);
      onDirtyChange(value !== (entry.reviewedText ?? ""));
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => submit(value), 120);
    }}
  />;
}

function ProjectReviewContent({ project, onSelect, onEdit, onInclusion, onClassification, onConfirm }: ProjectReviewProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "included" | "excluded">("all");
  const [browserOpen, setBrowserOpen] = useState(false);
  const [classificationDraft, setClassificationDraft] = useState<ProjectClassification | "">(
    project.classificationChoiceRequired ? "" : project.classification,
  );
  const [editorDirty, setEditorDirty] = useState(false);
  const entries = useMemo(() => project.entries.filter((entry) => entry.path.toLocaleLowerCase().includes(query.toLocaleLowerCase())
    && (filter === "all" || (filter === "included" ? entry.promptIncluded || entry.packageIncluded : !entry.promptIncluded && !entry.packageIncluded))), [filter, project.entries, query]);
  const selected = project.entries.find((entry) => entry.path === project.selectedEntryPath) ?? project.entries[0];
  const latexRoots = project.entries.filter((entry) => entry.contentKind === "text"
    && entry.promptIncluded && entry.packageIncluded && /\.(?:tex|ltx)$/iu.test(entry.path));
  const canConfirm = !editorDirty && !project.classificationChoiceRequired && project.entries.every((entry) => !entry.promptIncluded || (entry.contentKind === "text" && Boolean(entry.reviewedText?.trim())));
  return <div className="project-review">
    <button type="button" className="project-mobile-file-picker" aria-label="Choose project file" aria-expanded={browserOpen} onClick={() => setBrowserOpen((open) => !open)}>{selected?.path ?? "Choose project file"}</button>
    <aside className={`project-file-browser${browserOpen ? " is-open" : ""}`}>
      <label>SEARCH PROJECT<input type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} /></label>
      <label>FILTER<select value={filter} onChange={(event) => setFilter(event.currentTarget.value as typeof filter)}><option value="all">All files</option><option value="included">Included</option><option value="excluded">Excluded</option></select></label>
      <div role="list" aria-label="Project files">{entries.map((entry) => <button key={entry.path} className="project-file-entry" type="button" aria-current={entry.path === selected?.path ? "true" : undefined} onClick={() => { onSelect(entry.path); setBrowserOpen(false); }}><span>{entry.path}</span><small>{entryStatus(entry)}</small></button>)}</div>
    </aside>
    {selected ? <section className="project-entry-review" aria-label={`Review ${selected.path}`}>
      <header><strong>{selected.immutablePath}</strong><span>IMMUTABLE PATH</span></header>
      {project.classificationChoices.length > 1 ? <div className="project-classification">
        <label>PROJECT CLASSIFICATION<select aria-label="Project classification" value={classificationDraft} onChange={(event) => {
          const classification = event.currentTarget.value as ProjectClassification;
          setClassificationDraft(classification);
          if (classification === "general-text") onClassification(classification, null);
        }}>
          {project.classificationChoiceRequired ? <option value="">Choose classification</option> : null}
          {project.classificationChoices.map((classification) => <option key={classification} value={classification}>{classification === "latex" ? "LaTeX project" : "General text project"}</option>)}
        </select></label>
        {classificationDraft === "latex" ? <label>ROOT DOCUMENT<select aria-label="LaTeX root document" value={project.rootDocument ?? ""} onChange={(event) => {
          if (event.currentTarget.value) onClassification("latex", event.currentTarget.value);
        }}><option value="">Choose root document</option>{latexRoots.map((entry) => <option key={entry.path} value={entry.path}>{entry.path}</option>)}</select></label> : null}
      </div> : null}
      <div className="project-entry-inclusion">
        <label><input type="checkbox" checked={selected.promptIncluded} disabled={selected.contentKind !== "text"} onChange={(event) => onInclusion(selected.path, event.currentTarget.checked, event.currentTarget.checked || selected.packageIncluded)} />Include in prompt</label>
        <label><input type="checkbox" checked={selected.packageIncluded} onChange={(event) => onInclusion(selected.path, selected.promptIncluded && event.currentTarget.checked, event.currentTarget.checked)} />Include in package</label>
      </div>
      {selected.contentKind === "text" ? <ProjectTextEditor key={selected.path} entry={selected} onEdit={onEdit} onDirtyChange={setEditorDirty} /> : <div className="project-asset-preview"><p>Safe static asset. It can be retained in the package but is never prompt text or executable content.</p><StaticAssetPreview key={selected.originalHash} entry={selected} /></div>}
      <button type="button" className="confirm-project-review" disabled={!canConfirm} onClick={onConfirm}>Confirm project review</button>
    </section> : null}
  </div>;
}

export function ProjectReview(props: ProjectReviewProps) {
  const classificationIdentity = `${props.project.id}:${props.project.classificationChoiceRequired}:${props.project.classification}:${props.project.rootDocument ?? ""}`;
  return <ProjectReviewContent key={classificationIdentity} {...props} />;
}
