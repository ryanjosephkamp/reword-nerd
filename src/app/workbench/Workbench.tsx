import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { assessContext, chooseProjectClassification, composeExtractionWithOcr, confirmProjectReview, editProjectEntryText, setProjectEntryInclusion, type OcrReviewStatus, type RewriteSettings, type WorkspaceProject } from "../../domain";
import type { MobileTab, WorkbenchServices, WorkbenchState } from "./contracts";
import { createInitialWorkbenchState, workbenchReducer } from "./reducer";
import {
  selectContextAssessment,
  selectCounts,
  selectDirty,
  selectSelectedItem,
  selectSelectedDocument,
  selectSelectedVisualAsset,
} from "./selectors";
import { defaultWorkbenchServices } from "./services";
import { useBeforeUnloadWarning } from "./useBeforeUnloadWarning";
import { useExportPackage } from "./useExportPackage";
import { useFileIntake } from "./useFileIntake";
import { useProjectIntake } from "./useProjectIntake";
import { useReviewEditor } from "./useReviewEditor";
import { createIntakeCapacityCoordinator } from "./intakeCapacityCoordinator";
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
import { SourceReview } from "./components/OriginalPreview";
import { ProjectReview } from "./components/ProjectReview";
import { DocumentIcon, MoreIcon } from "./components/Icons";
import {
  clearSavedPreferences,
  loadSavedPreferences,
  savePreferences,
  snapshotPreferences,
} from "./preferences";

type ResponsiveMode = "desktop" | "tablet" | "mobile";

