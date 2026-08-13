import { Fragment, lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

import { decodeSafeStandaloneText, type WorkspaceDocument } from "../../../domain";
import { copyText } from "../copyText";
import { PdfOriginalPreview } from "./PdfOriginalPreview";

const MarkdownOriginalPreview = lazy(() => import("./MarkdownOriginalPreview"));
const MAX_PREVIEW_TEXT = 2 * 1024 * 1024;
const MAX_TABLE_ROWS = 200;
const MAX_TABLE_COLUMNS = 50;
const MAX_JSON_NODES = 2_000;
const MAX_JSON_DEPTH = 64;
const safeHtmlTags = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote",
  "pre", "code", "em", "strong", "s", "del", "table", "thead", "tbody", "tr", "th", "td",
  "br", "hr", "details", "summary",
]);

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

function isElement(node: HtmlNode): node is HtmlElement {
  return "tagName" in node;
}

function htmlChildren(node: HtmlNode): HtmlNode[] {
  return "childNodes" in node ? [...node.childNodes] : [];
}

function inertUrl(url: string, label: ReactNode, key: string): ReactNode {
  return <span className="inert-url" key={key}>
    <span>{label}</span><span className="url-text">{url}</span>
    <button type="button" onClick={() => void copyText(url)}>Copy URL</button>
  </span>;
}

function safeHtmlNode(node: HtmlNode, key: string): ReactNode {
  if (node.nodeName === "#text" && "value" in node) return node.value;
  if (!isElement(node)) return htmlChildren(node).map((child, index) => safeHtmlNode(child, `${key}-${index}`));
  const tag = node.tagName.toLowerCase();
  if (["script", "style", "form", "iframe", "frame", "frameset", "object", "embed", "template", "svg", "math"].includes(tag)) return null;
  const children = htmlChildren(node).map((child, index) => safeHtmlNode(child, `${key}-${index}`));
  const url = node.attrs.find((attribute) => ["href", "src", "action", "poster", "data"].includes(attribute.name.toLowerCase()))?.value;
  if (tag === "a" || tag === "img" || tag === "source" || tag === "video" || tag === "audio") {
    return inertUrl(url ?? "", tag === "img" ? node.attrs.find((attribute) => attribute.name === "alt")?.value || "Image resource" : children, key);
  }
  if (!safeHtmlTags.has(tag)) return <span key={key}>{children}</span>;
  const Tag = tag as keyof React.JSX.IntrinsicElements;
  return <Tag key={key}>{children}</Tag>;
}

export function SafeHtmlPreview({ text }: { text: string }) {
  const tree = useMemo(() => parseFragment(text), [text]);
  return <article className="safe-rich-preview" aria-label="HTML original preview">
    {tree.childNodes.map((node, index) => safeHtmlNode(node, `html-${index}`))}
  </article>;
}

export interface DelimitedPreview {
  rows: string[][];
  truncated: boolean;
}

export function parseDelimitedPreview(text: string, delimiter: "," | "\t"): DelimitedPreview {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let truncated = false;
  const input = text.slice(0, MAX_PREVIEW_TEXT);
  for (let index = 0; index <= input.length; index += 1) {
    const character = input[index] ?? "\n";
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"' && field.length === 0) quoted = true;
    else if (character === delimiter) { row.push(field); field = ""; }
    else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      rows.push(row.slice(0, MAX_TABLE_COLUMNS));
      if (row.length > MAX_TABLE_COLUMNS) truncated = true;
      row = [];
      field = "";
      if (rows.length >= MAX_TABLE_ROWS) { truncated = index < input.length - 1 || text.length > input.length; break; }
    } else field += character;
  }
  return { rows, truncated: truncated || text.length > input.length };
}

function TablePreview({ text, delimiter }: { text: string; delimiter: "," | "\t" }) {
  const preview = useMemo(() => parseDelimitedPreview(text, delimiter), [delimiter, text]);
  const [header = [], ...rows] = preview.rows;
  return <div className="table-preview-scroll">
    <table className="safe-table-preview">
      <thead><tr>{header.map((cell, index) => <th key={index}>{cell}</th>)}</tr></thead>
      <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
    </table>
    {preview.truncated ? <p className="preview-limit-note">Table preview bounded for browser safety. RAW preserves the complete original text.</p> : null}
  </div>;
}

