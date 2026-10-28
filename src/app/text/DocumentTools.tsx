import { CaretDown, DownloadSimple, TextAa } from "@phosphor-icons/react";
import { useState } from "react";
import { PAPER_COLORS } from "../../engine/page/look";
import type { TextSource } from "../../engine/types";
import { Popover } from "../../ui/Popover";
import { Segmented } from "../../ui/Segmented";
import { FONTS, PAPERS, SIZES, setPageStyle, usePageStyle } from "../pageStyle";
import { useWorkspace } from "../store";
import { exportChoices, exportDocument, linkColor, type ExportKind } from "./exportDocument";

/** Paper, typeface, and size for the page. The same look is used for exports. */
export function PageStyleMenu() {
  const style = usePageStyle();
  return (
    <Popover
      label="Page style"
      buttonClassName="btn btn-quiet"
      className="page-style-menu"
      trigger={
        <>
          <TextAa aria-hidden />
          <span>Page style</span>
        </>
      }
    >
      {() => (
        <div className="stack">
          <fieldset className="paper-choices">
            <legend className="field-label">Paper</legend>
            <div className="paper-options">
              {PAPERS.map((paper) => (
                <label key={paper.value} className="paper-option">
                  <input
                    type="radio"
                    name="page-paper"
                    value={paper.value}
                    checked={style.paper === paper.value}
                    onChange={() => setPageStyle({ paper: paper.value })}
                  />
                  <span
                    className="paper-swatch"
                    aria-hidden
                    style={{
                      background: PAPER_COLORS[paper.value].bg,
                      color: PAPER_COLORS[paper.value].ink,
                    }}
                  >
                    Aa
                  </span>
                  <span>{paper.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <Segmented
            label="Typeface"
            value={style.font}
            options={FONTS}
            onChange={(font) => setPageStyle({ font })}
          />
          <Segmented
            label="Size"
            value={style.size}
            options={SIZES}
            onChange={(size) => setPageStyle({ size })}
          />
          <p className="muted small">Downloads use this look too.</p>
        </div>
      )}
    </Popover>
  );
}

/** Saves the document as Word, PDF, a web page, Markdown, or text, in the page's look. */
interface DownloadMenuProps {
  source: TextSource;
  text: string;
  /** An extra first choice, such as the file exactly as an agent wrote it. */
  first?: { label: string; detail: string; run: () => Promise<void> };
}

export function DownloadMenu({ source, text, first }: DownloadMenuProps) {
  const style = usePageStyle();
  const notify = useWorkspace((state) => state.notify);
  const [working, setWorking] = useState<ExportKind | "first" | null>(null);

  async function save(kind: ExportKind | "first") {
    setWorking(kind);
    try {
      if (kind === "first") await first?.run();
      else
        await exportDocument(kind, {
          path: source.path,
          source,
          text,
          look: { ...style, link: linkColor(style.paper) },
        });
    } catch (problem) {
      notify(problem instanceof Error ? problem.message : "That file couldn't be made.", "error");
    } finally {
      setWorking(null);
    }
  }

  return (
    <Popover
      label="Download"
      buttonClassName="btn btn-primary"
      className="download-menu"
      trigger={
        <>
          <DownloadSimple aria-hidden />
          <span>Download</span>
          <CaretDown aria-hidden className="caret" />
        </>
      }
    >
      {(close) => (
        <ul className="menu-list">
          {first && (
            <li>
              <button
                type="button"
                className="menu-item"
                disabled={working !== null}
                onClick={() => {
                  close();
                  void save("first");
                }}
              >
                <span className="menu-item-label">{first.label}</span>
                <span className="menu-item-detail">{first.detail}</span>
              </button>
            </li>
          )}
          {exportChoices(source).map((choice) => (
            <li key={choice.kind}>
              <button
                type="button"
                className="menu-item"
                disabled={working !== null}
                onClick={() => {
                  close();
                  void save(choice.kind);
                }}
              >
                <span className="menu-item-label">{choice.label}</span>
                <span className="menu-item-detail">{choice.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}
