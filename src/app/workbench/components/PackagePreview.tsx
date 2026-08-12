import { useMemo, useState } from "react";
import type { PromptStage } from "../../../domain";
import {
  createWorkbookProgress,
  editWorkbookPrompt,
  reapplyWorkbookPrompt,
  renderWorkbookProgressHtml,
  resetWorkbookPrompt,
  updateWorkbookResponse,
  type DocumentWorkbook,
  type WorkbookProgress,
  type WorkbookResponseStage,
} from "../../../export";
import type { PackageWorkflow } from "../contracts";
import { copyText } from "../copyText";

const manualStages = ["decompose", "rewrite", "verify", "final"] as const;

const stageLabels: Record<PromptStage, string> = {
  decompose: "Decompose",
  rewrite: "Rewrite",
  verify: "Verify",
  final: "Final",
};

interface PackagePreviewProps {
  workbooks: readonly DocumentWorkbook[];
  selectedDocumentKey: string | null;
  workflow: PackageWorkflow;
  onSelect(documentKey: string): void;
  onWorkflowChange(workflow: PackageWorkflow): void;
  downloadProgressCopy(html: string, filename: string): { ok: true } | { ok: false };
}

function createProgressMap(workbooks: readonly DocumentWorkbook[]) {
  return Object.fromEntries(workbooks.map((workbook) => [
    workbook.documentKey,
    createWorkbookProgress(workbook),
  ])) as Record<string, Readonly<WorkbookProgress>>;
}

