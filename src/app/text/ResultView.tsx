import { ArrowLeft, DownloadSimple } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { makeZip } from "../../engine/handoff/zip";
import { compareTexts, overlapShare, wordCount, type DiffPart } from "../../engine/results/compare";
import { exportRewrite, type ExportFile } from "../../engine/results/export";
import { auditVerdict, parseReply } from "../../engine/results/parse";
import { readTextFiles } from "../../engine/text";
import type { TextSource } from "../../engine/types";
import { CopyButton } from "../../ui/CopyButton";
import { MarkdownView } from "../../ui/MarkdownView";
import { downloadBlob } from "../../ui/download";
import { Segmented } from "../../ui/Segmented";
import { baseName, buildTaskInput } from "../batch";
import { useWorkspace, type TextResult } from "../store";

interface ResultItem {
  source: TextSource;
  path: string;
  /** The rewritten text, or null when the model left the file unchanged. */
  after: string | null;
  /** A file the agent wrote, kept so downloads are the agent's own file, not a re-export. */
  agentFile: { path: string; data: Blob } | null;
}

function stem(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot > path.lastIndexOf("/") ? path.slice(0, dot) : path;
}

async function blobText(file: { path: string; data: Blob }): Promise<string> {
  if (/\.docx$/i.test(file.path)) {
    const { sources } = await readTextFiles([new File([file.data], baseName(file.path))], {
      ocr: "off",
    });
    return sources[0]?.text ?? "";
  }
  return file.data.text();
}

async function resolveItems(
  result: TextResult,
  scoped: TextSource[],
  paths: string[],
): Promise<ResultItem[]> {
  if (result.reply !== null) {
    const parsed = parseReply(result.reply);
    return scoped.map((source, index) => {
      const after =
        scoped.length === 1
          ? (parsed.document ?? parsed.files[0]?.text ?? null)
          : (parsed.files.find(
              (file) => file.path === paths[index] || file.path.endsWith(`/${paths[index]}`),
            )?.text ?? null);
      return { source, path: paths[index], after, agentFile: null };
    });
  }
  const files = result.files ?? [];
  return Promise.all(
    scoped.map(async (source, index) => {
      const path = paths[index];
      const candidates = [path, `${stem(path)}.docx`, `${path}.md`, `${stem(path)}.md`];
      const agentFile =
        candidates
          .map((candidate) => files.find((file) => file.path === candidate))
          .find((file) => file !== undefined) ?? null;
      return { source, path, after: agentFile ? await blobText(agentFile) : null, agentFile };
    }),
  );
}

function Diff({ parts }: { parts: DiffPart[] }) {
  return (
    <div className="diff">
      {parts.map((part, index) =>
        part.kind === "same" ? (
          <span key={index}>{part.value}</span>
        ) : part.kind === "added" ? (
          <ins key={index}>{part.value}</ins>
        ) : (
          <del key={index}>{part.value}</del>
        ),
      )}
    </div>
  );
}

function isProse(source: TextSource): boolean {
  return (
    source.previewKind === "markdown" ||
    source.previewKind === "plain-text" ||
    source.format === "docx" ||
    source.format === "pdf"
  );
}

function SideBySide({ before, after, prose }: { before: string; after: string; prose: boolean }) {
  const show = (text: string, label: string) =>
    prose ? (
      <div className="paper">
        <MarkdownView markdown={text} />
      </div>
    ) : (
      <pre className="code-view code-view-wrap" tabIndex={0} aria-label={label}>
        {text}
      </pre>
    );
  return (
    <div className="side-by-side">
      <section aria-label="Original">
        <p className="eyebrow">Original</p>
        {show(before, "Original text")}
      </section>
      <section aria-label="Rewrite">
        <p className="eyebrow">Rewrite</p>
        {show(after, "Rewritten text")}
      </section>
    </div>
  );
}

const LINE = /^([^:]{1,40}):\s*(.*)$/;
const VERDICT = /^(PASS|REVIEW|NOT APPLICABLE)\b\s*[—–-]?\s*(.*)$/;

