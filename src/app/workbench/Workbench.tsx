import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { assessContext, composeExtractionWithOcr, type OcrReviewStatus, type RewriteSettings } from "../../domain";
import type { MobileTab, WorkbenchServices } from "./contracts";
import { createInitialWorkbenchState, workbenchReducer } from "./reducer";
import {
  selectContextAssessment,
  selectCounts,
  selectDirty,
  selectSelectedDocument,
  selectSelectedVisualAsset,
} from "./selectors";
import { defaultWorkbenchServices } from "./services";
import { useBeforeUnloadWarning } from "./useBeforeUnloadWarning";
import { useExportPackage } from "./useExportPackage";
import { useFileIntake } from "./useFileIntake";
import { useReviewEditor } from "./useReviewEditor";
import { ContextMeter } from "./components/ContextMeter";
import { ExportPanel } from "./components/ExportPanel";
import { ExtractedTextEditor } from "./components/ExtractedTextEditor";
import { FileQueue } from "./components/FileQueue";
import { Header } from "./components/Header";
import { HelpDialog } from "./components/HelpDialog";
import { QuickStartDialog } from "./components/QuickStartDialog";
import { ResetPreferencesDialog } from "./components/ResetPreferencesDialog";
import { InfoDialog } from "./components/InfoDialog";
import { NewSessionDialog } from "./components/NewSessionDialog";
import { APP_VERSION } from "../../version";
import { MobileTabs } from "./components/MobileTabs";
import { PackagePreview } from "./components/PackagePreview";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { SettingsInspector } from "./components/SettingsInspector";
import { StatusSummary } from "./components/StatusSummary";
import { UploadDropZone } from "./components/UploadDropZone";
import { AssetGallery } from "./components/AssetGallery";
import { OcrReview } from "./components/OcrReview";
import { DocumentIcon, MoreIcon } from "./components/Icons";
import {
  clearSavedPreferences,
  loadSavedPreferences,
  savePreferences,
  snapshotPreferences,
} from "./preferences";

type ResponsiveMode = "desktop" | "tablet" | "mobile";

function panelAccessibility(
  mode: ResponsiveMode,
  active: MobileTab,
  panel: MobileTab,
  desktopLabel: string,
) {
  return mode === "mobile" ? {
    role: "tabpanel" as const,
    "aria-labelledby": `tab-${panel}`,
    hidden: active !== panel,
  } : {
    role: "region" as const,
    "aria-label": desktopLabel,
  };
}

function currentMode(): ResponsiveMode {
  if (typeof window.matchMedia !== "function") return "desktop";
  if (window.matchMedia("(max-width: 767px)").matches) return "mobile";
  if (window.matchMedia("(max-width: 1279px)").matches) return "tablet";
  return "desktop";
}

function useResponsiveMode(): ResponsiveMode {
  const [mode, setMode] = useState<ResponsiveMode>(currentMode);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mobile = window.matchMedia("(max-width: 767px)");
    const tablet = window.matchMedia("(max-width: 1279px)");
    const update = () => setMode(mobile.matches ? "mobile" : tablet.matches ? "tablet" : "desktop");
    mobile.addEventListener("change", update);
    tablet.addEventListener("change", update);
    return () => {
      mobile.removeEventListener("change", update);
      tablet.removeEventListener("change", update);
    };
  }, []);
  return mode;
}