export function PackagePreview({
  workbooks,
  selectedDocumentKey,
  workflow,
  onSelect,
  onWorkflowChange,
  downloadProgressCopy,
}: PackagePreviewProps) {
  const workbook = useMemo(
    () => workbooks.find((candidate) => candidate.documentKey === selectedDocumentKey) ?? workbooks[0],
    [selectedDocumentKey, workbooks],
  );
  const [progressByDocument, setProgressByDocument] = useState(() => createProgressMap(workbooks));
  const [activeManualStage, setActiveManualStage] = useState<PromptStage>("decompose");
  const [status, setStatus] = useState("");

  if (!workbook) {
    return <div className="package-preview-empty">No package workbook is available.</div>;
  }

  const progress = progressByDocument[workbook.documentKey] ?? createWorkbookProgress(workbook);
  const updateProgress = (next: Readonly<WorkbookProgress>) => {
    setProgressByDocument((current) => ({ ...current, [workbook.documentKey]: next }));
  };
  const changeResponse = (stage: WorkbookResponseStage, response: string) => {
    updateProgress(updateWorkbookResponse(workbook, progress, stage, response));
  };
  const changePrompt = (stage: "oneShot" | PromptStage, text: string) => {
    updateProgress(editWorkbookPrompt(workbook, progress, stage, text));
  };
  const restorePrompt = (stage: "oneShot" | PromptStage, action: "reset" | "reapply") => {
    updateProgress(action === "reset"
      ? resetWorkbookPrompt(workbook, progress, stage)
      : reapplyWorkbookPrompt(workbook, progress, stage));
  };
  const copyPrompt = async (
    stage: "oneShot" | PromptStage,
    label: string,
    button: HTMLButtonElement,
  ) => {
    const promptState = stage === "oneShot" ? progress.oneShotPrompt : progress.manual.prompts[stage];
    const result = await copyText(promptState.text);
    if (result === "copied") {
      setStatus(`${label} prompt copied.`);
    } else {
      setStatus(`Copy unavailable. Select the ${label} prompt text manually, then press Ctrl+C or Command+C.`);
    }
    button.focus();
  };
  const selectWorkflow = (nextWorkflow: PackageWorkflow, focus = false) => {
    onWorkflowChange(nextWorkflow);
    if (focus) document.getElementById(`package-workflow-${nextWorkflow}`)?.focus();
  };
  const onWorkflowKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const index = workflow === "one-shot" ? 0 : 1;
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") nextIndex = index === 0 ? 1 : 0;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = 1;
    if (nextIndex === null) return;
    event.preventDefault();
    selectWorkflow(nextIndex === 0 ? "one-shot" : "manual", true);
  };
  const saveProgressCopy = (button: HTMLButtonElement) => {
    const result = downloadProgressCopy(
      renderWorkbookProgressHtml(workbook, progress),
      `${workbook.documentKey}-progress.html`,
    );
    setStatus(result.ok
      ? "Progress copy downloaded."
      : "Progress copy could not be downloaded. Your package remains available.");
    button.focus();
  };

  return <article className="package-preview" aria-label={`Package workbook for ${workbook.originalDisplayName}`}>
    <div className="package-preview-controls">
      {workbooks.length > 1 ? <label className="artifact-selector">
        PACKAGE DOCUMENT
        <select
          aria-label="Package document"
          value={workbook.documentKey}
          onChange={(event) => onSelect(event.target.value)}
        >
          {workbooks.map((candidate) => <option key={candidate.documentKey} value={candidate.documentKey}>
            {candidate.originalDisplayName}
          </option>)}
        </select>
      </label> : null}
      <div className="package-top-actions">
        <button
          type="button"
          onClick={(event) => void copyPrompt("oneShot", "One-shot", event.currentTarget)}
        >COPY ONE-SHOT PROMPT</button>
        <button
          type="button"
          disabled={!progress.manual.prompts[activeManualStage].copyEnabled}
          onClick={(event) => void copyPrompt(activeManualStage, stageLabels[activeManualStage], event.currentTarget)}
        >COPY CURRENT MANUAL PROMPT</button>
        <button type="button" onClick={(event) => saveProgressCopy(event.currentTarget)}>
          DOWNLOAD PROGRESS COPY
        </button>
      </div>
      <p className="package-copy-status" role="status" aria-live="polite" aria-atomic="true">{status}</p>
    </div>

    <h3>{workbook.originalDisplayName}</h3>
    <div className="package-workflow-tabs" role="tablist" aria-label="Package workflow">
      <button
        type="button"
        role="tab"
        id="package-workflow-one-shot"
        aria-controls="package-workflow-panel-one-shot"
        aria-selected={workflow === "one-shot"}
        tabIndex={workflow === "one-shot" ? 0 : -1}
        onClick={(event) => { selectWorkflow("one-shot"); event.currentTarget.focus(); }}
        onKeyDown={onWorkflowKeyDown}
      >ONE-SHOT</button>
      <button
        type="button"
        role="tab"
        id="package-workflow-manual"
        aria-controls="package-workflow-panel-manual"
        aria-selected={workflow === "manual"}
        tabIndex={workflow === "manual" ? 0 : -1}
        onClick={(event) => { selectWorkflow("manual"); event.currentTarget.focus(); }}
        onKeyDown={onWorkflowKeyDown}
      >MANUAL</button>
    </div>

    <section className="runbook-preview" aria-labelledby="package-runbook-heading">
      <h4 id="package-runbook-heading">PACKAGE RUNBOOK</h4>
      <pre><code>{workbook.runbookMarkdown}</code></pre>
    </section>

    <section
      id="package-workflow-panel-one-shot"
      className="package-workflow-panel"
      role="tabpanel"
      aria-labelledby="package-workflow-one-shot"
      hidden={workflow !== "one-shot"}
    >
      <div className="prompt-preview-block">
        <header><h4>ONE-SHOT</h4></header>
        <label htmlFor="package-prompt-oneShot">Editable One-shot prompt</label>
        <textarea
          id="package-prompt-oneShot"
          rows={20}
          value={progress.oneShotPrompt.text}
          onChange={(event) => changePrompt("oneShot", event.target.value)}
        />
        <div className="package-prompt-actions">
          <button type="button" onClick={() => restorePrompt("oneShot", "reset")}>Reset One-shot prompt</button>
        </div>
        <label htmlFor="package-response-oneShot">One-shot final document and compact audit</label>
        <textarea
          id="package-response-oneShot"
          rows={12}
          value={progress.responses.oneShot}
          onChange={(event) => changeResponse("oneShot", event.target.value)}
        />
      </div>
    </section>

    <section
      id="package-workflow-panel-manual"
      className="package-workflow-panel"
      role="tabpanel"
      aria-labelledby="package-workflow-manual"
      hidden={workflow !== "manual"}
    >
      {manualStages.map((stage) => {
        const prompt = progress.manual.prompts[stage];
        const title = workbook.manual.promptBlocks.find((block) => block.stage === stage)?.title
          ?? `Stage ${manualStages.indexOf(stage) + 1} — ${stageLabels[stage]}`;
        return <section className="prompt-preview-block" key={stage} aria-labelledby={`package-stage-${stage}`}>
          <header>
            <h4 id={`package-stage-${stage}`}>{title.toUpperCase()}</h4>
            <button
              type="button"
              disabled={!prompt.copyEnabled}
              onClick={(event) => void copyPrompt(stage, stageLabels[stage], event.currentTarget)}
            >Copy {stageLabels[stage]}</button>
          </header>
          <p className="package-prerequisite">
            {prompt.copyEnabled ? "Ready to copy." : "Add the required earlier responses to enable Copy."}
          </p>
          <label htmlFor={`package-prompt-${stage}`}>Editable {title} prompt</label>
          <textarea
            id={`package-prompt-${stage}`}
            rows={16}
            value={prompt.text}
            onFocus={() => setActiveManualStage(stage)}
            onChange={(event) => { setActiveManualStage(stage); changePrompt(stage, event.target.value); }}
          />
          {prompt.stale ? <p className="package-stale" role="status">
            Upstream responses changed. Review this preserved edit, then choose Reapply.
          </p> : null}
          <div className="package-prompt-actions">
            <button type="button" onClick={() => restorePrompt(stage, "reset")}>Reset {stageLabels[stage]} prompt</button>
            <button
              type="button"
              disabled={!prompt.stale}
              onClick={() => restorePrompt(stage, "reapply")}
            >Reapply {stageLabels[stage]} prompt</button>
          </div>
          <label htmlFor={`package-response-${stage}`}>
            {title} model response{stage === "final" ? " (optional for progress copy)" : ""}
          </label>
          <textarea
            id={`package-response-${stage}`}
            rows={10}
            value={progress.responses[stage]}
            onFocus={() => setActiveManualStage(stage)}
            onChange={(event) => { setActiveManualStage(stage); changeResponse(stage, event.target.value); }}
          />
        </section>;
      })}
    </section>

    {workbook.visualAssets.length > 0 ? <section className="package-assets" aria-labelledby="package-assets-heading">
      <h4 id="package-assets-heading">PACKAGED VISUAL ASSETS</h4>
      <ul>{workbook.visualAssets.map((asset) => <li key={asset.id}>
        <strong>{asset.id}</strong> — {asset.filename}{asset.included ? " (included)" : " (omitted)"}
      </li>)}</ul>
    </section> : null}
  </article>;
}
