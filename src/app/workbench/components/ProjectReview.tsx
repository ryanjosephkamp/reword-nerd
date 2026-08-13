import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectClassification, ProjectEntry, WorkspaceProject } from "../../../domain";
import { previewObjectUrls } from "../objectUrlRegistry";

interface ProjectReviewProps {
  project: WorkspaceProject;
  onSelect(path: string): void;
  onMutationIntent?(project: WorkspaceProject): number;
  onEdit(path: string, text: string, mutationTicket?: number): void | Promise<void>;
  onInclusion(path: string, promptIncluded: boolean, packageIncluded: boolean, mutationTicket?: number): void;
  onClassification(classification: ProjectClassification, rootDocument: string | null, mutationTicket?: number): void;
  onConfirm(mutationTicket?: number): void;
}

function entryStatus(entry: ProjectEntry): string {
  if (entry.exclusionReason === "prompt-limit") return "PROMPT LIMIT";
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
  onEdit(path: string, text: string, mutationTicket?: number): void | Promise<void>;
  onDirtyChange(dirty: boolean, mutationTicket?: number): number | undefined;
}) {
  const [draft, setDraft] = useState(entry.reviewedText ?? "");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submittedRef = useRef(entry.reviewedText ?? "");
  const draftRef = useRef(entry.reviewedText ?? "");
  const pathRef = useRef(entry.path);
  const onEditRef = useRef(onEdit);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const latestTicketRef = useRef<number | undefined>(undefined);
  const inFlightRef = useRef<Readonly<{ ticket?: number; value: string }> | null>(null);
  useEffect(() => { onEditRef.current = onEdit; }, [onEdit]);
  useEffect(() => { onDirtyChangeRef.current = onDirtyChange; }, [onDirtyChange]);
  const submitDraft = useCallback((value: string, mutationTicket = latestTicketRef.current) => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (submittedRef.current === value) return;
    const activeSubmission = inFlightRef.current;
    if (activeSubmission && activeSubmission.ticket === mutationTicket && activeSubmission.value === value) return;
    inFlightRef.current = { ticket: mutationTicket, value };
    let result: void | Promise<void>;
    try {
      result = onEditRef.current(pathRef.current, value, mutationTicket);
    } catch {
      inFlightRef.current = null;
      return;
    }
    void Promise.resolve(result).then(() => {
      const completedSubmission = inFlightRef.current;
      if (completedSubmission && completedSubmission.ticket === mutationTicket && completedSubmission.value === value) {
        inFlightRef.current = null;
      }
      submittedRef.current = value;
      if (latestTicketRef.current === mutationTicket) onDirtyChangeRef.current(false, mutationTicket);
    }).catch(() => {
      const failedSubmission = inFlightRef.current;
      if (failedSubmission && failedSubmission.ticket === mutationTicket && failedSubmission.value === value) {
        inFlightRef.current = null;
      }
    });
  }, []);
  const submit = useCallback((value: string) => {
    submitDraft(value, latestTicketRef.current);
  }, [submitDraft]);
  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    submitDraft(draftRef.current);
  }, [submitDraft]);
  return <textarea
    aria-label={`Reviewed text for ${entry.path}`}
    spellCheck={false}
    value={draft}
    onBlur={() => submit(draft)}
    onChange={(event) => {
      const value = event.currentTarget.value;
      draftRef.current = value;
      setDraft(value);
      const ticket = onDirtyChange(true);
      latestTicketRef.current = ticket;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => submitDraft(value, ticket), 120);
    }}
  />;
}

