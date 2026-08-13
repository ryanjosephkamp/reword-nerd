import { useState } from "react";
import { DemoVideo, type DemoVideoId } from "./DemoVideo";
import { ModalShell } from "./ModalShell";

const chapters = [
  { id: "settings" as const, title: "Settings", description: "Choose a model profile, verify its context limit, set rewrite preferences, and decide which local processing and code-rewrite options the source needs." },
  { id: "review" as const, title: "Review", description: "Inspect the extracted text or ORIGINAL view. For a project, choose the prompt and package files, review editable text, and confirm the complete workspace." },
  { id: "package" as const, title: "Package", description: "Build locally, read the Runbook, use either workflow, save progress, and explicitly download the ZIP." },
] as const;

export function HelpDialog({ open, onClose, onReplayQuickStart, returnFocusRef }: {
  open: boolean;
  onClose(): void;
  onReplayQuickStart(): void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const [activeChapter, setActiveChapter] = useState<DemoVideoId | null>(null);
  const close = () => {
    setActiveChapter(null);
    onClose();
  };
  const replay = () => {
    setActiveChapter(null);
    onReplayQuickStart();
  };
  return <ModalShell open={open} title="Help and workflow guide" closeLabel="Close help" onDismiss={close} returnFocusRef={returnFocusRef}>
    <p>reword-nerd turns reviewed documents and safe text projects into local, inspectable prompt packages. Follow these three chapters or replay the complete Quick Start.</p>
    <p className="dialog-media-note">The demo clips predate project-workspace support and show only the document workflow. The written guide below describes the current workflow.</p>
    <div className="help-chapter-list">
      {chapters.map((chapter) => <section key={chapter.id}>
        <h3>{chapter.title}</h3>
        <p>{chapter.description}</p>
        <button
          type="button"
          aria-expanded={activeChapter === chapter.id}
          aria-controls={`help-demo-${chapter.id}`}
          onClick={() => setActiveChapter((current) => current === chapter.id ? null : chapter.id)}
        >{activeChapter === chapter.id ? "HIDE DEMO" : `WATCH ${chapter.title.toUpperCase()} DEMO`}</button>
        {activeChapter === chapter.id ? <div id={`help-demo-${chapter.id}`}><DemoVideo demo={chapter.id} /></div> : null}
      </section>)}
    </div>
    <section><h3>One-shot and Manual</h3><p>One-shot runs Decompose, Rewrite, Verify, and Final inside one long prompt. Manual exposes those four prompts in order for stage-by-stage review.</p></section>
    <section><h3>Formats and privacy</h3><p>Documents plus safe UTF-8 text, code, structured data, and folder or ZIP project workspaces are supported. Unknown or extensionless files must pass strict UTF-8 and binary-safety checks. The app does not call a model provider. Sources, OCR, assets, prompts, and packages stay in this browser unless you download them; only validated preferences are saved.</p></section>
    <section><h3>Code and project safeguards</h3><p>Project intake drops likely secrets before retention, honors configured ignore rules, and keeps excluded files visible without silently adding them to prompts. Generated instructions protect executable syntax and ask for changed text files only. reword-nerd never executes, compiles, or tests uploaded code, so inspect every diff and run your normal checks after applying model output.</p></section>
    <section><h3>Reset or restart</h3><p>New session clears current documents and progress while keeping Settings. Reset saved preferences clears the browser preference record while leaving current documents in place.</p></section>
    <button type="button" className="replay-tutorial-button" onClick={replay}>REPLAY QUICK START</button>
  </ModalShell>;
}
