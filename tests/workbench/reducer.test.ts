import { cloneExtractionOptions, DEFAULT_EXTRACTION_OPTIONS, DEFAULT_SETTINGS, type WorkspaceDocument } from "../../src/domain";
import type { BuiltPromptPackage } from "../../src/app/workbench/contracts";
import type { DocumentWorkbook } from "../../src/export";
import { CURRENT_TUTORIAL_VERSION } from "../../src/app/workbench/preferences";
import {
  createInitialWorkbenchState,
  workbenchReducer,
} from "../../src/app/workbench/reducer";
import {
  selectDirty,
  selectFirstExportBlocker,
  selectResolvedSettings,
  selectSelectedDocument,
} from "../../src/app/workbench/selectors";

function document(
  id: string,
  status: WorkspaceDocument["status"] = "ready",
): WorkspaceDocument {
  return {
    id,
    original: new File([id], `${id}.md`, { type: "text/markdown" }),
    originalByteSize: id.length,
    originalHash: `original-${id}`,
    name: `${id}.md`,
    format: "markdown",
    status,
    extractedText: `text-${id}`,
    extractedTextHash: `text-hash-${id}`,
    warnings: [],
    pageCount: null,
    visualAssets: [],
    ocrCandidates: [],
    extractionOptions: cloneExtractionOptions(DEFAULT_EXTRACTION_OPTIONS),
    requiresReview: status !== "ready",
    settingsOverride: {},
    contextWarningAcknowledged: true,
  };
}

function workbook(documentKey: string): DocumentWorkbook {
  return { documentKey, originalDisplayName: `${documentKey}.md` } as DocumentWorkbook;
}

function builtPackage(documentKeys: readonly string[] = ["alpha"]): BuiltPromptPackage {
  const workbooks = documentKeys.map(workbook);
  return {
    ok: true,
    blob: new Blob(["zip"]),
    filename: "reword-nerd-prompt-package.zip",
    manifest: {} as never,
    workbooks,
    artifacts: workbooks,
  };
}