function ProjectReviewContent({ project, onSelect, onMutationIntent, onEdit, onInclusion, onClassification, onConfirm }: ProjectReviewProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "included" | "excluded">("all");
  const [browserOpen, setBrowserOpen] = useState(false);
  const [classificationDraft, setClassificationDraft] = useState<ProjectClassification | "">(
    project.classificationChoiceRequired ? "" : project.classification,
  );
  const [dirtyState, setDirtyState] = useState<{ revision: number; dirty: boolean }>({
    revision: project.projectReviewRevision,
    dirty: false,
  });
  const editorDirty = dirtyState.revision === project.projectReviewRevision && dirtyState.dirty;
  const latestEditorTicketRef = useRef<number | undefined>(undefined);
  const handleEditorDirty = useCallback((dirty: boolean, settledTicket?: number) => {
    if (dirty) {
      const ticket = onMutationIntent?.(project);
      latestEditorTicketRef.current = ticket;
      setDirtyState({ revision: project.projectReviewRevision, dirty: true });
      return ticket;
    }
    if (settledTicket === latestEditorTicketRef.current) {
      setDirtyState({ revision: project.projectReviewRevision, dirty: false });
    }
    return settledTicket;
  }, [onMutationIntent, project]);
  const mutationTicket = () => onMutationIntent?.(project);
  const entries = useMemo(() => project.entries.filter((entry) => entry.path.toLocaleLowerCase().includes(query.toLocaleLowerCase())
    && (filter === "all" || (filter === "included" ? entry.promptIncluded : !entry.promptIncluded))), [filter, project.entries, query]);
  const selected = project.entries.find((entry) => entry.path === project.selectedEntryPath) ?? project.entries[0];
  const latexRoots = project.entries.filter((entry) => entry.contentKind === "text"
    && entry.promptIncluded && entry.packageIncluded && /\.(?:tex|ltx)$/iu.test(entry.path));
  const canConfirm = !editorDirty && !project.classificationChoiceRequired && project.entries.every((entry) => !entry.promptIncluded || (entry.contentKind === "text" && Boolean(entry.reviewedText?.trim())));
  const promptLimitCount = project.entries.filter((entry) => entry.exclusionReason === "prompt-limit").length;
  return <div className="project-review">
    <button type="button" className="project-mobile-file-picker" aria-label="Choose project file" aria-expanded={browserOpen} onClick={() => setBrowserOpen((open) => !open)}>{selected?.path ?? "Choose project file"}</button>
    {promptLimitCount > 0 ? <p className="project-scope-reduction" role="status">{promptLimitCount} {promptLimitCount === 1 ? "file was" : "files were"} excluded from prompt scope by the 250-file / 5 MiB safety cap. Review the reduced scope before confirming.</p> : null}
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
          if (classification === "general-text") onClassification(classification, null, mutationTicket());
        }}>
          {project.classificationChoiceRequired ? <option value="">Choose classification</option> : null}
          {project.classificationChoices.map((classification) => <option key={classification} value={classification}>{classification === "latex" ? "LaTeX project" : "General text project"}</option>)}
        </select></label>
        {classificationDraft === "latex" ? <label>ROOT DOCUMENT<select aria-label="LaTeX root document" value={project.rootDocument ?? ""} onChange={(event) => {
          if (event.currentTarget.value) onClassification("latex", event.currentTarget.value, mutationTicket());
        }}><option value="">Choose root document</option>{latexRoots.map((entry) => <option key={entry.path} value={entry.path}>{entry.path}</option>)}</select></label> : null}
      </div> : null}
      <div className="project-entry-inclusion">
        <label><input type="checkbox" checked={selected.promptIncluded} disabled={selected.contentKind !== "text"} onChange={(event) => onInclusion(selected.path, event.currentTarget.checked, event.currentTarget.checked || selected.packageIncluded, mutationTicket())} />Include in prompt</label>
        <label><input type="checkbox" checked={selected.packageIncluded} onChange={(event) => onInclusion(selected.path, selected.promptIncluded && event.currentTarget.checked, event.currentTarget.checked, mutationTicket())} />Include in package</label>
      </div>
      {selected.contentKind === "text" ? <ProjectTextEditor key={selected.path} entry={selected} onEdit={onEdit} onDirtyChange={handleEditorDirty} /> : <div className="project-asset-preview"><p>Safe static asset. It can be retained in the package but is never prompt text or executable content.</p><StaticAssetPreview key={selected.originalHash} entry={selected} /></div>}
      <button type="button" className="confirm-project-review" disabled={!canConfirm} onClick={() => onConfirm(mutationTicket())}>Confirm project review</button>
    </section> : null}
  </div>;
}

export function ProjectReview(props: ProjectReviewProps) {
  const classificationIdentity = `${props.project.id}:${props.project.classificationChoiceRequired}:${props.project.classification}:${props.project.rootDocument ?? ""}`;
  return <ProjectReviewContent key={classificationIdentity} {...props} />;
}
