import type { ReactNode, RefObject } from "react";
import { ModalShell } from "./ModalShell";

export function SettingsDrawer({ open, onClose, returnFocusRef, children }: {
  open: boolean;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}) {
  return <ModalShell
    open={open}
    title="Parameters"
    closeLabel="Close settings"
    onDismiss={onClose}
    returnFocusRef={returnFocusRef}
    initialFocus="first"
    variant="drawer"
    dialogId="settings-drawer"
  >
    {children}
  </ModalShell>;
}
