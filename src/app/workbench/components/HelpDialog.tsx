import { useEffect, useRef } from "react";
import { CloseIcon } from "./Icons";
import { containModalFocus } from "./containModalFocus";

export function HelpDialog({ open, onClose, onReplayQuickStart, returnFocusRef }: {
  open: boolean;
  onClose(): void;
  onReplayQuickStart(): void;
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
    <div role="dialog" aria-modal="true" aria-labelledby="help-title" tabIndex={-1} ref={dialogRef} className="help-dialog" onKeyDown={(event) => {
      if (event.key === "Escape") close();
      else containModalFocus(event);
    }}>
      <button type="button" className="dialog-close" aria-label="Close help" onClick={close}><CloseIcon /></button>
      <h2 id="help-title">Help and workflow guide</h2>
      <section><h3>Quick start</h3><p>Review Settings, add supported files, inspect and confirm each extraction, then build and download the package.</p></section>
      <section><h3>One-shot and Manual</h3><p>One-shot asks the model to run Decompose, Rewrite, Verify, and Final internally. Manual exposes those four prompts in order so you can inspect each response and carry it forward.</p></section>
      <section><h3>Models and context</h3><p>Select the model you will use and verify its current context limit. Context estimates are advisory; provider plans, interfaces, and limits can change.</p></section>
      <section><h3>Formats, LaTeX, images, and OCR</h3><p>TXT, Markdown, DOCX, PDF, standalone LaTeX, and LaTeX project ZIPs are supported. Embedded images are extracted by default. PDF page captures and local English OCR are opt-in, bounded, and require review.</p></section>
      <section><h3>Package and OPEN-ME</h3><p>The ZIP contains both workflow modes for every document. Open <code>OPEN-ME.html</code> first, then use the One-shot or Manual workbook. The package runs locally without external assets.</p></section>
      <section><h3>Privacy and provider limits</h3><p>Documents, extracted text, OCR, assets, prompts, model responses, and packages remain session-only unless you download them. Only validated global preferences are saved in this browser. This app does not call a model provider; you move prompts and responses yourself.</p></section>
      <section><h3>Reset saved preferences</h3><p>Use Reset saved preferences in Settings to clear the local preference key after confirmation. It does not remove uploaded documents from the current session.</p></section>
      <button type="button" className="replay-tutorial-button" onClick={onReplayQuickStart}>REPLAY QUICK START</button>
    </div>
  </div>;
}
