import { useEffect, useRef } from "react";
import { CloseIcon } from "./Icons";
import { containModalFocus } from "./containModalFocus";

export function HelpDialog({ open, onClose, returnFocusRef }: {
  open: boolean;
  onClose(): void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) dialogRef.current?.focus(); }, [open]);
  if (!open) return null;
  const close = () => {
    onClose();
    returnFocusRef.current?.focus();
  };
  return <div className="dialog-backdrop">
    <div role="dialog" aria-modal="true" aria-label="Four-stage package" tabIndex={-1} ref={dialogRef} className="help-dialog" onKeyDown={(event) => {
      if (event.key === "Escape") close();
      else containModalFocus(event);
    }}>
      <button type="button" aria-label="Close help" onClick={close}><CloseIcon /></button>
      <p>Four-stage package: run the prompts in order and carry each response forward.</p>
      <ol><li>Decompose</li><li>Rewrite</li><li>Verify</li><li>Final</li></ol>
    </div>
  </div>;
}
