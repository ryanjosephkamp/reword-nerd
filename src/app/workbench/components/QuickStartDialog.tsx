import type { RefObject } from "react";
import { ModalShell } from "./ModalShell";
import { DemoVideo } from "./DemoVideo";

export function QuickStartDialog({ open, onReviewSettings, onAddFiles, onDismiss, returnFocusRef }: {
  open: boolean;
  onReviewSettings(): void;
  onAddFiles(): void;
  onDismiss(): void;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
}) {
  return <ModalShell open={open} title="Quick start" closeLabel="Close quick start" onDismiss={onDismiss} returnFocusRef={returnFocusRef} className="quick-start-dialog" closePlacement="last">
      <p className="dialog-kicker">LOCAL PROMPT WORKBENCH</p>
      <p>Choose a model and rewrite settings, add a document, folder workspace, or project ZIP, review the source, then build a local prompt package.</p>
      <p><strong>One-shot</strong> runs the full workflow in one prompt. <strong>Manual</strong> exposes Decompose, Rewrite, Verify, and Final as separate prompts.</p>
      <p className="dialog-media-note">The demo clip predates project-workspace support and shows the document path. Use <strong>ADD FOLDER</strong> in Files for a folder workspace.</p>
      <div className="dialog-actions">
        <button type="button" className="primary-dialog-action" onClick={onReviewSettings}>REVIEW SETTINGS</button>
        <button type="button" onClick={onAddFiles}>ADD FILES</button>
      </div>
      <DemoVideo demo="overview" />
  </ModalShell>;
}