function exportDockGuidance(
  blocker: string | null,
  message: string,
  status: WorkbenchState["export"]["status"],
  hasBuiltPackage: boolean,
): string {
  if (message) {
    if (status !== "failure") return message;
    return `${message} Next: retry ${hasBuiltPackage ? "DOWNLOAD ZIP" : "BUILD PACKAGE"}.`;
  }
  if (!blocker) return "Ready to build the reviewed package.";
  if (blocker === "Extraction is in progress.") return "Next: wait for extraction to finish.";
  if (blocker === "Review extracted content before export") return "Next: review extracted content before export.";
  if (blocker === "Estimated workflow context exceeds the selected profile.") {
    return "Next: acknowledge the context warning or adjust the selected context limit.";
  }
  return `Next: ${blocker.charAt(0).toLocaleLowerCase()}${blocker.slice(1)}`;
}

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
  const [intakeCapacity] = useState(createIntakeCapacityCoordinator);
  useLayoutEffect(() => {
    intakeCapacity.sync({
      acceptedCount: state.documents.length,
      acceptedBytes: state.items.reduce(
        (total, item) => total + (item.kind === "project" ? item.totalByteCount : item.originalByteSize),
        0,
      ),
    });
    intakeCapacity.syncItems(state.items.map((item) => ({
      id: item.id,
      uploadOrdinal: item.uploadOrdinal,
      ...(item.kind === "project" ? { projectTreeHash: item.originalTreeHash } : {}),
    })));
  }, [intakeCapacity, state.documents.length, state.items]);
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
  const projectIntake = useProjectIntake(state, dispatch, services, intakeCapacity);
  const intake = useFileIntake(state, dispatch, services, projectIntake.intakeZip, intakeCapacity);
  const editor = useReviewEditor(state, dispatch, services);
  const exporter = useExportPackage(state, dispatch, services);
  const projectReviewQueuesRef = useRef(new Map<string, Promise<WorkspaceProject>>());
  const projectReviewSessionGenerationRef = useRef(0);
  const projectReviewEpochsRef = useRef(new Map<string, number>());
  const nextProjectMutationTicketRef = useRef(0);
  const projectMutationCustodyRef = useRef(new Map<number, Readonly<{
    itemId: string;
    originalTreeHash: string;
    projectOperationGeneration: number;
    sessionGeneration: number;
    projectEpoch: number;
  }>>());
  const beginProjectMutation = useCallback((project: WorkspaceProject) => {
    const ticket = nextProjectMutationTicketRef.current + 1;
    nextProjectMutationTicketRef.current = ticket;
    projectMutationCustodyRef.current.set(ticket, {
      itemId: project.id,
      originalTreeHash: project.originalTreeHash,
      projectOperationGeneration: project.projectOperationGeneration,
      sessionGeneration: projectReviewSessionGenerationRef.current,
      projectEpoch: projectReviewEpochsRef.current.get(project.id) ?? 0,
    });
    dispatch({
      type: "project/mutation-started",
      itemId: project.id,
      originalTreeHash: project.originalTreeHash,
      projectOperationGeneration: project.projectOperationGeneration,
      ticket,
    });
    return ticket;
  }, []);
  const selectedItem = selectSelectedItem(state);
  const selected = selectedItem?.kind === "document" ? selectedItem : selectSelectedDocument(state);
  const selectedProject = selectedItem?.kind === "project" ? selectedItem : undefined;
  const selectedAsset = selected ? selectSelectedVisualAsset(state, selected.id) : undefined;
  const counts = selectCounts(state);
  const dirty = selectDirty(state);
  const preferenceSnapshot = useMemo(() => snapshotPreferences({
    selectedProfileId: state.selectedProfileId,
    customProfileLabel: state.customProfileLabel,
    workingProfile: state.workingProfile,
    globalSettings: state.globalSettings,
    globalCodeRewriteOptions: state.globalCodeRewriteOptions,
    globalExtractionOptions: state.globalExtractionOptions,
    tutorialSeenVersion: state.tutorialSeenVersion,
  }), [
    state.customProfileLabel,
    state.globalExtractionOptions,
    state.globalCodeRewriteOptions,
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
    if (state.focusTarget !== "parameters") return;
    parametersHeadingRef.current?.focus();
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
    if (!selectedItem || selectedItem.status === "blocked" || selectedItem.status === "error") return null;
    try {
      return selectContextAssessment(state, selectedItem.id);
    } catch {
      return assessContext(selectedItem.kind === "document" ? selectedItem.extractedText : "", null);
    }
  }, [selectedItem, state]);

  const exportProps = {
    buildDisabled: Boolean(exporter.blocker)
      || state.export.status === "building"
      || state.export.status === "downloading"
      || Boolean(state.export.builtPackage),
    downloadDisabled: !state.export.builtPackage
      || state.export.builtRevision !== state.revision
      || state.export.status === "building"
      || state.export.status === "downloading",
    status: state.export.status,
    message: state.export.safeMessage,
    onBuild: () => void exporter.build(),
    onDownload: exporter.download,
  };
  const primaryExportPanel = <ExportPanel {...exportProps} />;
  const settingsMirrorExportPanel = <ExportPanel {...exportProps} announce={false} settingsMirror />;
  const desktopExportDock = <ExportPanel
    {...exportProps}
    variant="dock"
    guidance={exportDockGuidance(
      exporter.blocker,
      state.export.safeMessage,
      state.export.status,
      Boolean(state.export.builtPackage),
    )}
  />;

  const settingsProps = {
    state,
    onGlobalChange: (field: keyof RewriteSettings, value: RewriteSettings[keyof RewriteSettings]) => dispatch({ type: "settings/global-changed", field, value }),
    onOverrideEnabled: (enabled: boolean) => { if (selected) dispatch({ type: "settings/override-enabled", documentId: selected.id, enabled }); },
    onOverrideChange: (field: keyof RewriteSettings, value: RewriteSettings[keyof RewriteSettings]) => { if (selected) dispatch({ type: "settings/override-changed", documentId: selected.id, field, value }); },
    onProfileSelected: (profileId: string) => dispatch({ type: "profile/selected", profileId }),
    onProfileLabel: (value: string) => dispatch({ type: "profile/custom-label-changed", value }),
    onContextDraft: (value: string, parsed: number | null | undefined) => dispatch({ type: "profile/custom-context-draft-changed", value, parsed }),
    onCodeRewriteOptionsChange: (options: import("../../domain").CodeRewriteOptions) => dispatch({ type: "code-rewrite/global-options-changed", options }),
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
  const settings = <SettingsInspector {...settingsProps} exportPanel={mode === "desktop" ? settingsMirrorExportPanel : undefined} />;

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
  const applyProjectReview = (
    project: WorkspaceProject,
    operation: (current: WorkspaceProject) => Promise<WorkspaceProject> | WorkspaceProject,
    mutationTicket: number,
  ) => {
    const custody = projectMutationCustodyRef.current.get(mutationTicket);
    if (!custody
      || custody.itemId !== project.id
      || custody.originalTreeHash !== project.originalTreeHash
      || custody.projectOperationGeneration !== project.projectOperationGeneration
      || custody.sessionGeneration !== projectReviewSessionGenerationRef.current
      || custody.projectEpoch !== (projectReviewEpochsRef.current.get(project.id) ?? 0)) {
      return Promise.resolve();
    }
    const sessionGeneration = custody.sessionGeneration;
    const projectEpoch = custody.projectEpoch;
    const previous = projectReviewQueuesRef.current.get(project.id) ?? Promise.resolve(project);
    const queued = previous.catch(() => project).then(async (current) => {
      const expectedReviewRevision = current.projectReviewRevision;
      const expectedOriginalTreeHash = current.originalTreeHash;
      const expectedOperationGeneration = current.projectOperationGeneration;
      const updated = await operation(current);
      if (sessionGeneration === projectReviewSessionGenerationRef.current
        && projectEpoch === (projectReviewEpochsRef.current.get(project.id) ?? 0)) {
        dispatch({ type: "project/review-updated", itemId: current.id, expectedOriginalTreeHash, expectedReviewRevision, expectedOperationGeneration, mutationTicket, project: updated });
      }
      return updated;
    });
    projectReviewQueuesRef.current.set(project.id, queued);
    const finish = () => {
      projectMutationCustodyRef.current.delete(mutationTicket);
      if (projectReviewQueuesRef.current.get(project.id) === queued) {
        projectReviewQueuesRef.current.delete(project.id);
      }
    };
    void queued.then(finish, () => {
      if (sessionGeneration === projectReviewSessionGenerationRef.current
        && projectEpoch === (projectReviewEpochsRef.current.get(project.id) ?? 0)) {
        dispatch({
          type: "project/mutation-failed",
          itemId: project.id,
          originalTreeHash: project.originalTreeHash,
          projectOperationGeneration: project.projectOperationGeneration,
          ticket: mutationTicket,
        });
        dispatch({ type: "live/announced", message: "The project review change could not be applied safely." });
      }
      finish();
    });
    return queued.then(() => undefined);
  };

  const removeItem = (itemId: string) => {
    const item = state.items.find((candidate) => candidate.id === itemId);
    if (item?.kind === "project") {
      projectReviewEpochsRef.current.set(item.id, (projectReviewEpochsRef.current.get(item.id) ?? 0) + 1);
      projectReviewQueuesRef.current.delete(item.id);
      for (const [ticket, custody] of projectMutationCustodyRef.current) {
        if (custody.itemId === item.id) projectMutationCustodyRef.current.delete(ticket);
      }
    }
    dispatch({ type: "item/removed", itemId });
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
        className={`files-panel mobile-panel${state.items.length > 0 ? " has-documents" : ""}${state.mobileTab === "files" ? " is-mobile-active" : ""}`}
        onDragEnter={intake.onDragEnter}
        onDragLeave={intake.onDragLeave}
        onDragOver={intake.onDragOver}
        onDrop={intake.onDrop}
      >
        <div className="panel-heading"><h2>FILES [{state.items.length}]</h2></div>
        <UploadDropZone
          inputRef={intake.inputRef}
          addButtonRef={intake.addButtonRef}
          dragging={state.intake.dragging}
          hasDocuments={state.items.length > 0}
          onOpen={intake.openFilePicker}
          onChange={intake.onInputChange}
          folderInputRef={projectIntake.inputRef}
          onOpenFolder={projectIntake.open}
          onFolderChange={projectIntake.onChange}
        />
        <FileQueue
          documents={state.items}
          selectedId={state.selectedItemId}
          focusTarget={state.focusTarget}
          onSelect={(itemId) => dispatch({ type: "item/selection-changed", itemId })}
          onRemove={removeItem}
          onFocusConsumed={() => dispatch({ type: "focus/consumed" })}
        />
        {state.intake.issues.length > 0 ? <ul className="intake-issues">{state.intake.issues.map((issue, index) => <li key={`${issue.filename}-${index}`}>{issue.filename}: {issue.message}</li>)}</ul> : null}
      </aside>
      <section
        id="panel-preview"
        {...panelAccessibility(mode, state.mobileTab, "preview", "Extracted text preview")}
        className={`preview-panel mobile-panel${state.mobileTab === "preview" ? " is-mobile-active" : ""}`}
      >
        {selectedItem ? <div className="mobile-document-summary">
          <div className="mobile-document-identity">
            <DocumentIcon />
            <div><strong>{selectedItem.name}</strong><span>/files/{selectedItem.name}</span></div>
            <span className={`selected-status status-${selectedItem.status}`}>{selectedItem.status === "ready" ? "READY" : selectedItem.status === "blocked" || selectedItem.status === "error" ? "BLOCKED" : "NEEDS REVIEW"}</span>
            <button type="button" aria-label={`Show ${selectedItem.name} in files`} onClick={() => dispatch({ type: "mobile/tab-changed", tab: "files" })}><MoreIcon /></button>
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
          {state.previewMode === "assets" && selected ? <AssetGallery
            assets={selected?.visualAssets ?? []}
            view={state.assetViewMode}
            selectedAssetId={selectedAsset?.id ?? null}
            onViewChange={(view) => dispatch({ type: "assets/view-changed", mode: view })}
            onSelect={(assetId) => { if (selected) dispatch({ type: "assets/selected", documentId: selected.id, assetId }); }}
            onInclusionChange={(assetId, included) => { if (selected) dispatch({ type: "visual-asset/inclusion-changed", documentId: selected.id, assetId, included }); }}
          /> : state.previewMode === "source" && selected ? <SourceReview document={selected} extracted={<>
          <ExtractedTextEditor
            document={selected}
            hashPending={state.editor[selected.id]?.hashPending ?? false}
            onEdit={(text) => editor.edit(selected.id, text)}
            onConfirm={() => editor.confirm(selected.id)}
            onRemove={removeSelectedFromPreview}
            onRetry={() => intake.retry(selected.id)}
            onRevealFiles={() => dispatch({ type: "mobile/tab-changed", tab: "files" })}
            onLatexMainFile={(mainFile) => dispatch({ type: "latex/main-file-selected", documentId: selected.id, mainFile })}
            onAddFiles={intake.openFilePicker}
          />
          <OcrReview candidates={selected.ocrCandidates ?? []} busyId={busyOcrCandidate} onReview={(candidateId, status, text) => void reviewOcrCandidate(candidateId, status, text)} />
          </>} /> : state.previewMode === "source" && selectedProject ? <ProjectReview
            project={selectedProject}
            onSelect={(path) => dispatch({ type: "project/selected-entry", itemId: selectedProject.id, path })}
            onMutationIntent={beginProjectMutation}
            onEdit={(path, text, ticket) => applyProjectReview(selectedProject, (project) => editProjectEntryText(project, path, text), ticket ?? beginProjectMutation(selectedProject))}
            onInclusion={(path, promptIncluded, packageIncluded, ticket) => { void applyProjectReview(selectedProject, (project) => setProjectEntryInclusion(project, path, { promptIncluded, packageIncluded }), ticket ?? beginProjectMutation(selectedProject)).catch(() => undefined); }}
            onClassification={(classification, rootDocument, ticket) => { void applyProjectReview(selectedProject, (project) => chooseProjectClassification(project, classification, rootDocument), ticket ?? beginProjectMutation(selectedProject)).catch(() => undefined); }}
            onConfirm={(ticket) => { void applyProjectReview(selectedProject, (project) => confirmProjectReview(project), ticket ?? beginProjectMutation(selectedProject)).catch(() => undefined); }}
          /> : state.previewMode === "source" ? <ExtractedTextEditor
            hashPending={false}
            onEdit={() => undefined}
            onConfirm={() => undefined}
            onRemove={() => undefined}
            onRetry={() => undefined}
            onRevealFiles={() => dispatch({ type: "mobile/tab-changed", tab: "files" })}
            onLatexMainFile={() => undefined}
            onAddFiles={intake.openFilePicker}
          /> : null}
        </div>
        {state.previewMode === "source" && context && selectedItem ? <ContextMeter
          assessment={context}
          acknowledged={selectedItem.contextWarningAcknowledged}
          onAcknowledge={(acknowledged) => dispatch({ type: "context/acknowledged", itemId: selectedItem.id, acknowledged })}
        /> : null}
        {mode === "desktop" && state.items.length > 0 ? desktopExportDock : null}
        {mode === "mobile" && selectedItem?.status === "ready" ? primaryExportPanel : null}
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
      <SettingsInspector {...settingsProps} exportPanel={primaryExportPanel} />
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
        projectReviewSessionGenerationRef.current += 1;
        projectReviewQueuesRef.current.clear();
        projectMutationCustodyRef.current.clear();
        intakeCapacity.reset();
        intake.resetSession();
        projectIntake.resetSession();
        editor.resetSession();
        dispatch({
          type: "session/reset-confirmed",
          focusAfterReset: mode === "desktop" ? "parameters" : "upload",
        });
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
    <div className="visually-hidden" aria-live="polite" aria-atomic="true">
      {state.liveMessage === state.export.safeMessage ? "" : state.liveMessage}
    </div>
  </main>;
}
