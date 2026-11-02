import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { estimateTokens } from "../../engine/text";
import type { TextSource } from "../../engine/types";
import { wordCount } from "../../engine/results/compare";
import { AutoTextarea } from "../../ui/AutoTextarea";
import { LineDiff } from "../../ui/LineDiff";
import { PdfPages } from "../../ui/PdfPages";
import { baseName, textWithOcr } from "../batch";
import { pageAttributes, usePageStyle } from "../pageStyle";
import { useWorkspace } from "../store";
import { DownloadMenu, PageStyleMenu } from "./DocumentTools";
import { isPageText } from "./exportDocument";
import { PageEditor } from "./PageEditor";

type Tab = "page" | "source" | "changes" | "original" | "found";

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
      Word files can't be shown in the browser. The Page tab shows the text reword_nerd took from
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

type ConfirmState = "idle" | "confirming";

function UndoEdits({ source }: { source: TextSource }) {
  const update = useWorkspace((state) => state.updateSource);
  const [state, setState] = useState<ConfirmState>("idle");
  if (state === "idle") {
    return (
      <button type="button" className="btn btn-quiet" onClick={() => setState("confirming")}>
        <ArrowCounterClockwise aria-hidden />
        <span>Undo all edits</span>
      </button>
    );
  }
  return (
    <span className="confirm-inline" role="group" aria-label="Undo all edits?">
      <span className="small">Go back to the original text?</span>
      <button
        type="button"
        className="btn btn-danger"
        onClick={() => {
          update(source.id, { text: textWithOcr(source) });
          setState("idle");
        }}
      >
        Undo all edits
      </button>
      <button type="button" className="btn btn-quiet" onClick={() => setState("idle")}>
        Keep them
      </button>
    </span>
  );
}

export function DocumentView({ source }: { source: TextSource }) {
  const update = useWorkspace((state) => state.updateSource);
  const style = usePageStyle();
  const pageText = isPageText(source);
  const markdown =
    source.previewKind === "markdown" || source.format === "docx" || source.format === "pdf";
  const [tab, setTab] = useState<Tab>(pageText ? "page" : "source");
  const words = useMemo(() => wordCount(source.text), [source.text]);
  const tokens = useMemo(() => estimateTokens(source.text), [source.text]);
  const original = textWithOcr(source);
  const edited = source.text !== original;
  const name = baseName(source.path);
  const setText = (text: string) => update(source.id, { text });
  const tabs: { id: Tab; label: string }[] = [
    ...(pageText ? [{ id: "page" as const, label: "Page" }] : []),
    ...(!pageText || markdown
      ? [
          {
            id: "source" as const,
            label: markdown ? "Markdown" : source.previewKind === "code" ? "Code" : "Source",
          },
        ]
      : []),
    { id: "changes", label: "Changes" },
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
            {name}
          </h2>
          <p className="muted small">
            {FORMAT_LABELS[source.format] ?? source.languageId} · {words.toLocaleString("en-US")}{" "}
            words · about {tokens.toLocaleString("en-US")} tokens
            {edited && (
              <>
                {" · "}
                <button type="button" className="link-button" onClick={() => setTab("changes")}>
                  edited
                </button>
              </>
            )}
          </p>
        </div>
        <div className="document-actions">
          {pageText && tab === "page" && <PageStyleMenu />}
          <DownloadMenu source={source} text={source.text} />
        </div>
      </header>

      <div className="tabs document-tabs" role="group" aria-label="Document view">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.id === "changes" && edited && (
              <>
                <span className="tab-dot" aria-hidden />
                <span className="visually-hidden"> (edited)</span>
              </>
            )}
          </button>
        ))}
      </div>

      {source.notes.length > 0 && (
        <ul className="callout callout-warn notes-list">
          {source.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      <div className="document-body">
        {tab === "page" &&
          (markdown ? (
            <PageEditor
              markdown={source.text}
              label={`Page: ${name}`}
              onChange={setText}
              pageProps={pageAttributes(style)}
            />
          ) : (
            <div className="paper page" {...pageAttributes(style)}>
              <label className="visually-hidden" htmlFor="plain-page">
                Page: {name}
              </label>
              <AutoTextarea
                id="plain-page"
                className="page-plain"
                value={source.text}
                spellCheck
                onChange={(event) => setText(event.target.value)}
              />
            </div>
          ))}
        {tab === "source" && (
          <div className="edit-view">
            <label className="visually-hidden" htmlFor="source-editor">
              Edit the text of {name}
            </label>
            <AutoTextarea
              id="source-editor"
              className="editor"
              value={source.text}
              spellCheck={pageText}
              wrap={source.previewKind === "code" ? "off" : "soft"}
              onChange={(event) => setText(event.target.value)}
            />
            <p className="muted small">
              Your edits are what gets rewritten and downloaded. The original file is kept.
            </p>
          </div>
        )}
        {tab === "changes" && (
          <LineDiff
            before={original}
            after={source.text}
            beforeLabel="Original"
            afterLabel="Edited text"
            actions={edited ? <UndoEdits source={source} /> : null}
          />
        )}
        {tab === "original" && <Original source={source} />}
        {tab === "found" && <FoundText source={source} />}
      </div>

      {source.assets.length > 0 && tab === "page" && (
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
