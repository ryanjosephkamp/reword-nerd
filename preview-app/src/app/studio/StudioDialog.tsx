import { useEffect, useRef, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";
import { useWorkspaceActive } from "../platform/WorkspaceActivity";

export function StudioDialog({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
  className?: string;
}) {
  const active = useWorkspaceActive();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (active) dialog?.showModal();
    return () => dialog?.close();
  }, [active]);
  return (
    <dialog
      ref={ref}
      inert={!active}
      className={`studio-dialog ${className}`}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      aria-label={title}
    >
      <div className="studio-dialog-inner">
        <header>
          <h2>{title}</h2>
          <button
            className="studio-icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