function jsonTreeNode(label: string, value: unknown, budget: number, depth = 0): { node: ReactNode; remaining: number } {
  if (budget <= 0) return { node: <li><span>{label}</span>: <span>Preview limit reached</span></li>, remaining: 0 };
  if (depth >= MAX_JSON_DEPTH) return { node: <li><span className="json-key">{label}</span>: <span>Preview depth limit reached</span></li>, remaining: budget };
  const nextBudget = budget - 1;
  if (value === null || typeof value !== "object") return { node: <li><span className="json-key">{label}</span>: <span>{String(value)}</span></li>, remaining: nextBudget };
  let remaining = nextBudget;
  const children: ReactNode[] = [];
  let visibleCount = 0;
  let truncated = false;
  const record = value as Record<string, unknown>;
  for (const key in record) {
    if (!Object.hasOwn(record, key)) continue;
    if (remaining <= 0) {
      children.push(<li key={`${depth}-preview-limit`} className="json-preview-limit">Preview limit reached</li>);
      truncated = true;
      break;
    }
    visibleCount += 1;
    const result = jsonTreeNode(key, record[key], remaining, depth + 1);
    children.push(<Fragment key={`${depth}-${key}`}>{result.node}</Fragment>);
    remaining = result.remaining;
  }
  const summary = Array.isArray(value)
    ? `[${value.length}]`
    : `{${visibleCount}${truncated ? "+" : ""}}`;
  return { node: <li><details open={depth < 2}><summary>{label} {summary}</summary>
    <ul>{children}</ul>
  </details></li>, remaining };
}

export function JsonPreview({ text, lines }: { text: string; lines: boolean }) {
  const parsed = useMemo(() => {
    try { return lines ? text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as unknown) : JSON.parse(text) as unknown; }
    catch { return undefined; }
  }, [lines, text]);
  if (parsed === undefined) return <p className="preview-error">The original is not valid {lines ? "line-delimited JSON" : "JSON"}. Use RAW to inspect exact text.</p>;
  return <ul className="json-tree">{jsonTreeNode("root", parsed, MAX_JSON_NODES).node}</ul>;
}

function CodePreview({ text, language }: { text: string; language: string }) {
  const [wrap, setWrap] = useState(true);
  const lines = text.split("\n");
  return <div className={`original-code-view${wrap ? " is-wrapped" : ""}`}>
    <div className="original-view-controls"><span>{language}</span><button type="button" aria-pressed={wrap} onClick={() => setWrap((current) => !current)}>WRAP</button></div>
    <pre aria-label={`Read-only ${language} source`}><code>{lines.map((line, index) => <span className="original-code-line" key={index}><span aria-hidden="true">{index + 1}</span><span>{line || "\u00a0"}</span></span>)}</code></pre>
  </div>;
}

function RichRawView({ text, rich, label }: { text: string; rich: ReactNode; label: string }) {
  const [view, setView] = useState<"rich" | "raw">("rich");
  const id = useId().replaceAll(":", "");
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectByKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % 2;
    else if (event.key === "ArrowLeft") next = (index + 1) % 2;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 1;
    else return;
    event.preventDefault();
    setView(next === 0 ? "rich" : "raw");
    tabs.current[next]?.focus();
  };
  return <div className="original-format-view">
    <div className="original-view-controls" role="tablist" aria-label={`${label} view`}>
      {(["rich", "raw"] as const).map((choice, index) => <button
        key={choice}
        id={`${id}-${choice}-tab`}
        ref={(node) => { tabs.current[index] = node; }}
        type="button"
        role="tab"
        aria-selected={view === choice}
        aria-controls={`${id}-${choice}-panel`}
        tabIndex={view === choice ? 0 : -1}
        onKeyDown={(event) => selectByKey(event, index)}
        onClick={() => setView(choice)}
      >{choice.toUpperCase()}</button>)}
    </div>
    <div id={`${id}-${view}-panel`} role="tabpanel" aria-labelledby={`${id}-${view}-tab`} className="original-format-panel">
      {view === "rich" ? rich : <CodePreview text={text} language={label} />}
    </div>
  </div>;
}

