import { useMemo, useRef, type UIEvent } from "react";
import type { WorkbenchDocument } from "../contracts";
import { ChevronIcon, CloseIcon, DocumentIcon } from "./Icons";
import { ReviewNotice } from "./ReviewNotice";

interface EditorProps {
  document?: WorkbenchDocument;
  hashPending: boolean;
  onEdit(text: string): void;
  onConfirm(): void;
  onRemove(): void;
  onRetry(): void;
  onRevealFiles(): void;
}

export function ExtractedTextEditor({ document, hashPending, onEdit, onConfirm, onRemove, onRetry, onRevealFiles }: EditorProps) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => (document?.extractedText ?? "").split("\n"), [document?.extractedText]);
  const onScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
  };
  if (!document) return <div className="editor-empty" aria-label="No selected file">Start with files</div>;
  const blocked = document.status === "blocked" || document.status === "error";
  const extracting = document.status === "queued" || document.status === "extracting";
  const blank = document.extractedText.trim().length === 0;
  const validationId = `extracted-text-error-${document.id}`;
  const words = document.extractedText.trim() ? document.extractedText.trim().split(/\s+/u).length : 0;
  const characters = Array.from(document.extractedText).length;
  return <>
    <div className="selected-file-control">
      <button type="button" className="selected-file-button" aria-label={`Selected file ${document.name}`} onClick={onRevealFiles}>
        <DocumentIcon />
        <span>{document.name}</span>
        <span className={`selected-status status-${document.status}`}>{document.status === "ready" ? "READY" : blocked ? "BLOCKED" : "REVIEW"}</span>
        <ChevronIcon className="mobile-only-icon" />
      </button>
      <button type="button" aria-label={`Remove ${document.name}`} onClick={onRemove}><CloseIcon /></button>
    </div>
    <ReviewNotice visible={document.requiresReview && !blocked && !extracting} />
    {document.warnings.length > 0 ? <section className="extraction-warnings" aria-label={`Extraction warnings for ${document.name}`}>
      <h3>EXTRACTION WARNINGS</h3>
      <ul>{document.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>
    </section> : null}
    {blocked ? <div className="blocked-document">
      <p role="alert">{document.safeErrorMessage}</p>
      <div><button type="button" onClick={onRetry}>Retry extraction</button><button type="button" onClick={onRemove}>Remove file</button></div>
    </div> : extracting ? <div className="extraction-progress" role="status">Extracting text from {document.name}…</div> : <>
      <div className="editor-frame">
        <div className="line-numbers" ref={gutterRef} aria-hidden="true">{lines.map((_, index) => <span key={index}>{index + 1}</span>)}</div>
        <textarea
          aria-label={`Extracted text for ${document.name}`}
          aria-invalid={blank || undefined}
          aria-describedby={blank ? validationId : undefined}
          value={document.extractedText}
          onChange={(event) => onEdit(event.currentTarget.value)}
          onScroll={onScroll}
          spellCheck={false}
        />
      </div>
      {blank ? <p className="editor-validation" id={validationId} role="alert">Extracted text cannot be blank. Add text or remove the file.</p> : null}
      <div className="review-actions">
        <div className="editor-metrics"><span>WORDS: {words}</span><span>CHARS: {characters}</span><span>LINES: {lines.length}</span></div>
        <button type="button" onClick={onConfirm} disabled={blank || hashPending || !document.requiresReview}>Confirm review</button>
        {document.status === "ready" ? <span className="ready-text">Review complete</span> : null}
      </div>
    </>}
  </>;
}
