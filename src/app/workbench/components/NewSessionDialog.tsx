import type { RefObject } from "react";
import { ModalShell } from "./ModalShell";

interface NewSessionDialogProps {
  open: boolean;
  onCancel(): void;
  onConfirm(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}

export function NewSessionDialog({ open, onCancel, onConfirm, returnFocusRef }: NewSessionDialogProps) {
  return <ModalShell
    open={open}
    title="Start a new session?"
    closeLabel="Close new session confirmation"
    onDismiss={onCancel}
    returnFocusRef={returnFocusRef}
    className="new-session-dialog confirm-dialog"
    initialFocus="first"
    initialFocusSelector=".dialog-actions button"
  >
    <p>Uploaded files, reviewed text, extracted assets and OCR, prompt edits, model responses, progress, and the built package will be lost unless downloaded.</p>
    <p>Your model, context limit, global rewrite settings, processing settings, and Quick Start preference will be kept.</p>
    <div className="dialog-actions">
      <button type="button" onClick={onCancel}>Cancel</button>
      <button type="button" className="danger-action" onClick={onConfirm}>Start new session</button>
    </div>
  </ModalShell>;
}
