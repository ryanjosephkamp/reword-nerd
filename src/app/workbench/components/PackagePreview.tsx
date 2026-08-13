import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PromptStage } from "../../../domain";
import {
  createWorkbookProgress,
  editWorkbookPrompt,
  PROJECT_ONE_SHOT_RESPONSE_LABEL,
  reapplyWorkbookPrompt,
  renderWorkbookProgressHtml,
  resetWorkbookPrompt,
  updateWorkbookResponse,
  type DocumentWorkbook,
  type WorkbookProgress,
  type WorkbookResponseStage,
} from "../../../export";
import type { PackagePreviewTab } from "../contracts";
import { copyText, type CopyTextResult } from "../copyText";
import { RunbookView } from "./RunbookView";

const manualStages = ["decompose", "rewrite", "verify", "final"] as const;
type CopyStage = "oneShot" | PromptStage;
interface CopyView {
  documentKey: string | null;
  tab: PackagePreviewTab;
  stage: CopyStage;
  hidden: boolean;
}

const stageLabels: Record<PromptStage, string> = {
  decompose: "Decompose",
  rewrite: "Rewrite",
  verify: "Verify",
  final: "Final",
};

interface PackagePreviewProps {
  workbooks: readonly DocumentWorkbook[];
  selectedDocumentKey: string | null;
  tab: PackagePreviewTab;
  hidden?: boolean;
  onSelect(documentKey: string): void;
  onTabChange(tab: PackagePreviewTab): void;
  downloadProgressCopy(html: string, filename: string): { ok: true } | { ok: false };
  copyPromptText?(text: string): Promise<CopyTextResult>;
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
  tab,
  hidden = false,
  onSelect,
  onTabChange,
  downloadProgressCopy,
  copyPromptText = copyText,
}: PackagePreviewProps) {
  const workbook = useMemo(
    () => workbooks.find((candidate) => candidate.documentKey === selectedDocumentKey) ?? workbooks[0],
    [selectedDocumentKey, workbooks],
  );
  const [progressByDocument, setProgressByDocument] = useState(() => createProgressMap(workbooks));
  const [activeManualStage, setActiveManualStage] = useState<PromptStage>("decompose");
  const [status, setStatus] = useState("");
  const copyOperationRef = useRef(0);
  const viewGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const initialStage: CopyStage = tab === "one-shot" ? "oneShot" : activeManualStage;
  const currentViewRef = useRef<CopyView>({
    documentKey: workbook?.documentKey ?? null,
    tab,
    stage: initialStage,
    hidden,
  });
  const transitionCopyView = useCallback((next: CopyView) => {
    const current = currentViewRef.current;
    const changed = current.documentKey !== next.documentKey
      || current.tab !== next.tab
      || current.stage !== next.stage
      || current.hidden !== next.hidden;
    if (changed) {
      viewGenerationRef.current += 1;
    }
    currentViewRef.current = next;
  }, []);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      copyOperationRef.current += 1;
      viewGenerationRef.current += 1;
    };
  }, []);
  useLayoutEffect(() => {
    const stage: CopyStage = tab === "one-shot" ? "oneShot" : activeManualStage;
    const current = currentViewRef.current;
    if (current.documentKey !== (workbook?.documentKey ?? null)
      || current.tab !== tab
      || current.stage !== stage
      || current.hidden !== hidden) setStatus("");
    transitionCopyView({
      documentKey: workbook?.documentKey ?? null,
      tab,
      stage,
      hidden,
    });
  }, [activeManualStage, hidden, tab, transitionCopyView, workbook?.documentKey]);

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
  const changePrompt = (stage: CopyStage, text: string) => {
    updateProgress(editWorkbookPrompt(workbook, progress, stage, text));
  };
  const restorePrompt = (stage: CopyStage, action: "reset" | "reapply") => {
    updateProgress(action === "reset"
      ? resetWorkbookPrompt(workbook, progress, stage)
      : reapplyWorkbookPrompt(workbook, progress, stage));
  };
  const activateManualStage = (stage: PromptStage) => {
    if (currentViewRef.current.stage !== stage) setStatus("");
    transitionCopyView({ ...currentViewRef.current, stage });
    setActiveManualStage(stage);
  };
  const copyPrompt = async (
    stage: CopyStage,
    label: string,
    button: HTMLButtonElement,
  ) => {
    const promptState = stage === "oneShot" ? progress.oneShotPrompt : progress.manual.prompts[stage];
    transitionCopyView({
      documentKey: workbook.documentKey,
      tab,
      stage,
      hidden,
    });
    const operation = {
      token: ++copyOperationRef.current,
      viewGeneration: viewGenerationRef.current,
      documentKey: workbook.documentKey,
      tab,
      stage,
    };
    const result = await copyPromptText(promptState.text);
    const currentView = currentViewRef.current;
    if (!mountedRef.current
      || operation.token !== copyOperationRef.current
      || operation.viewGeneration !== viewGenerationRef.current
      || operation.documentKey !== currentView.documentKey
      || operation.tab !== currentView.tab
      || operation.stage !== currentView.stage
      || currentView.hidden) return;
    if (result === "copied") {
      setStatus(`${label} prompt copied.`);
    } else {
      setStatus(`Copy unavailable. Select the ${label} prompt text manually, then press Ctrl+C or Command+C.`);
    }
    if (button.isConnected) button.focus();
  };
  const selectTab = (nextTab: PackagePreviewTab, focus = false) => {
    const stage: CopyStage = nextTab === "one-shot" ? "oneShot" : activeManualStage;
    if (currentViewRef.current.tab !== nextTab) setStatus("");
    transitionCopyView({ ...currentViewRef.current, tab: nextTab, stage });
    onTabChange(nextTab);
    if (focus) document.getElementById(`package-workflow-${nextTab}`)?.focus();
  };
  const onWorkflowKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const tabs: readonly PackagePreviewTab[] = ["runbook", "one-shot", "manual"];
    const index = tabs.indexOf(tab);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    selectTab(tabs[nextIndex], true);
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

  return <article
    className="package-preview"
    aria-label={`Package workbook for ${workbook.originalDisplayName}`}
    hidden={hidden}
  >
    <div className="package-sticky-header">
      <div className="package-preview-controls">
        {workbooks.length > 1 ? <label className="artifact-selector">
          PACKAGE DOCUMENT
          <select
            aria-label="Package document"
            value={workbook.documentKey}
            onChange={(event) => {
              if (currentViewRef.current.documentKey !== event.target.value) setStatus("");
              transitionCopyView({ ...currentViewRef.current, documentKey: event.target.value });
              onSelect(event.target.value);
            }}
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
      <div className="package-document-heading"><h3>{workbook.originalDisplayName}</h3></div>
    </div>
    <div className="package-workflow-tabs" role="tablist" aria-label="Package workflow">
      <button
        type="button"
        role="tab"
        id="package-workflow-runbook"
        aria-controls="package-workflow-panel-runbook"
        aria-selected={tab === "runbook"}
        tabIndex={tab === "runbook" ? 0 : -1}
        onClick={(event) => { selectTab("runbook"); event.currentTarget.focus(); }}
        onKeyDown={onWorkflowKeyDown}
      >RUNBOOK</button>
      <button
        type="button"
        role="tab"
        id="package-workflow-one-shot"
        aria-controls="package-workflow-panel-one-shot"
        aria-selected={tab === "one-shot"}
        tabIndex={tab === "one-shot" ? 0 : -1}
        onClick={(event) => { selectTab("one-shot"); event.currentTarget.focus(); }}
        onKeyDown={onWorkflowKeyDown}
      >ONE-SHOT</button>
      <button
        type="button"
        role="tab"
        id="package-workflow-manual"
        aria-controls="package-workflow-panel-manual"
        aria-selected={tab === "manual"}
        tabIndex={tab === "manual" ? 0 : -1}
        onClick={(event) => { selectTab("manual"); event.currentTarget.focus(); }}
        onKeyDown={onWorkflowKeyDown}
      >MANUAL</button>
    </div>

    <section
      id="package-workflow-panel-runbook"
      className="package-workflow-panel runbook-preview"
      role="tabpanel"
      aria-labelledby="package-workflow-runbook"
      hidden={tab !== "runbook"}
    >
      {workbook.runbookDocument
        ? <RunbookView document={workbook.runbookDocument} />
        : <p>This package does not include a semantic runbook preview.</p>}
      {workbook.visualAssets.length > 0 ? <section className="package-assets" aria-labelledby="package-assets-heading">
        <h4 id="package-assets-heading">PACKAGED VISUAL ASSETS</h4>
        <ul>{workbook.visualAssets.map((asset) => <li key={asset.id}>
          <strong>{asset.id}</strong> — {asset.filename}{asset.included ? " (included)" : " (omitted)"}
        </li>)}</ul>
      </section> : null}
    </section>

    <section
      id="package-workflow-panel-one-shot"
      className="package-workflow-panel"
      role="tabpanel"
      aria-labelledby="package-workflow-one-shot"
      hidden={tab !== "one-shot"}
    >
      <div className="prompt-preview-block">
        <header><h4>ONE-SHOT</h4><button
          type="button"
          onClick={(event) => void copyPrompt("oneShot", "One-shot", event.currentTarget)}
        >Copy One-shot</button></header>
        <label htmlFor="package-prompt-oneShot">Editable One-shot prompt</label>
        <textarea
          id="package-prompt-oneShot"
          rows={20}
          value={progress.oneShotPrompt.text}
          onFocus={() => transitionCopyView({ ...currentViewRef.current, stage: "oneShot" })}
          onChange={(event) => changePrompt("oneShot", event.target.value)}
        />
        <div className="package-prompt-actions">
          <button type="button" onClick={() => restorePrompt("oneShot", "reset")}>Reset One-shot prompt</button>
        </div>
        <label htmlFor="package-response-oneShot">{workbook.sourceKind === "project"
          ? PROJECT_ONE_SHOT_RESPONSE_LABEL
          : "One-shot final document and compact audit"}</label>
        <textarea
          id="package-response-oneShot"
          rows={12}
          value={progress.responses.oneShot}
          onFocus={() => transitionCopyView({ ...currentViewRef.current, stage: "oneShot" })}
          onChange={(event) => changeResponse("oneShot", event.target.value)}
        />
      </div>
    </section>

    <section
      id="package-workflow-panel-manual"
      className="package-workflow-panel"
      role="tabpanel"
      aria-labelledby="package-workflow-manual"
      hidden={tab !== "manual"}
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
            onFocus={() => activateManualStage(stage)}
            onChange={(event) => { activateManualStage(stage); changePrompt(stage, event.target.value); }}
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
            onFocus={() => activateManualStage(stage)}
            onChange={(event) => { activateManualStage(stage); changeResponse(stage, event.target.value); }}
          />
        </section>;
      })}
    </section>
  </article>;
}
