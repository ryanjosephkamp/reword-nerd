import { useWorkspaceState } from "../../workspace/Workspace";
import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle,
  Copy,
  DownloadSimple,
  Lightning,
  ListNumbers,
  Sparkle,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  createWorkbookProgress,
  updateWorkbookResponse,
  renderWorkbookProgressHtml,
  initiateWorkbookProgressDownload,
  type DocumentWorkbook,
  type WorkbookResponseStage,
} from "../../export";
import type { PromptStage } from "../../domain";
import { copyText } from "../workbench/copyText";
import { StudioResultReview } from "./StudioResultReview";

const stages: { id: PromptStage; label: string; description: string }[] = [
  {
    id: "decompose",
    label: "Decompose",
    description: "Map the claims, structure, and details that must survive.",
  },
  {
    id: "rewrite",
    label: "Rewrite",
    description: "Give your ideas a new expression, grounded in the source.",
  },
  {
    id: "verify",
    label: "Verify",
    description:
      "Compare the rewrite with the source and inspect what changed.",
  },
  {
    id: "final",
    label: "Final",
    description: "Resolve the findings and bring your document home.",
  },
];

function useWorkbookState<T>(workbook: DocumentWorkbook, field: string, initial: T | (() => T)) {
  return useWorkspaceState(`package:${workbook.documentKey}:${field}`, initial, { binding: workbook.oneShot.prompt });
}

