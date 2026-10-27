import { useWorkspaceState } from "../../workspace/Workspace";
import { useId, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowsLeftRight,
  BookOpenText,
  Copy,
  DownloadSimple,
  PencilSimple,
  Sparkle,
} from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { copyText } from "../workbench/copyText";
import { CompareView } from "./StudioInsights";
import { countWords } from "./textInsights";
import {
  downloadStudioResult,
  parseStudioResult,
  RESULT_PREVIEW_LIMIT,
  type ParsedStudioResult,
} from "./resultReview";

export interface StudioResultReviewProps {
  sourceText: string;
  response: string;
  workspaceKey?: string;
}

const resultStyles = `
.studio-result-review{margin:24px 0 8px;border:1px solid #d9ded0;border-radius:16px;background:#fafbf5;overflow:hidden;color:#293228}
.studio-result-review-header{display:flex;gap:13px;align-items:center;padding:24px 24px 16px}
.studio-result-review-icon{height:44px;width:44px;flex-shrink:0;border-radius:50%;display:grid;place-items:center;background:#e5edcf;color:#526633}
.studio-result-review-header h3{font-family:Georgia,serif;font-weight:400;font-size:25px;margin:4px 0 0;letter-spacing:-.6px}
.studio-result-review-header .studio-eyebrow{font-size:9px;letter-spacing:1.4px;color:#6a775c}
.studio-result-review-origin{padding:0 24px 18px;border-bottom:1px solid #e0e4d9}
.studio-result-review-origin strong{font-size:11px;color:#526333;display:inline-block;background:#eaf0df;padding:5px 9px;border-radius:5px}
.studio-result-review-origin p,.studio-result-review-footnote{font-size:11px;line-height:1.7;color:#737a6d;margin:8px 0 0}
.studio-result-review-metrics{display:flex;align-items:center;gap:20px;padding:18px 24px;background:#f4f6ee}
.studio-result-review-metric{display:flex;flex-direction:column;gap:4px}.studio-result-review-metric span{font-size:10px;color:#717966}.studio-result-review-metric strong{font-size:23px;font-weight:500;letter-spacing:-1px;font-variant-numeric:tabular-nums}
.studio-result-review-delta{margin-left:auto;font-size:11px;color:#697856;text-align:right;line-height:1.6}
.studio-result-review-tabs{display:flex;gap:4px;padding:13px 18px;border-top:1px solid #e0e4d9;border-bottom:1px solid #e0e4d9;background:#fffef9}
.studio-result-review-tabs button{display:flex;align-items:center;gap:6px;border:0;background:transparent;color:#767c70;border-radius:6px;padding:8px 11px;font:inherit;font-size:11px;cursor:pointer}
.studio-result-review-tabs button[aria-pressed=true]{background:#e9eedf;color:#40532e}.studio-result-review-tabs button:focus-visible,.studio-result-review-reset:focus-visible{outline:2px solid #6b8048;outline-offset:3px}
.studio-result-review-reader{padding:30px 34px;min-height:150px;max-height:600px;overflow:auto;background:#fffef9}.studio-result-review-reader .studio-prose{font-size:15px;line-height:1.95;overflow-wrap:anywhere}.studio-result-review-reader .studio-prose h1{font-size:30px;line-height:1.25}.studio-result-review-reader pre{overflow:auto}.studio-result-review-reader table{display:block;overflow:auto;max-width:100%}
.studio-result-review-edit{padding:18px;background:#fffef9}.studio-result-review-edit label{display:block;font-size:11px;font-weight:600;margin-bottom:10px}.studio-result-review-edit textarea{box-sizing:border-box;width:100%;min-height:320px;resize:vertical;padding:16px;border:1px solid #d9ded0;border-radius:8px;background:#fffefa;color:#30382c;font:13px/1.9 ui-monospace,monospace}.studio-result-review-edit textarea:focus{outline:2px solid #95a674;outline-offset:2px}
.studio-result-review-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:16px 20px;border-top:1px solid #e0e4d9}.studio-result-review-actions .studio-secondary{font-size:11px;padding:9px 12px}.studio-result-review-feedback{font-size:11px;line-height:1.6;color:#5a6e42;flex-basis:100%;min-height:0}.studio-result-review-feedback:empty{display:none}
.studio-result-review-notes{padding:0 24px 20px}.studio-result-review-notes summary{cursor:pointer;font-size:11px;color:#637449;padding:8px 0}.studio-result-review-notes pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.8 ui-monospace,monospace;max-height:220px;overflow:auto;background:#f0f3e8;padding:14px;border-radius:8px}.studio-result-review-reset{border:0;background:none;text-decoration:underline;text-underline-offset:3px;padding:0;color:#64784b;font:inherit;font-size:11px;cursor:pointer}
.studio-result-review-compare-heading{font-size:11px;padding:12px 22px 0;color:#6b755f}.studio-result-review .studio-compare{min-height:0}.studio-result-review .studio-compare-document{max-height:500px;overflow:auto}
@media(max-width:600px){.studio-result-review-header{padding:20px 18px 12px}.studio-result-review-origin{padding:0 18px 16px}.studio-result-review-metrics{gap:14px;padding:16px 18px}.studio-result-review-reader{padding:24px 20px}.studio-result-review-tabs{padding:11px 10px}.studio-result-review-tabs button{padding:8px;font-size:10px}.studio-result-review-delta{font-size:10px}.studio-result-review-notes{padding:0 18px 16px}}
`;

