import { X } from "@phosphor-icons/react";
import { useEffect, useRef, type ReactNode } from "react";

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

/** A modal built on <dialog>, which handles focus trapping and Escape natively. */
export function Dialog({ open, title, onClose, children, wide }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={wide ? "dialog dialog-wide" : "dialog"}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-body">
        <header className="dialog-header">
          <h2 id="dialog-title">{title}</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            <X aria-hidden />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
