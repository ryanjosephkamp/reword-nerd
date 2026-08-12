import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { WorkbenchDocument } from "../contracts";
import { DocumentIcon, MoreIcon } from "./Icons";

function statusLabel(document: WorkbenchDocument): string {
  if (document.status === "ready") return "READY";
  if (document.status === "blocked" || document.status === "error") return "BLOCKED";
  if (document.status === "queued" || document.status === "extracting") return "EXTRACTING";
  return "REVIEW";
}

interface FileQueueProps {
  documents: readonly WorkbenchDocument[];
  selectedId: string | null;
  focusTarget: string | null;
  onSelect(documentId: string): void;
  onRemove(documentId: string): void;
  onFocusConsumed(): void;
}

export function FileQueue(props: FileQueueProps) {
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const menuButtons = useRef(new Map<string, HTMLButtonElement>());
  const menuRef = useRef<HTMLDivElement>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  useEffect(() => {
    if (!props.focusTarget?.startsWith("document:")) return;
    rows.current.get(props.focusTarget.slice(9))?.focus();
    props.onFocusConsumed();
  }, [props]);
  useEffect(() => {
    if (!openMenuId) return;
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !menuButtons.current.get(openMenuId)?.contains(target)) {
        setOpenMenuId(null);
      }
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      const returnFocus = menuButtons.current.get(openMenuId);
      setOpenMenuId(null);
      returnFocus?.focus();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [openMenuId]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === "ArrowDown") next = Math.min(index + 1, props.documents.length - 1);
    else if (event.key === "ArrowUp") next = Math.max(index - 1, 0);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = props.documents.length - 1;
    else return;
    event.preventDefault();
    const document = props.documents[next];
    if (document) {
      props.onSelect(document.id);
      rows.current.get(document.id)?.focus();
    }
  };

  return <div className="file-list" role="listbox" aria-label="Uploaded files">
    {props.documents.map((document, index) => {
      const status = statusLabel(document);
      return <div className={`file-row status-${status.toLowerCase()}${props.selectedId === document.id ? " is-selected" : ""}`} key={document.id}>
        <button
          type="button"
          role="option"
          aria-selected={props.selectedId === document.id}
          className="file-select"
          ref={(node) => { if (node) rows.current.set(document.id, node); else rows.current.delete(document.id); }}
          onClick={() => props.onSelect(document.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          <DocumentIcon />
          <span className="file-name">{document.name}</span>
          <span className="file-status"><span className="status-dot" />{status}</span>
        </button>
        <button
          type="button"
          className="row-menu"
          aria-label={`File actions for ${document.name}`}
          aria-haspopup="true"
          aria-expanded={openMenuId === document.id}
          ref={(node) => { if (node) menuButtons.current.set(document.id, node); else menuButtons.current.delete(document.id); }}
          onClick={() => setOpenMenuId((current) => current === document.id ? null : document.id)}
        ><MoreIcon /></button>
        {openMenuId === document.id ? <div className="file-actions-menu" aria-label={`Actions for ${document.name}`} ref={menuRef}>
          <button type="button" onClick={() => { setOpenMenuId(null); props.onRemove(document.id); }}>Remove file</button>
        </div> : null}
      </div>;
    })}
  </div>;
}