describe("workbench reducer", () => {
  it("starts with the desktop Settings panel expanded without making the session dirty", () => {
    // This catches the desktop inspector starting collapsed or view-only state changing export revision.
    let state = createInitialWorkbenchState();
    expect(state.desktopSettingsExpanded).toBe(true);
    expect(selectDirty(state)).toBe(false);

    state = workbenchReducer(state, { type: "desktop/settings-expanded", expanded: false });
    expect(state.desktopSettingsExpanded).toBe(false);
    expect(state.revision).toBe(0);
    expect(selectDirty(state)).toBe(false);
  });

  it("keeps gallery navigation view-only and preserves the selected asset while inclusion invalidates export", () => {
    // This catches gallery selection being lost across Preview modes or Include ejecting the user to Source.
    const alpha = document("alpha");
    alpha.visualAssets = [
      { id: "asset-1", filename: "one.png", mimeType: "image/png", bytes: new Uint8Array([1]), byteCount: 1, sha256: "one", order: 1, kind: "pdf-raster", included: true, decorative: false, warnings: [] },
      { id: "asset-2", filename: "two.png", mimeType: "image/png", bytes: new Uint8Array([2]), byteCount: 1, sha256: "two", order: 2, kind: "pdf-raster", included: true, decorative: false, warnings: [] },
    ];
    let state = createInitialWorkbenchState();
    state = workbenchReducer(state, { type: "intake/accepted", batchId: "batch-a", documents: [{ document: alpha, uploadOrdinal: 0 }] });
    const revision = state.revision;
    state = workbenchReducer(state, { type: "assets/view-changed", mode: "gallery" });
    state = workbenchReducer(state, { type: "assets/selected", documentId: "alpha", assetId: "asset-2" });
    expect(state.assetViewMode).toBe("gallery");
    expect(state.selectedAssetIdByDocument.alpha).toBe("asset-2");
    expect(state.revision).toBe(revision);

    state = workbenchReducer(state, { type: "preview/mode-changed", mode: "assets" });
    state = workbenchReducer(state, { type: "preview/mode-changed", mode: "source" });
    state = workbenchReducer(state, { type: "preview/mode-changed", mode: "assets" });
    expect(state.selectedAssetIdByDocument.alpha).toBe("asset-2");
    state = workbenchReducer(state, { type: "visual-asset/inclusion-changed", documentId: "alpha", assetId: "asset-2", included: false });
    expect(state.previewMode).toBe("assets");
    expect(state.assetViewMode).toBe("gallery");
    expect(state.selectedAssetIdByDocument.alpha).toBe("asset-2");
    expect(state.documents[0].visualAssets?.[1].included).toBe(false);
    expect(state.revision).toBe(revision + 1);
  });

  it("opens only one overlay and cancels the prior surface", () => {
    // This catches independently managed dialogs stacking and trapping focus twice.
    let state = createInitialWorkbenchState({ tutorialVersion: CURRENT_TUTORIAL_VERSION });
    expect(state.activeOverlay).toBeNull();

    state = workbenchReducer(state, { type: "overlay/opened", overlay: "help" });
    expect(state.activeOverlay).toBe("help");
    state = workbenchReducer(state, { type: "overlay/opened", overlay: "info" });
    expect(state.activeOverlay).toBe("info");
    state = workbenchReducer(state, { type: "overlay/closed" });
    expect(state.activeOverlay).toBeNull();
  });

  it("starts a clean new session while preserving global preferences", () => {
    // This catches New session wiping saved preferences or leaving recoverable document/package state behind.
    let state = createInitialWorkbenchState({
      selectedProfileId: "custom",
      customProfileLabel: "Local 14B",
      contextWindowTokens: 32_768,
      globalSettings: { ...DEFAULT_SETTINGS, tone: "technical", customRequirements: "Keep citations." },
      processing: { ...DEFAULT_EXTRACTION_OPTIONS, capturePageVisuals: true },
      tutorialVersion: CURRENT_TUTORIAL_VERSION,
    });
    state = workbenchReducer(state, {
      type: "intake/accepted",
      batchId: "batch-a",
      documents: [{ document: document("alpha"), uploadOrdinal: 0 }],
    });
    const builtRevision = state.revision;
    state = workbenchReducer(state, { type: "export/started", operationId: 9, revision: builtRevision });
    state = workbenchReducer(state, {
      type: "export/package-built",
      operationId: 9,
      revision: builtRevision,
      builtPackage: builtPackage(),
    });
    state = workbenchReducer(state, { type: "session/reset-requested" });
    expect(state.activeOverlay).toBe("new-session");

    state = workbenchReducer(state, { type: "session/reset-confirmed" });
    expect(state.documents).toEqual([]);
    expect(state.selectedDocumentId).toBeNull();
    expect(state.overrideEnabled).toEqual({});
    expect(state.editor).toEqual({});
    expect(state.intake).toEqual({ dragging: false, activeBatchId: null, issues: [] });
    expect(state.export.builtPackage).toBeUndefined();
    expect(state.previewMode).toBe("source");
    expect(state.previewDocumentKey).toBeNull();
    expect(state.mobileTab).toBe("files");
    expect(state.focusTarget).toBe("upload");
    expect(state.liveMessage).toBe("New session ready. Settings kept.");
    expect(state.workingProfile.contextWindowTokens).toBe(32_768);
    expect(state.customProfileLabel).toBe("Local 14B");
    expect(state.globalSettings).toMatchObject({ tone: "technical", customRequirements: "Keep citations." });
    expect(state.globalExtractionOptions.capturePageVisuals).toBe(true);
    expect(state.tutorialSeenVersion).toBe(CURRENT_TUTORIAL_VERSION);
    expect(state.lastExportedRevision).toBe(state.revision);
    expect(selectDirty(state)).toBe(false);
  });

  it("rejects late async completions after a new session generation begins", () => {
    // This catches stale extraction and package operations repopulating a reset session.
    let state = createInitialWorkbenchState({ tutorialVersion: CURRENT_TUTORIAL_VERSION });
    state = workbenchReducer(state, {
      type: "intake/accepted",
      batchId: "batch-a",
      documents: [{ document: document("alpha", "extracting"), uploadOrdinal: 0 }],
    });
    const staleRevision = state.revision;
    state = workbenchReducer(state, { type: "export/started", operationId: 4, revision: staleRevision });
    state = workbenchReducer(state, { type: "session/reset-confirmed" });
    const cleanState = state;

    state = workbenchReducer(state, {
      type: "extraction/succeeded",
      batchId: "batch-a",
      documentId: "alpha",
      result: {
        format: "markdown",
        extractedText: "late",
        warnings: [],
        pageCount: null,
        originalHash: "late-original",
        extractedTextHash: "late-text",
        requiresReview: true,
      },
    });
    state = workbenchReducer(state, {
      type: "export/package-built",
      operationId: 4,
      revision: staleRevision,
      builtPackage: builtPackage(),
    });
    expect(state).toBe(cleanState);
  });

  it("uses the v0.4 media defaults and invalidates reviewed media when options change", () => {
    // This catches embedded-image extraction becoming default-off, optional OCR becoming implicit, or reviewed media surviving changed inputs.
    let state = createInitialWorkbenchState();
    expect((state as unknown as { globalExtractionOptions?: unknown }).globalExtractionOptions).toMatchObject({
      extractEmbeddedImages: true,
      capturePageVisuals: false,
      ocrMode: "off",
    });
    state = workbenchReducer(state, {
      type: "intake/accepted",
      batchId: "batch-a",
      documents: [{ document: document("alpha"), uploadOrdinal: 0 }],
    });
    const readyRevision = state.revision;
    state = workbenchReducer(state, {
      type: "export/started",
      operationId: 1,
      revision: readyRevision,
    });
    state = workbenchReducer(state, {
      type: "export/package-built",
      builtPackage: builtPackage(),
      operationId: 1,
      revision: readyRevision,
    });

    state = workbenchReducer(state, {
      type: "processing/options-changed",
      documentId: "alpha",
      options: {
        extractEmbeddedImages: true,
        capturePageVisuals: false,
        pageSelection: "all",
        pageCaptureQuality: "standard",
        ocrMode: "textless-pages",
        ocrExtractedAssets: false,
        ocrLanguage: { kind: "bundled", code: "eng", label: "English" },
        excludeDecorativeImages: true,
      },
    } as never);

    expect(state.documents[0]).toMatchObject({
      status: "queued",
      requiresReview: true,
      visualAssets: [],
      ocrCandidates: [],
      extractionOptions: { extractEmbeddedImages: true, ocrMode: "textless-pages" },
    });
    expect(state.export.builtPackage).toBeUndefined();
    expect(state.revision).toBeGreaterThan(readyRevision);
  });

  it("ignores a late extraction completion after a newer reprocessing operation starts", () => {
    // This catches a cancelled or slow parser overwriting the source, media, and OCR review for a newer revision.
    let state = createInitialWorkbenchState();
    state = workbenchReducer(state, {
      type: "intake/accepted",
      batchId: "batch-a",
      documents: [{ document: document("alpha", "queued"), uploadOrdinal: 0 }],
    });
    state = workbenchReducer(state, {
      type: "extraction/started",
      batchId: "batch-a",
      documentId: "alpha",
      operationId: 10,
    } as never);
    state = workbenchReducer(state, {
      type: "extraction/started",
      batchId: "batch-a",
      documentId: "alpha",
      operationId: 11,
    } as never);

    const result = {
      format: "markdown" as const,
      extractedText: "stale result",
      warnings: [],
      originalHash: "stale-original",
      extractedTextHash: "stale-text",
      pageCount: null,
      visualAssets: [],
      ocrCandidates: [],
      extractionOptions: cloneExtractionOptions(DEFAULT_EXTRACTION_OPTIONS),
      requiresReview: true,
    };
    const beforeStale = state;
    state = workbenchReducer(state, {
      type: "extraction/succeeded",
      batchId: "batch-a",
      documentId: "alpha",
      operationId: 10,
      result,
    } as never);

    expect(state).toBe(beforeStale);
    expect(state.documents[0].status).toBe("extracting");
  });

  it("requires OCR candidate review and installs only an explicitly accepted candidate", () => {
    // This catches uncertain OCR entering the reviewed source or export without page-level user acceptance.
    let state = createInitialWorkbenchState();
    const withOcr = {
      ...document("scan", "needs-review"),
      baseExtractedText: "--- Page 1 ---\n\n",
      extractedText: "--- Page 1 ---\n\n",
      ocrCandidates: [{
        id: "ocr-page-1",
        source: { kind: "page" as const, pageNumber: 1 },
        text: "raw candidate",
        reviewedText: "raw candidate",
        confidence: 72,
        status: "pending" as const,
        engine: "tesseract.js" as const,
        engineVersion: "7.0.0",
        languageCode: "eng",
        languageHash: "language-hash",
      }],
    };
    state = workbenchReducer(state, {
      type: "intake/accepted",
      batchId: "batch-a",
      documents: [{ document: withOcr, uploadOrdinal: 0 }],
    });
    expect(selectFirstExportBlocker(state)).toBe("Review every OCR candidate before export.");

    state = workbenchReducer(state, {
      type: "ocr/candidate-reviewed",
      documentId: "scan",
      candidateId: "ocr-page-1",
      status: "accepted",
      reviewedText: "corrected candidate",
      composedText: "--- Page 1 ---\n\n\n\n--- Reviewed OCR: Page 1 ---\n\ncorrected candidate",
      composedHash: "reviewed-ocr-hash",
    } as never);

    expect(state.documents[0]).toMatchObject({
      extractedText: expect.stringContaining("corrected candidate"),
      extractedTextHash: "reviewed-ocr-hash",
      status: "needs-review",
      requiresReview: true,
      ocrCandidates: [{ status: "accepted", reviewedText: "corrected candidate" }],
    });
    expect(selectFirstExportBlocker(state)).toBe("Review extracted content before export");
  });

  it("marks an edit for review and ignores stale hash completions", () => {
    let state = createInitialWorkbenchState();
    state = workbenchReducer(state, {
      type: "intake/accepted",
      batchId: "batch-a",
      documents: [{ document: document("alpha"), uploadOrdinal: 0 }],
    });

    state = workbenchReducer(state, {
      type: "editor/edited",
      documentId: "alpha",
      text: "first edit",
    });
    state = workbenchReducer(state, {
      type: "editor/edited",
      documentId: "alpha",
      text: "second edit",
    });
    state = workbenchReducer(state, {
      type: "editor/hash-completed",
      documentId: "alpha",
      revision: 1,
      hash: "stale-hash",
    });

    expect(selectSelectedDocument(state)).toMatchObject({
      extractedText: "second edit",
      extractedTextHash: "text-hash-alpha",
      status: "needs-review",
      requiresReview: true,
      contextWarningAcknowledged: false,
    });
    expect(state.editor.alpha).toEqual({ revision: 2, hashPending: true, hashFailed: false });

    state = workbenchReducer(state, {
      type: "editor/hash-completed",
      documentId: "alpha",
      revision: 2,
      hash: "current-hash",
    });
    state = workbenchReducer(state, {
      type: "review/confirmed",
      documentId: "alpha",
      revision: 2,
    });

    expect(selectSelectedDocument(state)).toMatchObject({
      extractedTextHash: "current-hash",
      status: "ready",
      requiresReview: false,
    });
  });

  it("snapshots an override once and makes retained values dormant when disabled", () => {
    let state = createInitialWorkbenchState();
    state = workbenchReducer(state, {
      type: "intake/accepted",
      batchId: "batch-a",
      documents: [{ document: document("alpha"), uploadOrdinal: 0 }],
    });
    state = workbenchReducer(state, {
      type: "settings/global-changed",
      field: "tone",
      value: "professional",
    });
    state = workbenchReducer(state, {
      type: "settings/override-enabled",
      documentId: "alpha",
      enabled: true,
    });
    state = workbenchReducer(state, {
      type: "settings/override-changed",
      documentId: "alpha",
      field: "tone",
      value: "technical",
    });
    state = workbenchReducer(state, {
      type: "settings/override-enabled",
      documentId: "alpha",
      enabled: false,
    });
    state = workbenchReducer(state, {
      type: "settings/global-changed",
      field: "tone",
      value: "plain",
    });

    expect(selectResolvedSettings(state, "alpha").tone).toBe("plain");
    expect(state.documents[0].settingsOverride.tone).toBe("technical");

    state = workbenchReducer(state, {
      type: "settings/override-enabled",
      documentId: "alpha",
      enabled: true,
    });
    expect(selectResolvedSettings(state, "alpha").tone).toBe("technical");
  });

  it("clears all context acknowledgments only for profile-limit or source changes", () => {
    let state = createInitialWorkbenchState();
    state = workbenchReducer(state, {
      type: "intake/accepted",
      batchId: "batch-a",
      documents: [
        { document: document("alpha"), uploadOrdinal: 0 },
        { document: document("beta"), uploadOrdinal: 1 },
      ],
    });
    state = workbenchReducer(state, {
      type: "settings/global-changed",
      field: "formality",
      value: "formal",
    });
    expect(state.documents.every((item) => item.contextWarningAcknowledged)).toBe(true);

    state = workbenchReducer(state, {
      type: "profile/context-limit-changed",
      value: 4_000,
    });
    expect(state.documents.every((item) => !item.contextWarningAcknowledged)).toBe(true);
  });

  it("selects the next document after removal and ignores late batch extraction", () => {
    let state = createInitialWorkbenchState();
    state = workbenchReducer(state, {
      type: "intake/accepted",
      batchId: "batch-a",
      documents: [
        { document: document("alpha", "extracting"), uploadOrdinal: 0 },
        { document: document("beta"), uploadOrdinal: 1 },
        { document: document("gamma"), uploadOrdinal: 2 },
      ],
    });
    state = workbenchReducer(state, { type: "selection/changed", documentId: "beta" });
    state = workbenchReducer(state, { type: "document/removed", documentId: "beta" });
    expect(state.selectedDocumentId).toBe("gamma");
    expect(state.focusTarget).toBe("document:gamma");

    state = workbenchReducer(state, { type: "document/removed", documentId: "alpha" });
    state = workbenchReducer(state, {
      type: "extraction/succeeded",
      batchId: "batch-a",
      documentId: "alpha",
      result: {
        format: "markdown",
        extractedText: "late",
        warnings: [],
        pageCount: null,
        visualAssets: [],
        ocrCandidates: [],
        extractionOptions: cloneExtractionOptions(DEFAULT_EXTRACTION_OPTIONS),
        originalHash: "late-original",
        extractedTextHash: "late-text",
        requiresReview: true,
      },
    });
    expect(state.documents.map((item) => item.id)).toEqual(["gamma"]);
  });

  it("orders export blockers and makes only an explicit download clean until mutation", () => {
    let state = createInitialWorkbenchState();
    expect(selectFirstExportBlocker(state)).toBe("Add at least one reviewed document before exporting.");

    state = workbenchReducer(state, {
      type: "intake/accepted",
      batchId: "batch-a",
      documents: [{ document: document("alpha", "needs-review"), uploadOrdinal: 0 }],
    });
    expect(selectFirstExportBlocker(state)).toBe("Review extracted content before export");

    state = workbenchReducer(state, {
      type: "editor/hash-completed",
      documentId: "alpha",
      revision: 0,
      hash: "confirmed-hash",
    });
    state = workbenchReducer(state, {
      type: "review/confirmed",
      documentId: "alpha",
      revision: 0,
    });
    const exportedRevision = state.revision;
    state = workbenchReducer(state, {
      type: "export/started",
      operationId: 1,
      revision: exportedRevision,
    });
    state = workbenchReducer(state, {
      type: "export/package-built",
      builtPackage: builtPackage(),
      operationId: 1,
      revision: exportedRevision,
    });

    expect(state.export.status).toBe("ready");
    expect(selectDirty(state)).toBe(true);
    expect(state.export.builtPackage?.blob).toBeInstanceOf(Blob);
    expect(state).toMatchObject({
      previewMode: "package",
      previewWorkflow: "runbook",
      previewDocumentKey: "alpha",
    });

    state = workbenchReducer(state, { type: "preview/workflow-changed", workflow: "manual" });
    expect(state).toMatchObject({ previewMode: "package", previewWorkflow: "manual", previewDocumentKey: "alpha" });

    state = workbenchReducer(state, { type: "export/download-started", revision: exportedRevision });
    state = workbenchReducer(state, { type: "export/download-succeeded", revision: exportedRevision });

    expect(selectDirty(state)).toBe(false);
    expect(state.export.builtPackage?.blob).toBeInstanceOf(Blob);

    state = workbenchReducer(state, {
      type: "settings/global-changed",
      field: "length",
      value: "expanded",
    });
    expect(selectDirty(state)).toBe(true);
    expect(state.export.builtPackage).toBeUndefined();
    expect(state).toMatchObject({
      previewMode: "source",
      previewWorkflow: "runbook",
      previewDocumentKey: null,
    });
  });

  it("keeps tutorial state out of package invalidation and rejects stale download completion", () => {
    let state = createInitialWorkbenchState();
    state = workbenchReducer(state, {
      type: "intake/accepted",
      batchId: "batch-a",
      documents: [{ document: document("alpha"), uploadOrdinal: 0 }],
    });
    const builtRevision = state.revision;
    state = workbenchReducer(state, { type: "export/started", operationId: 1, revision: builtRevision });
    state = workbenchReducer(state, {
      type: "export/package-built",
      builtPackage: builtPackage(["alpha", "beta"]),
      operationId: 1,
      revision: builtRevision,
    });
    state = workbenchReducer(state, { type: "preview/workflow-changed", workflow: "manual" });
    state = workbenchReducer(state, { type: "preview/document-selected", documentKey: "beta" });
    const packageBeforeTutorial = state.export.builtPackage;

    state = workbenchReducer(state, { type: "tutorial/dismissed" });

    expect(state.export.builtPackage).toBe(packageBeforeTutorial);
    expect(state).toMatchObject({
      previewMode: "package",
      previewWorkflow: "manual",
      previewDocumentKey: "beta",
    });

    state = workbenchReducer(state, { type: "export/download-started", revision: builtRevision });
    state = workbenchReducer(state, {
      type: "context/acknowledged",
      documentId: "alpha",
      acknowledged: false,
    });
    const invalidated = state;
    state = workbenchReducer(state, { type: "export/download-succeeded", revision: builtRevision });

    expect(state).toBe(invalidated);
    expect(state.export.builtPackage).toBeUndefined();
    expect(state.lastExportedRevision).not.toBe(builtRevision);
    expect(selectDirty(state)).toBe(true);
  });

  it("starts with the Task 2 defaults without sharing mutable settings", () => {
    const left = createInitialWorkbenchState();
    const right = createInitialWorkbenchState();

    expect(left.globalSettings).toEqual(DEFAULT_SETTINGS);
    expect(left.globalSettings).not.toBe(right.globalSettings);
    expect(left.selectedProfileId).toBe("openai-general");
    expect(left.workingProfile.label).toBe("OpenAI / ChatGPT");
  });

  it("makes a current hash failure recoverable without accepting an unhashed review", () => {
    let state = createInitialWorkbenchState();
    state = workbenchReducer(state, {
      type: "intake/accepted",
      batchId: "batch-a",
      documents: [{ document: document("alpha"), uploadOrdinal: 0 }],
    });
    state = workbenchReducer(state, { type: "editor/edited", documentId: "alpha", text: "changed" });
    state = workbenchReducer(state, { type: "editor/hash-failed", documentId: "alpha", revision: 1 });

    expect(state.editor.alpha).toEqual({ revision: 1, hashPending: false, hashFailed: true });
    state = workbenchReducer(state, { type: "review/confirmed", documentId: "alpha", revision: 1 });
    expect(selectSelectedDocument(state)?.status).toBe("needs-review");
  });

  it("refuses to confirm a blank extraction even after its current hash completes", () => {
    let state = createInitialWorkbenchState();
    state = workbenchReducer(state, {
      type: "intake/accepted",
      batchId: "batch-a",
      documents: [{ document: document("alpha"), uploadOrdinal: 0 }],
    });
    state = workbenchReducer(state, { type: "editor/edited", documentId: "alpha", text: " \n\t " });
    state = workbenchReducer(state, {
      type: "editor/hash-completed",
      documentId: "alpha",
      revision: 1,
      hash: "blank-hash",
    });
    const beforeConfirmation = state;

    state = workbenchReducer(state, { type: "review/confirmed", documentId: "alpha", revision: 1 });

    expect(state).toBe(beforeConfirmation);
    expect(selectSelectedDocument(state)).toMatchObject({
      extractedText: " \n\t ",
      status: "needs-review",
      requiresReview: true,
    });
  });

  it("blocks export when malformed state marks a blank extraction reviewed", () => {
    let state = createInitialWorkbenchState();
    state = workbenchReducer(state, {
      type: "intake/accepted",
      batchId: "batch-a",
      documents: [{ document: document("alpha"), uploadOrdinal: 0 }],
    });
    state = {
      ...state,
      documents: state.documents.map((item) => ({
        ...item,
        extractedText: " \n\t ",
        status: "ready" as const,
        requiresReview: false,
      })),
      editor: {
        ...state.editor,
        alpha: { revision: 1, hashPending: false, hashFailed: false },
      },
    };

    expect(selectFirstExportBlocker(state)).toBe(
      "Extracted text cannot be blank. Add text or remove the file.",
    );
  });

  it.each(["queued", "extracting"] as const)(
    "refuses editor and review actions while a document is %s",
    (status) => {
      let state = createInitialWorkbenchState();
      state = workbenchReducer(state, {
        type: "intake/accepted",
        batchId: "batch-a",
        documents: [{ document: document("alpha", status), uploadOrdinal: 0 }],
      });
      const beforeEdit = state;

      state = workbenchReducer(state, { type: "editor/edited", documentId: "alpha", text: "premature" });
      expect(state).toBe(beforeEdit);

      state = workbenchReducer(state, { type: "review/confirmed", documentId: "alpha", revision: 0 });
      expect(state).toBe(beforeEdit);
      expect(selectSelectedDocument(state)).toMatchObject({ status, requiresReview: true });
    },
  );
});
