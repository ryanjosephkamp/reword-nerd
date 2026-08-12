import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { containModalFocus } from "./containModalFocus";
import { CloseIcon } from "./Icons";

interface ModalShellProps {
  open: boolean;
  title: string;
  closeLabel: string;
  onDismiss(): void;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
  className?: string;
  initialFocus?: "dialog" | "first";
  initialFocusSelector?: string;
  closePlacement?: "first" | "last";
  variant?: "dialog" | "drawer";
  dialogId?: string;
}

export function ModalShell({ open, title, closeLabel, onDismiss, returnFocusRef, children, className = "", initialFocus = "dialog", initialFocusSelector, closePlacement = "first", variant = "dialog", dialogId }: ModalShellProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = `dialog-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  useEffect(() => {
    if (!open) return;
    if (initialFocusSelector) dialogRef.current?.querySelector<HTMLElement>(initialFocusSelector)?.focus();
    else if (initialFocus === "dialog") dialogRef.current?.focus();
    else dialogRef.current?.querySelector<HTMLElement>("button, a, input, select, textarea, video")?.focus();
  }, [initialFocus, initialFocusSelector, open]);
  if (!open) return null;
  const dismiss = () => {
    onDismiss();
    returnFocusRef?.current?.focus();
    queueMicrotask(() => returnFocusRef?.current?.focus());
  };
  const closeButton = <button type="button" className="dialog-close" aria-label={closeLabel} onClick={dismiss}><CloseIcon /></button>;
  const baseClass = variant === "drawer" ? "settings-drawer" : "help-dialog";
  return <div className={variant === "drawer" ? "drawer-backdrop" : "dialog-backdrop"} onClick={(event) => { if (event.target === event.currentTarget) dismiss(); }}>
    <div id={dialogId} ref={dialogRef} tabIndex={-1} className={`${baseClass} modal-shell ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); dismiss(); return; }
      containModalFocus(event);
    }}>
      <header className={variant === "drawer" ? "drawer-heading" : undefined}><h2 id={titleId}>{title}</h2>{closePlacement === "first" ? closeButton : null}</header>
      {children}
      {closePlacement === "last" ? closeButton : null}
    </div>
  </div>;
}
