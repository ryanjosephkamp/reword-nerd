import { useEffect, useRef } from "react";
import { containModalFocus } from "./containModalFocus";

export function ResetPreferencesDialog({ open, onCancel, onConfirm }: {
  open: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) cancelRef.current?.focus(); }, [open]);
  if (!open) return null;
  return <div className="dialog-backdrop">
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-preferences-title"
      className="confirm-dialog"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
        else containModalFocus(event);
      }}
    >
      <h2 id="reset-preferences-title">Reset saved preferences</h2>
      <p>This clears the locally saved model, context, rewrite, processing, and tutorial preferences. Uploaded documents and current reviewed content stay in this session.</p>
      <div className="dialog-actions">
        <button type="button" onClick={onCancel} ref={cancelRef}>Cancel</button>
        <button type="button" className="destructive-dialog-action" onClick={onConfirm}>RESET</button>
      </div>
    </div>
  </div>;
}