export function Workbench({ services = defaultWorkbenchServices }: { services?: WorkbenchServices }) {
  const [state, dispatch] = useReducer(
    workbenchReducer,
    undefined,
    () => createInitialWorkbenchState(loadSavedPreferences()),
  );
  const [busyOcrCandidate, setBusyOcrCandidate] = useState<string | null>(null);
  const mode = useResponsiveMode();
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const helpReturnFocusRef = useRef<HTMLButtonElement>(null);
  const infoReturnFocusRef = useRef<HTMLButtonElement>(null);
  const newSessionReturnFocusRef = useRef<HTMLButtonElement>(null);
  const parametersHeadingRef = useRef<HTMLHeadingElement>(null);
  const packageHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousMobileTabRef = useRef(state.mobileTab);
  const preferenceEffectReadyRef = useRef(false);
  const suppressPreferenceWriteRef = useRef(false);
  const resetPreferencesReturnFocusRef = useRef<HTMLButtonElement>(null);
  const intake = useFileIntake(state, dispatch, services);
  const editor = useReviewEditor(state, dispatch, services);
  const exporter = useExportPackage(state, dispatch, services);
  const selected = selectSelectedDocument(state);
  const selectedAsset = selected ? selectSelectedVisualAsset(state, selected.id) : undefined;
  const counts = selectCounts(state);
  const dirty = selectDirty(state);
  const preferenceSnapshot = useMemo(() => snapshotPreferences({
    selectedProfileId: state.selectedProfileId,
    customProfileLabel: state.customProfileLabel,
    workingProfile: state.workingProfile,
    globalSettings: state.globalSettings,
    globalExtractionOptions: state.globalExtractionOptions,
    tutorialSeenVersion: state.tutorialSeenVersion,
  }), [
    state.customProfileLabel,
    state.globalExtractionOptions,
    state.globalSettings,
    state.selectedProfileId,
    state.tutorialSeenVersion,
    state.workingProfile,
  ]);
  useEffect(() => {
    if (!preferenceEffectReadyRef.current) {
      preferenceEffectReadyRef.current = true;
      return;
    }
    if (suppressPreferenceWriteRef.current) {
      suppressPreferenceWriteRef.current = false;
      return;
    }
    savePreferences(preferenceSnapshot);
  }, [preferenceSnapshot]);
  useBeforeUnloadWarning(dirty || state.export.status === "building" || state.export.status === "downloading");
  useEffect(() => {
    if (state.focusTarget !== "upload") return;
    intake.addButtonRef.current?.focus();
    dispatch({ type: "focus/consumed" });
  }, [intake.addButtonRef, state.focusTarget]);
  useEffect(() => {
    if (state.focusTarget !== "package-preview") return;
    packageHeadingRef.current?.focus();
    dispatch({ type: "focus/consumed" });
  }, [state.focusTarget]);
  useEffect(() => {
    const changed = previousMobileTabRef.current !== state.mobileTab;
    previousMobileTabRef.current = state.mobileTab;
    if (mode === "mobile" && changed && !state.focusTarget) {
      document.getElementById(`tab-${state.mobileTab}`)?.focus();
    }
  }, [mode, state.focusTarget, state.mobileTab]);

  const context = useMemo(() => {
    if (!selected || selected.status === "blocked" || selected.status === "error") return null;
    try {
      return selectContextAssessment(state, selected.id);
    } catch {
      return assessContext(selected.extractedText, null);
    }
  }, [selected, state]);

  const exportPanel = <ExportPanel
    buildDisabled={Boolean(exporter.blocker)
      || state.export.status === "building"
      || state.export.status === "downloading"
      || Boolean(state.export.builtPackage)}
    downloadDisabled={!state.export.builtPackage
      || state.export.builtRevision !== state.revision
      || state.export.status === "building"
      || state.export.status === "downloading"}
    status={state.export.status}
    message={state.export.safeMessage}
    onBuild={() => void exporter.build()}
    onDownload={exporter.download}
  />;

  const settingsProps = {
    state,
    onGlobalChange: (field: keyof RewriteSettings, value: RewriteSettings[keyof RewriteSettings]) => dispatch({ type: "settings/global-changed", field, value }),
    onOverrideEnabled: (enabled: boolean) => { if (selected) dispatch({ type: "settings/override-enabled", documentId: selected.id, enabled }); },
    onOverrideChange: (field: keyof RewriteSettings, value: RewriteSettings[keyof RewriteSettings]) => { if (selected) dispatch({ type: "settings/override-changed", documentId: selected.id, field, value }); },
    onProfileSelected: (profileId: string) => dispatch({ type: "profile/selected", profileId }),
    onProfileLabel: (value: string) => dispatch({ type: "profile/custom-label-changed", value }),
    onContextDraft: (value: string, parsed: number | null | undefined) => dispatch({ type: "profile/custom-context-draft-changed", value, parsed }),
    onExtractionOptionsChange: (options: import("../../domain").ExtractionOptions, reprocess: boolean) => {
      if (selected && reprocess) {
        dispatch({ type: "processing/options-changed", documentId: selected.id, options });
        intake.retry(selected.id, options);
      } else dispatch({ type: "processing/global-options-changed", options });
    },
    onResetPreferences: (returnFocus: HTMLButtonElement) => {
      resetPreferencesReturnFocusRef.current = returnFocus;
      dispatch({ type: "preferences/reset-requested" });
    },
  };
  const settings = <SettingsInspector {...settingsProps} exportPanel={mode === "desktop" ? exportPanel : undefined} />;

  const openSettings = () => {
    if (mode === "mobile") dispatch({ type: "mobile/tab-changed", tab: "settings" });
    else if (mode === "tablet") dispatch({ type: "drawer/changed", open: true });
    else dispatch({ type: "desktop/settings-expanded", expanded: !state.desktopSettingsExpanded });
  };
  const revealSettings = () => {
    if (mode === "mobile") dispatch({ type: "mobile/tab-changed", tab: "settings" });
    else if (mode === "tablet") dispatch({ type: "drawer/changed", open: true });
    else {
      parametersHeadingRef.current?.focus();
      dispatch({ type: "desktop/settings-expanded", expanded: true });
      queueMicrotask(() => parametersHeadingRef.current?.focus());
    }
  };
  const removeSelectedFromPreview = () => {
    if (!selected) return;
    if (mode === "mobile") dispatch({ type: "mobile/tab-changed", tab: "files" });
    dispatch({ type: "document/removed", documentId: selected.id });
  };
  const reviewOcrCandidate = async (candidateId: string, status: OcrReviewStatus, reviewedText: string) => {
    if (!selected || busyOcrCandidate) return;
    setBusyOcrCandidate(candidateId);
    try {
      const candidates = (selected.ocrCandidates ?? []).map((candidate) => candidate.id === candidateId
        ? { ...candidate, status, reviewedText }
        : candidate);
      const composedText = composeExtractionWithOcr(selected.baseExtractedText ?? selected.extractedText, candidates);
      const composedHash = await services.hashText(composedText);
      dispatch({
        type: "ocr/candidate-reviewed",
        documentId: selected.id,
        candidateId,
        status,
        reviewedText,
        composedText,
        composedHash,
      });
    } finally {
      setBusyOcrCandidate(null);
    }
  };

  return <main className="workbench" aria-label="reword_nerd workbench">
    <Header
      onOpenFiles={intake.openFilePicker}
      onOpenSettings={openSettings}
      onOpenHelp={(returnFocus) => {
        helpReturnFocusRef.current = returnFocus;
        dispatch({ type: "overlay/opened", overlay: "help" });
      }}
      onOpenInfo={(returnFocus) => { infoReturnFocusRef.current = returnFocus; dispatch({ type: "overlay/opened", overlay: "info" }); }}
      onNewSession={(returnFocus) => { newSessionReturnFocusRef.current = returnFocus; dispatch({ type: "session/reset-requested" }); }}
      settingsExpanded={mode === "tablet" ? state.activeOverlay === "settings" : state.desktopSettingsExpanded}
      settingsControls={mode === "tablet" ? "settings-drawer" : "panel-settings"}
      settingsButtonRef={settingsButtonRef}
    />
    <MobileTabs active={state.mobileTab} onChange={(tab) => dispatch({ type: "mobile/tab-changed", tab })} />
    <div className={`workbench-grid${mode === "desktop" && !state.desktopSettingsExpanded ? " settings-collapsed" : ""}`}>
      <aside
        id="panel-files"
        {...panelAccessibility(mode, state.mobileTab, "files", "Files")}
        className={`files-panel mobile-panel${state.documents.length > 0 ? " has-documents" : ""}${state.mobileTab === "files" ? " is-mobile-active" : ""}`}
        onDragEnter={intake.onDragEnter}
        onDragLeave={intake.onDragLeave}
        onDragOver={intake.onDragOver}
        onDrop={intake.onDrop}
      >
        <div className="panel-heading"><h2>FILES [{state.documents.length}]</h2></div>
        <UploadDropZone
          inputRef={intake.inputRef}
          addButtonRef={intake.addButtonRef}
          dragging={state.intake.dragging}
          hasDocuments={state.documents.length > 0}
          onOpen={intake.openFilePicker}
          onChange={intake.onInputChange}
        />
        <FileQueue
          documents={state.documents}
          selectedId={state.selectedDocumentId}
          focusTarget={state.focusTarget}
          onSelect={(documentId) => dispatch({ type: "selection/changed", documentId })}
          onRemove={(documentId) => dispatch({ type: "document/removed", documentId })}
          onFocusConsumed={() => dispatch({ type: "focus/consumed" })}
        />
        {state.intake.issues.length > 0 ? <ul className="intake-issues">{state.intake.issues.map((issue, index) => <li key={`${issue.filename}-${index}`}>{issue.filename}: {issue.message}</li>)}</ul> : null}
      </aside>
      <section
        id="panel-preview"
        {...panelAccessibility(mode, state.mobileTab, "preview", "Extracted text preview")}
        className={`preview-panel mobile-panel${state.mobileTab === "preview" ? " is-mobile-active" : ""}`}
      >
        {selected ? <div className="mobile-document-summary">
          <div className="mobile-document-identity">
            <DocumentIcon />
            <div><strong>{selected.name}</strong><span>/files/{selected.name}</span></div>
            <span className={`selected-status status-${selected.status}`}>{selected.status === "ready" ? "READY" : selected.status === "blocked" || selected.status === "error" ? "BLOCKED" : "NEEDS REVIEW"}</span>
            <button type="button" aria-label={`Show ${selected.name} in files`} onClick={() => dispatch({ type: "mobile/tab-changed", tab: "files" })}><MoreIcon /></button>
          </div>
        </div> : null}
        <div className="panel-heading preview-heading">
          <h2 ref={packageHeadingRef} tabIndex={-1}>{state.previewMode === "package" ? "PACKAGE PREVIEW" : "EXTRACTED_TEXT"}</h2>
          <div className="preview-mode-switch" aria-label="Preview view">
            <button
              type="button"
              aria-pressed={state.previewMode === "source"}
              onClick={() => dispatch({ type: "preview/mode-changed", mode: "source" })}
            >SOURCE</button>
            <button
              type="button"
              aria-pressed={state.previewMode === "assets"}
              disabled={!selected}
              onClick={() => dispatch({ type: "preview/mode-changed", mode: "assets" })}
            >ASSETS</button>
            <button
              type="button"
              aria-pressed={state.previewMode === "package"}
              disabled={!state.export.builtPackage}
              onClick={() => dispatch({ type: "preview/mode-changed", mode: "package" })}
            >PACKAGE</button>
          </div>
        </div>
        <div className="preview-content">
          {selected ? <div className="mobile-document-stats">
            <span><strong>{selected.pageCount ?? "—"}</strong><small>PAGES</small></span>
            <span><strong>{selected.visualAssets?.filter((asset) => asset.included).length ?? 0}</strong><small>IMAGES</small></span>
            <span><strong>{selected.ocrCandidates?.length ?? 0}</strong><small>OCR ITEMS</small></span>
          </div> : null}
          {state.export.builtPackage ? <PackagePreview
            key={state.export.builtRevision}
            workbooks={state.export.builtPackage.workbooks}
            selectedDocumentKey={state.previewDocumentKey}
            tab={state.previewWorkflow}
            hidden={state.previewMode !== "package"}
            onSelect={(documentKey) => dispatch({ type: "preview/document-selected", documentKey })}
            onTabChange={(workflow) => dispatch({ type: "preview/workflow-changed", workflow })}
            downloadProgressCopy={services.downloadProgressCopy}
          /> : null}
          {state.previewMode === "assets" ? <AssetGallery
            assets={selected?.visualAssets ?? []}
            view={state.assetViewMode}
            selectedAssetId={selectedAsset?.id ?? null}
            onViewChange={(view) => dispatch({ type: "assets/view-changed", mode: view })}
            onSelect={(assetId) => { if (selected) dispatch({ type: "assets/selected", documentId: selected.id, assetId }); }}
            onInclusionChange={(assetId, included) => { if (selected) dispatch({ type: "visual-asset/inclusion-changed", documentId: selected.id, assetId, included }); }}
          /> : state.previewMode === "source" ? <>
          <ExtractedTextEditor
            document={selected}
            hashPending={selected ? state.editor[selected.id]?.hashPending ?? false : false}
            onEdit={(text) => { if (selected) editor.edit(selected.id, text); }}
            onConfirm={() => { if (selected) editor.confirm(selected.id); }}
            onRemove={removeSelectedFromPreview}
            onRetry={() => { if (selected) intake.retry(selected.id); }}
            onRevealFiles={() => dispatch({ type: "mobile/tab-changed", tab: "files" })}
            onLatexMainFile={(mainFile) => { if (selected) dispatch({ type: "latex/main-file-selected", documentId: selected.id, mainFile }); }}
            onAddFiles={intake.openFilePicker}
          />
          {selected ? <OcrReview candidates={selected.ocrCandidates ?? []} busyId={busyOcrCandidate} onReview={(candidateId, status, text) => void reviewOcrCandidate(candidateId, status, text)} /> : null}
          </> : null}
        </div>
        {state.previewMode === "source" && context && selected ? <ContextMeter
          assessment={context}
          acknowledged={selected.contextWarningAcknowledged}
          onAcknowledge={(acknowledged) => dispatch({ type: "context/acknowledged", documentId: selected.id, acknowledged })}
        /> : null}
        {mode === "mobile" && selected?.status === "ready" ? exportPanel : null}
        {mode === "mobile" ? <StatusSummary {...counts} compact /> : null}
      </section>
      <aside
        id="panel-settings"
        {...panelAccessibility(mode, state.mobileTab, "settings", "Parameters")}
        className={`parameters-panel mobile-panel${state.mobileTab === "settings" ? " is-mobile-active" : ""}`}
        hidden={(mode === "desktop" && !state.desktopSettingsExpanded) || (mode === "mobile" && state.mobileTab !== "settings")}
      >
        <div className="panel-heading"><h2 ref={parametersHeadingRef} tabIndex={-1}>PARAMETERS</h2></div>
        {settings}
      </aside>
    </div>
    <footer className="workbench-footer">
      <StatusSummary {...counts} />
      <div className="saved-state" aria-label="Preferences save locally; documents and contents stay in this session.">Preferences save locally; documents and contents stay in this session <span /> v{APP_VERSION}</div>
    </footer>
    <SettingsDrawer open={state.activeOverlay === "settings"} onClose={() => dispatch({ type: "drawer/changed", open: false })} returnFocusRef={settingsButtonRef}>
      <SettingsInspector {...settingsProps} exportPanel={exportPanel} />
    </SettingsDrawer>
    <HelpDialog
      open={state.activeOverlay === "help"}
      onClose={() => dispatch({ type: "overlay/closed" })}
      onReplayQuickStart={() => dispatch({ type: "tutorial/opened" })}
      returnFocusRef={helpReturnFocusRef}
    />
    <QuickStartDialog
      open={state.activeOverlay === "quick-start"}
      returnFocusRef={helpReturnFocusRef}
      onReviewSettings={() => {
        dispatch({ type: "tutorial/dismissed" });
        revealSettings();
      }}
      onAddFiles={() => {
        dispatch({ type: "tutorial/dismissed" });
        intake.openFilePicker();
      }}
      onDismiss={() => dispatch({ type: "tutorial/dismissed" })}
    />
    <InfoDialog open={state.activeOverlay === "info"} onClose={() => dispatch({ type: "overlay/closed" })} returnFocusRef={infoReturnFocusRef} />
    <NewSessionDialog
      open={state.activeOverlay === "new-session"}
      onCancel={() => {
        dispatch({ type: "session/reset-cancelled" });
        queueMicrotask(() => newSessionReturnFocusRef.current?.focus());
      }}
      returnFocusRef={newSessionReturnFocusRef}
      onConfirm={() => {
        setBusyOcrCandidate(null);
        intake.resetSession();
        editor.resetSession();
        dispatch({ type: "session/reset-confirmed" });
      }}
    />
    <ResetPreferencesDialog
      open={state.activeOverlay === "reset-preferences"}
      onCancel={() => {
        dispatch({ type: "preferences/reset-cancelled" });
        queueMicrotask(() => resetPreferencesReturnFocusRef.current?.focus());
      }}
      onConfirm={() => {
        suppressPreferenceWriteRef.current = true;
        clearSavedPreferences();
        dispatch({ type: "preferences/reset-confirmed" });
        queueMicrotask(() => resetPreferencesReturnFocusRef.current?.focus());
      }}
    />
    <div className="visually-hidden" aria-live="polite" aria-atomic="true">{state.liveMessage}</div>
  </main>;
}
