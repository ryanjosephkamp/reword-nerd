import { ModalShell } from "./ModalShell";

export function ResetPreferencesDialog({ open, onCancel, onConfirm, sessionOnly = false }: {
  open: boolean;
  onCancel(): void;
  onConfirm(): void;
  sessionOnly?: boolean;
}) {
  return <ModalShell open={open} title="Reset saved preferences" closeLabel="Close reset preferences" onDismiss={onCancel} className="confirm-dialog" initialFocus="first" initialFocusSelector=".dialog-actions button">
      <p>{sessionOnly ? "Reset this session's prompt guidance and settings. Earlier saved preferences remain untouched. Uploaded documents and reviewed content stay in this session." : "This clears the locally saved model, context, rewrite, processing, and tutorial preferences. Uploaded documents and current reviewed content stay in this session."}</p>
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="destructive-dialog-action" onClick={onConfirm}>RESET</button>
      </div>
  </ModalShell>;
}