export function StudioPackage({
  workbook,
  onDownload,
  sourceText,
  demoResponse,
}: {
  workbook: DocumentWorkbook;
  onDownload(): void;
  sourceText: string;
  demoResponse?: string;
}) {
  const [mode, setMode] = useWorkbookState<"oneShot" | "manual">(workbook, "mode", "oneShot");
  const [active, setActive] = useWorkbookState<PromptStage>(workbook, "active", "decompose");
  const [progress, setProgress] = useWorkbookState(workbook, "progress", () =>
    createWorkbookProgress(workbook),
  );
  const [feedback, setFeedback] = useState("");
  const [showPrompt, setShowPrompt] = useWorkbookState(workbook, "showPrompt", true);
  const [reviewResult, setReviewResult] = useWorkbookState(workbook, "reviewResult", false);
  const [illustration, setIllustration] = useWorkbookState(workbook, "illustration", false);
  const [responsesToRevisit, setResponsesToRevisit] = useWorkbookState<
    Set<PromptStage>
  >(workbook, "responsesToRevisit", () => new Set());
  const stage: WorkbookResponseStage = mode === "oneShot" ? "oneShot" : active;
  const prompt =
    mode === "oneShot"
      ? progress.oneShotPrompt
      : progress.manual.prompts[active];
  const completed = useMemo(
    () => stages.filter((item) => progress.responses[item.id].trim()).length,
    [progress],
  );
  const copy = async () =>
    setFeedback(
      (await copyText(prompt.text)) === "copied"
        ? "Prompt copied. Ready for your model."
        : "Clipboard unavailable. Select and copy the prompt below.",
    );
  const saveProgress = () => {
    const result = initiateWorkbookProgressDownload(
      renderWorkbookProgressHtml(workbook, progress),
      `${workbook.documentKey}-progress.html`,
    );
    setFeedback(
      result.ok
        ? "Your progress copy is downloaded."
        : "Download could not start. Try again.",
    );
  };
  return (
    <section className="studio-package" aria-label="Prompt workspace">
      <div className="studio-package-success">
        <CheckCircle size={24} weight="fill" />
        <div>
          <strong>Your prompt package is ready.</strong>
          <span>
            Original source, prompts, and a standalone workbook.
          </span>
        </div>
        <button className="studio-secondary" onClick={onDownload}>
          <DownloadSimple size={16} /> Download ZIP
        </button>
      </div>
      <div className="studio-package-mode">
        <button
          aria-pressed={mode === "oneShot"}
          onClick={() => setMode("oneShot")}
        >
          <Lightning size={18} /> One-shot{" "}
          <span>One prompt. All four stages.</span>
        </button>
        <button
          aria-pressed={mode === "manual"}
          onClick={() => setMode("manual")}
        >
          <ListNumbers size={18} /> Guided workflow{" "}
          <span>Review every stage.</span>
        </button>
      </div>
      {mode === "manual" && (
        <div className="studio-stage-tabs" aria-label="Stage history">
          {stages.map((item, i) => (
            <button
              key={item.id}
              aria-pressed={active === item.id}
              onClick={() => {
                setActive(item.id);
                setFeedback("");
              }}
            >
              <span
                className={
                  responsesToRevisit.has(item.id)
                    ? "needs-review"
                    : progress.responses[item.id].trim()
                      ? "complete"
                      : ""
                }
                style={
                  responsesToRevisit.has(item.id)
                    ? { background: "#f0dbc1", color: "#765125" }
                    : undefined
                }
                title={
                  responsesToRevisit.has(item.id)
                    ? "An earlier response changed. Revisit this response."
                    : undefined
                }
              >
                {responsesToRevisit.has(item.id) ? (
                  <WarningCircle size={14} aria-label="Needs review" />
                ) : progress.responses[item.id].trim() ? (
                  <Check size={13} />
                ) : (
                  i + 1
                )}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      )}
      <div className="studio-prompt-intro">
        <div>
          <span className="studio-eyebrow">
            {mode === "oneShot"
              ? "THE COMPLETE WORKFLOW"
              : `STEP ${stages.findIndex((item) => item.id === active) + 1} OF 4`}
          </span>
          <h2>
            {mode === "oneShot"
              ? "One-shot workflow."
              : stages.find((item) => item.id === active)?.label}
          </h2>
          <p>
            {mode === "oneShot"
              ? "Copy this prompt into your chosen model. It includes your source, writing brief, and the four-stage method."
              : stages.find((item) => item.id === active)?.description}
          </p>
        </div>
        <button
          className="studio-primary"
          disabled={!prompt.copyEnabled}
          onClick={() => void copy()}
        >
          <Copy size={17} /> Copy prompt
        </button>
      </div>
      {!prompt.copyEnabled && (
        <p className="studio-notice">
          <WarningCircle size={18} /> Paste the earlier model responses to
          prepare this prompt.
        </p>
      )}
      <button
        className="studio-prompt-toggle"
        aria-expanded={showPrompt}
        onClick={() => setShowPrompt(!showPrompt)}
      >
        {showPrompt ? "Hide" : "Inspect"} the full prompt{" "}
        <ArrowDown size={14} />
      </button>
      {showPrompt && (
        <textarea
          className="studio-prompt-code"
          aria-label="Generated prompt"
          value={prompt.text}
          readOnly
          spellCheck={false}
        />
      )}
      <div className="studio-response-heading">
        <div>
          <span className="studio-eyebrow">MODEL RESPONSE</span>
          <h3>
            {mode === "oneShot"
              ? "Paste your model’s response"
              : `${stages.find((item) => item.id === active)?.label} response`}
          </h3>
        </div>
        <span className="studio-local-label">Stored in this tab only</span>
      </div>
      {stage !== "oneShot" && responsesToRevisit.has(stage) && (
        <div
          className="studio-notice"
          role="status"
          style={{ display: "block" }}
        >
          <p>
            <WarningCircle
              size={17}
              style={{ verticalAlign: "middle", marginRight: 6 }}
            />
            An earlier response changed. Review or replace this response against
            the updated inputs before continuing. Your existing text is
            preserved.
          </p>
          <button
            type="button"
            className="studio-secondary"
            onClick={() =>
              setResponsesToRevisit((previous) => {
                const next = new Set(previous);
                next.delete(stage);
                return next;
              })
            }
          >
            Reviewed against updated inputs
          </button>
        </div>
      )}
      {(stage === "oneShot" || stage === "final") &&
        progress.responses[stage].trim() && (
          <p className="studio-progress-scope">
            Changing this pasted response starts a fresh result review. Download
            edited Markdown first.
          </p>
        )}
      <textarea
        className="studio-response"
        aria-label="Model response"
        placeholder="Run the prompt in your model, then paste its response here…"
        value={progress.responses[stage]}
        onChange={(event) => {
          const response = event.target.value;
          if (stage !== "oneShot" && response !== progress.responses[stage]) {
            const stageIndex = stages.findIndex((item) => item.id === stage);
            setResponsesToRevisit((previous) => {
              const next = new Set(previous);
              next.delete(stage);
              for (const downstream of stages.slice(stageIndex + 1)) {
                if (progress.responses[downstream.id].trim())
                  next.add(downstream.id);
              }
              return next;
            });
          }
          setProgress(
            updateWorkbookResponse(workbook, progress, stage, response),
          );
          setIllustration(false);
        }}
      />
      {mode === "oneShot" && demoResponse && !progress.responses.oneShot && (
        <button
          className="studio-demo-response"
          onClick={() => {
            setProgress(
              updateWorkbookResponse(
                workbook,
                progress,
                "oneShot",
                demoResponse,
              ),
            );
            setIllustration(true);
            setReviewResult(true);
            setFeedback("Prewritten sample loaded. No model was called.");
          }}
        >
          <Sparkle size={15} /> Try a sample response{" "}
          <span>Prewritten · no model call</span>
        </button>
      )}
      {illustration && (
        <p className="studio-sample-result-note">
          Illustrative sample response. It does not adapt to your brief and has
          not been verified by a model.
        </p>
      )}
      {(stage === "oneShot" || stage === "final") &&
        progress.responses[stage].trim() && (
          <button
            className="studio-secondary studio-result-toggle"
            aria-expanded={reviewResult}
            onClick={() => setReviewResult(!reviewResult)}
          >
            <BookOpen size={16} />
            {reviewResult ? "Close result reader" : "Review result"}{" "}
            <ArrowRight size={15} />
          </button>
        )}
      {(["oneShot", "final"] as const).map((resultStage) =>
        progress.responses[resultStage].trim() ? (
          <div
            hidden={!reviewResult || stage !== resultStage}
            key={resultStage}
          >
            <StudioResultReview
              sourceText={sourceText}
              workspaceKey={`${workbook.documentKey}:${resultStage}`}
              response={progress.responses[resultStage]}
            />
          </div>
        ) : null,
      )}
      <div className="studio-package-footer">
        <button className="studio-secondary" onClick={saveProgress}>
          <DownloadSimple size={15} /> Save progress HTML
        </button>
        {mode === "manual" && (
          <>
            <span>{completed}/4 responses added</span>
            {active !== "final" && (
              <button
                className="studio-primary"
                onClick={() =>
                  setActive(
                    stages[stages.findIndex((item) => item.id === active) + 1]
                      .id,
                  )
                }
              >
                Next step <ArrowRight size={16} />
              </button>
            )}
          </>
        )}
      </div>
      {(progress.responses.oneShot.trim() ||
        progress.responses.final.trim()) && (
        <p className="studio-progress-scope">
          Progress HTML stores your pasted responses. Use Download Markdown to
          keep edits made in the result reader.
        </p>
      )}
      <p className="studio-feedback" role="status">
        {feedback}
      </p>
    </section>
  );
}
