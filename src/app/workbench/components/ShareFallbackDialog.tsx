import { useEffect, useRef } from "react";
import { CANONICAL_WORKBENCH_URL } from "../share";
import { ModalShell } from "./ModalShell";

export function ShareFallbackDialog({ open, onClose, returnFocusRef }: {
  open: boolean;
  onClose(): void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const urlRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!open) return;
    urlRef.current?.focus();
    urlRef.current?.select();
  }, [open]);
  return <ModalShell
    open={open}
    title="Share link"
    closeLabel="Close share link"
    onDismiss={onClose}
    returnFocusRef={returnFocusRef}
    initialFocusSelector="[data-share-url-input]"
    className="share-fallback-dialog"
  >
    <p>Your browser could not copy this link automatically. Select it and copy it manually.</p>
    <label htmlFor="share-url">Share URL</label>
    <textarea id="share-url" ref={urlRef} data-share-url-input readOnly value={CANONICAL_WORKBENCH_URL} />
  </ModalShell>;
}