/** Shows the model's check as labeled rows when it follows the requested "Label: note" format. */
function AuditRows({ audit }: { audit: string }) {
  const lines = audit
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => LINE.exec(line));
  if (lines.some((line) => line === null)) return <pre className="audit">{audit}</pre>;
  return (
    <dl className="audit-rows">
      {lines.map((line) => {
        const [, label, rest] = line!;
        const verdict = VERDICT.exec(rest);
        const note = verdict ? verdict[2] : rest;
        return (
          <div key={label} className="audit-row">
            <dt>{label}</dt>
            <dd>
              {verdict && (
                <span className={`verdict verdict-${verdict[1].split(" ")[0].toLowerCase()}`}>
                  {verdict[1] === "NOT APPLICABLE"
                    ? "N/A"
                    : verdict[1] === "PASS"
                      ? "Pass"
                      : "Review"}
                </span>
              )}
              {note && <span>{note}</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

async function exportItem(item: ResultItem): Promise<ExportFile | null> {
  if (item.agentFile) return { name: baseName(item.agentFile.path), blob: item.agentFile.data };
  if (item.after === null) return null;
  return exportRewrite(item.path, item.source.format, item.after);
}

export function ResultView({ result }: { result: TextResult }) {
  const sources = useWorkspace((state) => state.sources);
  const projects = useWorkspace((state) => state.projects);
  const setTextResult = useWorkspace((state) => state.setTextResult);
  const notify = useWorkspace((state) => state.notify);
  const [items, setItems] = useState<ResultItem[] | null>(null);
  const [active, setActive] = useState(0);
  const [view, setView] = useState<"side" | "changes">("side");
  const [diff, setDiff] = useState<{ item: ResultItem; parts: DiffPart[] } | null>(null);

  const scoped = useMemo(
    () =>
      result.sourceIds
        .map((id) => sources.find((source) => source.id === id))
        .filter((source): source is TextSource => source !== undefined),
    [result.sourceIds, sources],
  );
  const audit = useMemo(
    () => (result.reply !== null ? parseReply(result.reply).audit : result.report),
    [result],
  );
  const verdict = auditVerdict(audit);

  useEffect(() => {
    let current = true;
    const paths = buildTaskInput(scoped, projects).files.map((file) => file.path);
    resolveItems(result, scoped, paths).then((resolved) => {
      if (current) setItems(resolved);
    });
    return () => {
      current = false;
    };
  }, [result, scoped, projects]);

  const item = items?.[Math.min(active, items.length - 1)] ?? null;

  useEffect(() => {
    let current = true;
    if (item?.after != null) {
      const shown = item;
      compareTexts(shown.source.text, shown.after ?? "").then((parts) => {
        if (current) setDiff({ item: shown, parts });
      });
    }
    return () => {
      current = false;
    };
  }, [item]);
  const parts = diff && diff.item === item ? diff.parts : null;

  async function downloadOne(target: ResultItem) {
    const file = await exportItem(target);
    if (file) downloadBlob(file.blob, file.name);
  }

  async function downloadAll() {
    if (!items) return;
    const files = (await Promise.all(items.map(exportItem))).flatMap((file, index) =>
      file ? [{ path: items[index].path.replace(/[^/]+$/, file.name), data: file.blob }] : [],
    );
    downloadBlob(await makeZip(files), "rewritten-files.zip");
    notify(`Downloaded ${files.length} ${files.length === 1 ? "file" : "files"}.`);
  }

  if (!items) return <p className="loading">Reading the result…</p>;
  const changed = items.filter((entry) => entry.after !== null);

  return (
    <section className="pane pane-document" aria-labelledby="result-heading">
      <header className="document-head">
        <div className="document-title">
          <button type="button" className="link-button" onClick={() => setTextResult(null)}>
            <ArrowLeft aria-hidden /> Back to your files
          </button>
          <h2 id="result-heading">The rewrite</h2>
          <p className="muted small">
            {changed.length} of {items.length} {items.length === 1 ? "file" : "files"} rewritten
          </p>
        </div>
        <div className="button-row">
          {items.length > 1 && changed.length > 0 && (
            <button type="button" className="btn" onClick={() => void downloadAll()}>
              <DownloadSimple aria-hidden />
              <span>Download all</span>
            </button>
          )}
        </div>
      </header>

      {audit && (
        <div className={`callout ${verdict === "review" ? "callout-warn" : ""}`}>
          <p>
            <strong>
              {verdict === "pass"
                ? "The model's check passed."
                : verdict === "review"
                  ? "The model flagged something to review."
                  : "The model's check"}
            </strong>
          </p>
          <AuditRows audit={audit} />
        </div>
      )}

      {items.length > 1 && (
        <div className="tabs result-tabs" role="group" aria-label="Files">
          {items.map((entry, index) => (
            <button
              key={entry.path}
              type="button"
              aria-pressed={index === active}
              onClick={() => setActive(index)}
            >
              {baseName(entry.path)}
              {entry.after === null && <span className="muted"> · unchanged</span>}
            </button>
          ))}
        </div>
      )}

      {item && item.after === null ? (
        <p className="pane-pad muted">
          {result.reply !== null
            ? "The reply didn't include a rewrite for this file."
            : "The agent didn't write a result for this file."}
        </p>
      ) : (
        item && (
          <>
            <div className="result-bar">
              <Segmented
                label="View"
                hideLabel
                value={view}
                options={[
                  { value: "side", label: "Side by side" },
                  { value: "changes", label: "Word changes" },
                ]}
                onChange={setView}
              />
              <span className="muted small">
                {wordCount(item.source.text).toLocaleString("en-US")} →{" "}
                {wordCount(item.after ?? "").toLocaleString("en-US")} words
                {parts && ` · ${Math.round(overlapShare(parts) * 100)}% of words unchanged`}
              </span>
              <div className="button-row">
                <CopyButton text={item.after ?? ""} label="Copy" />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void downloadOne(item)}
                >
                  <DownloadSimple aria-hidden />
                  <span>Download</span>
                </button>
              </div>
            </div>
            <div className="document-body">
              {view === "side" ? (
                <SideBySide
                  before={item.source.text}
                  after={item.after ?? ""}
                  prose={isProse(item.source)}
                />
              ) : parts ? (
                <Diff parts={parts} />
              ) : (
                <p className="loading">Comparing…</p>
              )}
            </div>
          </>
        )
      )}
    </section>
  );
}
