import { useMemo, useState } from "react";
import { estimateTokens } from "../../engine/text";
import type { TextSource } from "../../engine/types";
import { wordCount } from "../../engine/results/compare";
import { MarkdownView } from "../../ui/MarkdownView";
import { PdfPages } from "../../ui/PdfPages";
import { baseName, textWithOcr } from "../batch";
import { useWorkspace } from "../store";

type Tab = "read" | "edit" | "original" | "found";

const FORMAT_LABELS: Partial<Record<TextSource["format"], string>> = {
  docx: "Word",
  pdf: "PDF",
  markdown: "Markdown",
  html: "HTML",
  latex: "LaTeX",
  text: "Plain text",
  code: "Code",
};

function Original({ source }: { source: TextSource }) {
  if (source.format === "pdf") return <PdfPages file={source.original} />;
  return (
    <p className="muted pane-pad">
      Word files can't be shown in the browser. The Read tab shows the text reword_nerd took from
      it; the task folder includes the original file.
    </p>
  );
}

function FoundText({ source }: { source: TextSource }) {
  const update = useWorkspace((state) => state.updateSource);
  const setAccepted = (ids: Set<string> | "all" | "none") => {
    const ocr = source.ocr.map((passage) => ({
      ...passage,
      accepted: ids === "all" ? true : ids === "none" ? false : ids.has(passage.id),
    }));
    const next = { ...source, ocr };
    // Accepting OCR rebuilds the text, so edits made before accepting are replaced.
    update(source.id, { ocr, text: textWithOcr(next) });
  };
  const acceptedIds = new Set(
    source.ocr.filter((passage) => passage.accepted).map((passage) => passage.id),
  );
  return (
    <div className="pane-pad stack">
      <p className="muted">
        Some pages had no selectable text, so reword_nerd read them with OCR. Check each passage and
        accept the ones that are right; accepted text is added to the document.
      </p>
      <div className="button-row">
        <button type="button" className="btn" onClick={() => setAccepted("all")}>
          Accept all
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setAccepted("none")}>
          Accept none
        </button>
      </div>
      <ul className="ocr-list">
        {source.ocr.map((passage) => (
          <li key={passage.id} className="ocr-item">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={passage.accepted}
                onChange={(event) => {
                  const ids = new Set(acceptedIds);
                  if (event.target.checked) ids.add(passage.id);
                  else ids.delete(passage.id);
                  setAccepted(ids);
                }}
              />
              <span>
                <strong>{passage.label}</strong>
                <span className="muted small"> · {Math.round(passage.confidence)}% confident</span>
              </span>
            </label>
            <pre className="plain-view">{passage.text || "(No text found.)"}</pre>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DocumentView({ source }: { source: TextSource }) {
  const update = useWorkspace((state) => state.updateSource);
  const [tab, setTab] = useState<Tab>("read");
  const words = useMemo(() => wordCount(source.text), [source.text]);
  const tokens = useMemo(() => estimateTokens(source.text), [source.text]);
  const prose =
    source.previewKind === "markdown" || source.format === "docx" || source.format === "pdf";
  const edited = source.text !== textWithOcr(source);
  const tabs: { id: Tab; label: string }[] = [
    { id: "read", label: "Read" },
    { id: "edit", label: "Edit" },
    ...(source.format === "pdf" || source.format === "docx"
      ? [{ id: "original" as const, label: "Original" }]
      : []),
    ...(source.ocr.length > 0
      ? [{ id: "found" as const, label: `Scanned text (${source.ocr.length})` }]
      : []),
  ];

  return (
    <section className="pane pane-document" aria-labelledby="document-heading">
      <header className="document-head">
        <div className="document-title">
          <h2 id="document-heading" title={source.path}>
            {baseName(source.path)}
          </h2>
          <p className="muted small">
            {FORMAT_LABELS[source.format] ?? source.languageId} · {words.toLocaleString("en-US")}{" "}
            words · about {tokens.toLocaleString("en-US")} tokens
            {edited && " · edited"}
          </p>
        </div>
        <div className="tabs" role="group" aria-label="Document view">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={tab === item.id}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {source.notes.length > 0 && (
        <ul className="callout callout-warn notes-list">
          {source.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      <div className="document-body">
        {tab === "read" &&
          (prose ? (
            <div className="paper">
              <MarkdownView markdown={source.text} />
            </div>
          ) : (
            <pre
              className={`code-view ${source.previewKind === "code" ? "" : "code-view-wrap"}`}
              tabIndex={0}
              aria-label="File text"
            >
              {source.text}
            </pre>
          ))}
        {tab === "edit" && (
          <div className="edit-view">
            <label className="visually-hidden" htmlFor="source-editor">
              Edit the text of {baseName(source.path)}
            </label>
            <textarea
              id="source-editor"
              className="editor"
              value={source.text}
              spellCheck={prose}
              onChange={(event) => update(source.id, { text: event.target.value })}
            />
            <div className="edit-foot">
              <span className="muted small">
                Your edits are what gets rewritten. The original file is kept.
              </span>
              {edited && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => update(source.id, { text: textWithOcr(source) })}
                >
                  Undo all edits
                </button>
              )}
            </div>
          </div>
        )}
        {tab === "original" && <Original source={source} />}
        {tab === "found" && <FoundText source={source} />}
      </div>

      {source.assets.length > 0 && tab === "read" && (
        <details className="figures">
          <summary>
            {source.assets.length} {source.assets.length === 1 ? "figure" : "figures"} found in this
            file
          </summary>
          <p className="muted small">
            Figures go into the task folder for agents. Chat prompts list them by name and caption
            so the model keeps each reference.
          </p>
        </details>
      )}
    </section>
  );
}