/** A response change begins a new review; ordinary rerenders retain local edits. */
export function StudioResultReview({
  sourceText,
  response,
  workspaceKey,
}: StudioResultReviewProps) {
  const parsed = useMemo(() => parseStudioResult(response), [response]);
  return (
    <ResultReviewDocument
      key={response}
      sourceText={sourceText}
      parsed={parsed}
      response={response}
      workspaceKey={workspaceKey}
    />
  );
}

function useResultState<T>(key: string, response: string, field: string, initial: T) { return useWorkspaceState(`result:${key}:${field}`, initial, { binding: response }); }

function ResultReviewDocument({
  sourceText,
  response,
  parsed,
  workspaceKey = "standalone",
}: StudioResultReviewProps & { parsed: ParsedStudioResult }) {
  const editorId = useId();
  const [text, setText] = useResultState(workspaceKey, response, "text", parsed.text);
  const [view, setView] = useResultState<"read" | "compare" | "edit">(workspaceKey, response, "view", "read");
  const [origin, setOrigin] = useResultState(workspaceKey, response, "origin", parsed.mode);
  const [feedback, setFeedback] = useState("");
  const sampled =
    sourceText.length > RESULT_PREVIEW_LIMIT ||
    text.length > RESULT_PREVIEW_LIMIT;
  const sourcePreview = sourceText.slice(0, RESULT_PREVIEW_LIMIT);
  const resultPreview = text.slice(0, RESULT_PREVIEW_LIMIT);
  const sourceWords = useMemo(() => countWords(sourcePreview), [sourcePreview]);
  const resultWords = useMemo(() => countWords(resultPreview), [resultPreview]);
  const delta = resultWords - sourceWords;
  const percentage = sourceWords
    ? Math.round((Math.abs(delta) / sourceWords) * 100)
    : null;
  const changedLocally =
    text !== (origin === "final-document" ? parsed.text : response);

  const copy = async () => {
    const copied = await copyText(text);
    setFeedback(
      copied === "copied"
        ? "Your result is copied."
        : "Clipboard unavailable. Select the text in Edit result to copy it.",
    );
    if (copied !== "copied") setView("edit");
  };
  const download = () =>
    setFeedback(
      downloadStudioResult(text)
        ? "Your Markdown download has started."
        : "The download could not start. You can still copy your result.",
    );

  return (
    <section
      className="studio-result-review"
      aria-label="Review your model result"
    >
      <style>{resultStyles}</style>
      <div className="studio-result-review-header">
        <span className="studio-result-review-icon">
          <Sparkle size={24} weight="duotone" aria-hidden="true" />
        </span>
        <div>
          <span className="studio-eyebrow">THE RETURN TRIP</span>
          <h3>Meet your next draft.</h3>
        </div>
      </div>
      <div className="studio-result-review-origin">
        <strong>
          {origin === "final-document"
            ? "Extracted final document"
            : "Full pasted response"}
          {changedLocally ? " · Edited here" : ""}
        </strong>
        <p>
          {origin === "final-document"
            ? parsed.note
            : "This includes the full pasted response. Use Edit result to keep only the document you want."}
        </p>
        {parsed.mode === "full-response" &&
          parsed.note.startsWith("The document boundaries") && (
            <p>{parsed.note}</p>
          )}
      </div>
      <div
        className="studio-result-review-metrics"
        aria-label={
          sampled ? "Preview word counts" : "Source and result word counts"
        }
      >
        <div className="studio-result-review-metric">
          <span>{sampled ? "Source preview" : "Your source"}</span>
          <strong>{sourceWords.toLocaleString()}</strong>
          <span>words</span>
        </div>
        <ArrowRight size={18} color="#8d997b" aria-hidden="true" />
        <div className="studio-result-review-metric">
          <span>{sampled ? "Result preview" : "Your result"}</span>
          <strong>{resultWords.toLocaleString()}</strong>
          <span>words</span>
        </div>
        <div className="studio-result-review-delta">
          {sampled ? (
            <>
              Preview counts
              <br />
              First 50,000 characters
            </>
          ) : delta === 0 ? (
            "Same word count"
          ) : (
            <>
              {Math.abs(delta).toLocaleString()} {delta < 0 ? "fewer" : "more"}{" "}
              words
              {percentage !== null && (
                <>
                  <br />
                  {percentage}% {delta < 0 ? "shorter" : "longer"} by word count
                </>
              )}
            </>
          )}
        </div>
      </div>
      <div
        className="studio-result-review-tabs"
        role="group"
        aria-label="Result view"
      >
        <button
          type="button"
          aria-pressed={view === "read"}
          onClick={() => setView("read")}
        >
          <BookOpenText size={15} aria-hidden="true" />
          Read result
        </button>
        <button
          type="button"
          aria-pressed={view === "compare"}
          onClick={() => setView("compare")}
        >
          <ArrowsLeftRight size={15} aria-hidden="true" />
          Compare with source
        </button>
        <button
          type="button"
          aria-pressed={view === "edit"}
          onClick={() => setView("edit")}
        >
          <PencilSimple size={15} aria-hidden="true" />
          Edit result
        </button>
      </div>
      {view === "read" ? (
        <article
          className="studio-result-review-reader"
          aria-label="Your result reading preview"
        >
          <div className="studio-prose">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              skipHtml
              allowedElements={[
                "p",
                "h1",
                "h2",
                "h3",
                "h4",
                "h5",
                "h6",
                "strong",
                "em",
                "del",
                "blockquote",
                "ul",
                "ol",
                "li",
                "hr",
                "br",
                "pre",
                "code",
                "table",
                "thead",
                "tbody",
                "tr",
                "th",
                "td",
                "a",
                "img",
              ]}
              urlTransform={() => ""}
              components={{
                a: ({ children }) => (
                  <span className="studio-source-link">{children}</span>
                ),
                img: ({ alt }) => (
                  <span className="studio-source-image">
                    [Image: {alt || "referenced image"}]
                  </span>
                ),
              }}
            >
              {resultPreview ||
                "*Your result is empty. Choose Edit result to add text.*"}
            </ReactMarkdown>
          </div>
        </article>
      ) : view === "compare" ? (
        <div>
          <div className="studio-result-review-compare-heading">
            Your source → Your result
          </div>
          <CompareView
            originalText={sourcePreview}
            text={resultPreview}
            originalLabel="Your source"
            resultLabel="Your result"
          />
        </div>
      ) : (
        <div className="studio-result-review-edit">
          <label htmlFor={editorId}>Your result text</label>
          <textarea
            id={editorId}
            aria-label="Your result text"
            spellCheck
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setFeedback("");
            }}
          />
          <p className="studio-result-review-footnote">
            Select and remove any material you do not want in the final
            document. Your pasted response stays unchanged.
          </p>
        </div>
      )}
      <div className="studio-result-review-actions">
        <button
          type="button"
          className="studio-secondary"
          disabled={!text.trim()}
          onClick={() => void copy()}
        >
          <Copy size={15} aria-hidden="true" />
          Copy result
        </button>
        <button
          type="button"
          className="studio-secondary"
          disabled={!text.trim()}
          onClick={download}
        >
          <DownloadSimple size={15} aria-hidden="true" />
          Download Markdown
        </button>
        <span className="studio-result-review-feedback" role="status">
          {feedback}
        </span>
      </div>
      <div className="studio-result-review-notes">
        {sampled && (
          <p className="studio-result-review-footnote">
            Reading, comparison, and word counts show up to the first 50,000
            characters of each text. Copy and download include your complete
            result.
          </p>
        )}
        <p className="studio-result-review-footnote">
          Counts and highlights describe text changes; they do not verify
          meaning. Enable workspace remembering or export a workspace file
          to retain edits. Copy or download your result for a separate copy.
        </p>
        {parsed.audit !== null && (
          <details>
            <summary>The model’s fidelity notes</summary>
            <p className="studio-result-review-footnote">
              These are the model’s own notes, provided for you to review
              against the source.
            </p>
            <pre>{parsed.audit.slice(0, RESULT_PREVIEW_LIMIT)}</pre>
            {parsed.audit.length > RESULT_PREVIEW_LIMIT && (
              <p className="studio-result-review-footnote">
                The first 50,000 characters are shown. The complete notes remain
                in your pasted response.
              </p>
            )}
          </details>
        )}
        {parsed.mode === "final-document" && (
          <details>
            <summary>Choose what this review includes</summary>
            <button
              type="button"
              className="studio-result-review-reset"
              onClick={() => {
                const nextOrigin =
                  origin === "final-document"
                    ? "full-response"
                    : "final-document";
                setOrigin(nextOrigin);
                setText(
                  nextOrigin === "final-document" ? parsed.text : response,
                );
                setFeedback(
                  "The result text has been reset to your selection.",
                );
              }}
            >
              {origin === "final-document"
                ? "Reset to the full pasted response"
                : "Reset to the extracted final document"}
            </button>
          </details>
        )}
      </div>
    </section>
  );
}
