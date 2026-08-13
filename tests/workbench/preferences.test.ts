import {
  CURRENT_TUTORIAL_VERSION,
  PREFERENCES_STORAGE_KEY,
  clearSavedPreferences,
  decodeSavedPreferences,
  encodeSavedPreferences,
  loadSavedPreferences,
  savePreferences,
  snapshotPreferences,
} from "../../src/app/workbench/preferences";
import { createInitialWorkbenchState, workbenchReducer } from "../../src/app/workbench/reducer";

describe("saved preference adapter", () => {
  it("hydrates valid fields independently and ignores corrupt or unknown fields", () => {
    // This catches one malformed preference discarding safe choices or corrupt data entering live state.
    const decoded = decodeSavedPreferences(JSON.stringify({
      version: 1,
      data: {
        selectedProfileId: "anthropic-general",
        customProfileLabel: "Local model",
        contextWindowTokens: 32_000,
        globalSettings: {
          tone: "academic",
          formality: "not-a-formality",
          length: "concise",
          outputLanguage: "English",
          customRequirements: 9,
          futureSetting: "ignored",
        },
        processing: {
          extractEmbeddedImages: false,
          capturePageVisuals: "yes",
          pageSelection: "1-3, 7",
          pageCaptureQuality: "high",
          ocrMode: "textless-pages",
          ocrExtractedAssets: false,
          excludeDecorativeImages: true,
          trainedData: "must not survive",
        },
        tutorialVersion: CURRENT_TUTORIAL_VERSION,
        documentText: "must not survive",
      },
    }));

    expect(decoded).toEqual({
      selectedProfileId: "anthropic-general",
      customProfileLabel: "Local model",
      contextWindowTokens: 32_000,
      globalSettings: {
        tone: "academic",
        length: "concise",
        outputLanguage: "English",
      },
      processing: {
        extractEmbeddedImages: false,
        pageSelection: "1-3,7",
        pageCaptureQuality: "high",
        ocrMode: "textless-pages",
        ocrExtractedAssets: false,
        excludeDecorativeImages: true,
      },
      tutorialVersion: CURRENT_TUTORIAL_VERSION,
    });
    expect(decodeSavedPreferences('{"version":2,"data":{}}')).toBeNull();
    expect(decodeSavedPreferences('{"version":1,"data":null}')).toBeNull();
    expect(decodeSavedPreferences("not json")).toBeNull();
  });

  it.each(["0", "0-2", "3-1", "1, 9007199254740992", "1,,2"])(
    "rejects the semantically invalid saved page selection %s without discarding safe fields",
    (selection) => {
      // This catches syntactically plausible ranges reaching media parsing with zero, descending, or unsafe page numbers.
      const decoded = decodeSavedPreferences(JSON.stringify({
        version: 1,
        data: {
          globalSettings: { tone: "academic" },
          processing: { pageSelection: selection, capturePageVisuals: true },
        },
      }));

      expect(decoded).toEqual({
        globalSettings: { tone: "academic" },
        processing: { capturePageVisuals: true },
      });
    },
  );

  it("canonicalizes a valid saved page selection", () => {
    // This catches harmless whitespace variants being persisted as multiple representations of the same range.
    expect(decodeSavedPreferences(JSON.stringify({
      version: 1,
      data: { processing: { pageSelection: " 1 - 3, 7 " } },
    }))).toEqual({ processing: { pageSelection: "1-3,7" } });
  });

  it("uses the v0.4 image default only when no valid saved user choice exists", () => {
    // This catches migration code treating a missing choice as off or overwriting an explicit off choice.
    const fresh = createInitialWorkbenchState(null);
    const savedOff = createInitialWorkbenchState(decodeSavedPreferences(JSON.stringify({
      version: 1,
      data: { processing: { extractEmbeddedImages: false } },
    })));
    const corruptChoice = createInitialWorkbenchState(decodeSavedPreferences(JSON.stringify({
      version: 1,
      data: { processing: { extractEmbeddedImages: "false" } },
    })));

    expect(fresh.globalExtractionOptions).toMatchObject({
      extractEmbeddedImages: true,
      excludeDecorativeImages: true,
      capturePageVisuals: false,
      ocrMode: "off",
      ocrExtractedAssets: false,
    });
    expect(savedOff.globalExtractionOptions.extractEmbeddedImages).toBe(false);
    expect(corruptChoice.globalExtractionOptions.extractEmbeddedImages).toBe(true);
  });

  it("serializes only the approved global snapshot under one explicit key", () => {
    // This catches session documents, per-file controls, content, or package state crossing the persistence boundary.
    let state = createInitialWorkbenchState(null);
    state = {
      ...state,
      documents: [{
        id: "secret-document",
        batchId: "secret-batch",
        uploadOrdinal: 0,
        original: new File(["source secret"], "secret.md"),
        originalByteSize: 13,
        originalHash: "private-original-hash",
        name: "secret.md",
        format: "markdown",
        status: "ready",
        extractedText: "private reviewed content",
        extractedTextHash: "private-content-hash",
        warnings: ["private warning"],
        requiresReview: false,
        settingsOverride: { tone: "technical" },
        contextWarningAcknowledged: true,
      }],
      overrideEnabled: { "secret-document": true },
      previewDocumentKey: "secret-document-key",
    };

    const serialized = encodeSavedPreferences(snapshotPreferences(state));
    const parsed = JSON.parse(serialized) as { version: number; data: Record<string, unknown> };

    expect(PREFERENCES_STORAGE_KEY).toBe("reword-nerd:preferences:v1");
    expect(parsed.version).toBe(1);
    expect(Object.keys(parsed.data).sort()).toEqual([
      "codeRewriteOptions",
      "contextWindowTokens",
      "globalSettings",
      "processing",
      "selectedProfileId",
      "tutorialVersion",
    ]);
    expect(serialized).not.toMatch(/secret-document|secret-batch|source secret|private-content|private-.*hash|override|artifact|prompt|response|package/i);
  });

  it("omits invalid live drafts while canonicalizing valid fields in the serialized snapshot", () => {
    // This catches UI drafts bypassing hydration validation and corrupting otherwise safe saved preferences.
    const state = createInitialWorkbenchState({ tutorialVersion: CURRENT_TUTORIAL_VERSION });
    const serialized = encodeSavedPreferences(snapshotPreferences({
      ...state,
      selectedProfileId: "not-a-profile",
      customProfileLabel: "   ",
      workingProfile: { ...state.workingProfile, contextWindowTokens: Number.MAX_SAFE_INTEGER + 1 },
      globalSettings: {
        ...state.globalSettings,
        outputLanguage: "   ",
        customRequirements: "x".repeat(2_001),
      },
      globalExtractionOptions: {
        ...state.globalExtractionOptions,
        pageSelection: "3-1",
      },
    }));
    const parsed = JSON.parse(serialized) as { data: Record<string, unknown> };

    expect(parsed.data).not.toHaveProperty("selectedProfileId");
    expect(parsed.data).not.toHaveProperty("customProfileLabel");
    expect(parsed.data).not.toHaveProperty("contextWindowTokens");
    expect(parsed.data.globalSettings).toEqual({
      tone: "preserve",
      formality: "preserve",
      length: "preserve",
    });
    expect(parsed.data.processing).toEqual({
      extractEmbeddedImages: true,
      capturePageVisuals: false,
      pageCaptureQuality: "standard",
      ocrMode: "off",
      ocrExtractedAssets: false,
      excludeDecorativeImages: true,
    });
    expect(parsed.data.tutorialVersion).toBe(CURRENT_TUTORIAL_VERSION);
  });

  it("makes storage read, write, and removal failures non-fatal", () => {
    // This catches privacy-mode and quota exceptions breaking initial render or later controls.
    const unavailable = {
      getItem: () => { throw new DOMException("blocked", "SecurityError"); },
      setItem: () => { throw new DOMException("full", "QuotaExceededError"); },
      removeItem: () => { throw new DOMException("blocked", "SecurityError"); },
    };
    const state = createInitialWorkbenchState(null);

    expect(() => loadSavedPreferences(unavailable)).not.toThrow();
    expect(loadSavedPreferences(unavailable)).toBeNull();
    expect(() => savePreferences(snapshotPreferences(state), unavailable)).not.toThrow();
    expect(() => clearSavedPreferences(unavailable)).not.toThrow();
  });

  it("resets globals and context acknowledgments while retaining uploaded content and invalidating the package", () => {
    // This catches Reset leaving stale context consent, preserving a stale package, or destroying the retained document.
    let state = createInitialWorkbenchState({ tutorialVersion: CURRENT_TUTORIAL_VERSION });
    const documents = [{
      id: "retained",
      batchId: "batch",
      uploadOrdinal: 0,
      original: new File(["retained source"], "retained.md"),
      originalByteSize: 15,
      originalHash: "original-hash",
      name: "retained.md",
      format: "markdown" as const,
      status: "ready" as const,
      extractedText: "retained reviewed content",
      extractedTextHash: "reviewed-hash",
      warnings: [],
      requiresReview: false,
      settingsOverride: { tone: "technical" as const },
      contextWarningAcknowledged: true,
    }];
    state = {
      ...state,
      documents,
      selectedDocumentId: "retained",
      globalSettings: { ...state.globalSettings, tone: "academic" },
      globalExtractionOptions: { ...state.globalExtractionOptions, ocrMode: "all-pages" },
      export: {
        status: "ready",
        safeMessage: "Package ready.",
        builtPackage: {
          ok: true,
          blob: new Blob(["zip"]),
          filename: "reword-nerd-prompt-package.zip",
          manifest: {} as never,
          workbooks: [],
          artifacts: [],
        },
        builtRevision: state.revision,
      },
    };
    state = workbenchReducer(state, { type: "preferences/reset-confirmed" });

    expect(state.documents).not.toBe(documents);
    expect(state.documents[0].original).toBe(documents[0].original);
    expect(state.documents[0].extractedText).toBe("retained reviewed content");
    expect(state.documents[0].contextWarningAcknowledged).toBe(false);
    expect(state.globalSettings.tone).toBe("preserve");
    expect(state.globalExtractionOptions).toMatchObject({
      extractEmbeddedImages: true,
      capturePageVisuals: false,
      ocrMode: "off",
      excludeDecorativeImages: true,
    });
    expect(state.selectedProfileId).toBe("openai-general");
    expect(state.tutorialSeenVersion).toBe(CURRENT_TUTORIAL_VERSION);
    expect(state.export.builtPackage).toBeUndefined();
  });
});