function OriginalText({ document, text }: { document: WorkspaceDocument; text: string }) {
  switch (document.format) {
    case "markdown": return <RichRawView text={text} label="Markdown" rich={<Suspense fallback={<p>Loading safe Markdown preview…</p>}><MarkdownOriginalPreview text={text} /></Suspense>} />;
    case "html": return <RichRawView text={text} label="HTML" rich={<SafeHtmlPreview text={text} />} />;
    case "csv": return <RichRawView text={text} label="CSV" rich={<TablePreview text={text} delimiter="," />} />;
    case "tsv": return <RichRawView text={text} label="TSV" rich={<TablePreview text={text} delimiter={"\t"} />} />;
    case "json": return <RichRawView text={text} label="JSON" rich={<JsonPreview text={text} lines={false} />} />;
    case "jsonl":
    case "ndjson": return <RichRawView text={text} label="JSONL" rich={<JsonPreview text={text} lines />} />;
    case "docx": return <section className="docx-approximation" aria-label="Approximate DOCX original"><strong>APPROXIMATE DOCX VIEW</strong><p>This semantic view is reconstructed from locally extracted content and assets; it is not the original Word layout.</p><CodePreview text={document.extractedText} language="DOCX extracted content" /></section>;
    default: return <CodePreview text={text} language={document.languageId ?? document.format} />;
  }
}

function OriginalPreviewContent({ document, identity }: { document: WorkspaceDocument; identity: string }) {
  const generation = useRef(0);
  const [result, setResult] = useState<{ identity: string; text?: string; bytes?: Uint8Array; error?: string }>({ identity });
  useEffect(() => {
    const currentGeneration = ++generation.current;
    let disposed = false;
    void document.original.arrayBuffer().then((buffer) => {
      if (disposed || generation.current !== currentGeneration) return;
      if (document.format === "pdf") {
        setResult({ identity, bytes: new Uint8Array(buffer) });
        return;
      }
      const decoded = decodeSafeStandaloneText(new Uint8Array(buffer));
      if (!decoded.ok && document.format !== "docx") setResult({ identity, error: "This original cannot be displayed as safe text." });
      else setResult({ identity, text: decoded.ok ? decoded.text : document.extractedText });
    }).catch(() => {
      if (!disposed && generation.current === currentGeneration) setResult({ identity, error: "This original could not be read safely." });
    });
    return () => { disposed = true; generation.current += 1; };
  }, [document, identity]);
  if (result.identity !== identity || (!result.text && !result.bytes && !result.error)) return <p>Loading original locally…</p>;
  if (result.error) return <p className="preview-error">{result.error}</p>;
  if (result.bytes) return <PdfOriginalPreview bytes={result.bytes} identity={identity} />;
  return <OriginalText document={document} text={result.text ?? ""} />;
}

export function OriginalPreview({ document }: { document: WorkspaceDocument }) {
  const identity = `${document.id}:${document.originalHash}`;
  return <OriginalPreviewContent key={identity} document={document} identity={identity} />;
}

export type SourceView = "extracted" | "original";

interface SourceReviewProps {
  document: WorkspaceDocument;
  extracted: ReactNode;
}

export function SourceReview({ document, extracted }: SourceReviewProps) {
  const identity = `${document.id}:${document.originalHash}`;
  const [selection, setSelection] = useState<{ identity: string; view: SourceView }>({ identity, view: "extracted" });
  const view = selection.identity === identity ? selection.view : "extracted";
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectByKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % 2;
    else if (event.key === "ArrowLeft") next = (index + 1) % 2;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 1;
    else return;
    event.preventDefault();
    setSelection({ identity, view: next === 0 ? "extracted" : "original" });
    tabs.current[next]?.focus();
  };
  return <div className="source-review">
    <div className="source-view-tabs" role="tablist" aria-label="Source view">
      {(["extracted", "original"] as const).map((choice, index) => <button
        key={choice}
        id={`source-${choice}-tab`}
        ref={(node) => { tabs.current[index] = node; }}
        type="button"
        role="tab"
        aria-selected={view === choice}
        aria-controls={`source-${choice}-panel`}
        tabIndex={view === choice ? 0 : -1}
        onKeyDown={(event) => selectByKey(event, index)}
        onClick={() => setSelection({ identity, view: choice })}
      >{choice === "extracted" ? "EXTRACTED TEXT" : "ORIGINAL"}</button>)}
    </div>
    <div id={`source-${view}-panel`} role="tabpanel" aria-labelledby={`source-${view}-tab`} className="source-view-panel">
      {view === "extracted" ? extracted : <OriginalPreview document={document} />}
    </div>
  </div>;
}
