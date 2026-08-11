import { useEffect, useRef, type ReactNode } from "react";
import { CloseIcon } from "./Icons";
import { containModalFocus } from "./containModalFocus";

export function SettingsDrawer({ open, onClose, returnFocusRef, children }: {
  open: boolean;
  onClose(): void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);
  if (!open) return null;
  const close = () => {
    onClose();
    returnFocusRef.current?.focus();
  };
  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <aside className="settings-drawer" role="dialog" aria-modal="true" aria-label="Parameters" onKeyDown={(event) => {
      if (event.key === "Escape") close();
      else containModalFocus(event);
    }}>
      <div className="drawer-heading"><h2>PARAMETERS</h2><button type="button" aria-label="Close settings" onClick={close} ref={closeRef}><CloseIcon /></button></div>
      {children}
    </aside>
  </div>;
}
