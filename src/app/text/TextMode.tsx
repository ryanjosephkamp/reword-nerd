import { Files, PaperPlaneTilt, TextAa } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { DropZone } from "../../ui/DropZone";
import { WorkspaceLayout } from "../shared/WorkspaceLayout";
import { useWorkspace } from "../store";
import { AddButtons } from "./AddButtons";
import { DocumentView } from "./DocumentView";
import { FileList } from "./FileList";
import { HandoffPanel } from "./HandoffPanel";
import { JobPanel } from "./JobPanel";
import { ResultView } from "./ResultView";
import { useAddText } from "./useAddText";

type MobilePane = "files" | "document" | "handoff";

function EmptyState() {
  const { addSample } = useAddText();
  return (
    <div className="empty">
      <p className="eyebrow">Text</p>
      <h1 className="empty-title">
        Rewrite anything,
        <br />
        <em>with the model you already use.</em>
      </h1>
      <p className="empty-lede">
        Add a document, a folder of files, or a project. Check what reword_nerd read, choose how it
        should sound, then hand it to Claude Code, Codex, ChatGPT, or any model in one paste. Or
        edit it yourself and download it as Word, PDF, or a web page.
      </p>
      <AddButtons />
      <p className="muted small">
        Or drop files anywhere on this page.{" "}
        <button type="button" className="link-button" onClick={() => void addSample()}>
          Try a sample document
        </button>
      </p>
      <p className="muted small empty-formats">
        Word, PDF, Markdown, HTML, LaTeX, plain text, CSV, JSON, YAML, and most code. Files never
        leave your browser.
      </p>
    </div>
  );
}

export default function TextMode() {
  const { add } = useAddText();
  const hasSources = useWorkspace((state) => state.sources.length > 0);
  const selected = useWorkspace(
    (state) => state.sources.find((source) => source.id === state.selectedSourceId) ?? null,
  );
  const textResult = useWorkspace((state) => state.textResult);
  const [pane, setPane] = useState<MobilePane>("document");
  const selectedId = useWorkspace((state) => state.selectedSourceId);
  const lastSelected = useRef(selectedId);
  useEffect(() => {
    // On phones, picking an item in the list should show it.
    if (selectedId !== lastSelected.current && pane === "files") setPane("document");
    lastSelected.current = selectedId;
  }, [selectedId, pane]);

  if (!hasSources) {
    return (
      <DropZone
        onPick={(picked) => void add(picked)}
        label="Drop files to add them"
        className="mode"
      >
        <EmptyState />
      </DropZone>
    );
  }

  return (
    <DropZone onPick={(picked) => void add(picked)} label="Drop files to add them" className="mode">
      <WorkspaceLayout
        name="text"
        pane={pane}
        filesLabel="files"
        sideLabel="rewrite settings and hand-off"
        files={<FileList />}
        center={
          textResult ? (
            <ResultView result={textResult} />
          ) : selected ? (
            <DocumentView key={selected.id} source={selected} />
          ) : (
            <p className="pane-pad muted">Choose a file on the left to see its text.</p>
          )
        }
        side={
          <>
            <JobPanel />
            <HandoffPanel />
          </>
        }
      />
      <nav className="mobile-tabs" aria-label="Sections">
        {(
          [
            ["files", "Files", Files],
            ["document", textResult ? "Result" : "Document", TextAa],
            ["handoff", "Hand off", PaperPlaneTilt],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            aria-current={pane === id ? "page" : undefined}
            onClick={() => setPane(id)}
          >
            <Icon aria-hidden />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </DropZone>
  );
}
