import { useEffect, useRef } from "react";
import { CloseIcon } from "./Icons";
import { containModalFocus } from "./containModalFocus";

export function QuickStartDialog({ open, onReviewSettings, onAddFiles, onDismiss }: {
  open: boolean;
  onReviewSettings(): void;
  onAddFiles(): void;
  onDismiss(): void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) dialogRef.current?.focus(); }, [open]);
  if (!open) return null;
  return <div className="dialog-backdrop quick-start-backdrop">
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-start-title"
      tabIndex={-1}
      ref={dialogRef}
      className="quick-start-dialog"
      onKeyDown={(event) => {
        if (event.key === "Escape") onDismiss();
        else containModalFocus(event);
      }}
    >
      <p className="dialog-kicker">LOCAL PROMPT WORKBENCH</p>
      <h2 id="quick-start-title">Quick start</h2>
      <p>Choose a model and rewrite settings, add files, review every extraction, then build a local prompt package.</p>
      <p><strong>One-shot</strong> runs the full workflow in one prompt. <strong>Manual</strong> exposes Decompose, Rewrite, Verify, and Final as separate prompts.</p>
      <div className="dialog-actions">
        <button type="button" className="primary-dialog-action" onClick={onReviewSettings}>REVIEW SETTINGS</button>
        <button type="button" onClick={onAddFiles}>ADD FILES</button>
      </div>
      <button type="button" className="dialog-close" aria-label="Close quick start" onClick={onDismiss}><CloseIcon /></button>
    </div>
  </div>;
}
