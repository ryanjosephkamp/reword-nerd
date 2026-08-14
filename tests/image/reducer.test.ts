import { DEFAULT_IMAGE_PROMPT_SETTINGS, ownImageBytes, type ImagePromptSettings } from "../../src/image/contracts";
import {
  createInitialImagePortalState,
  imagePortalReducer,
  type ImageAdmission,
  type ImagePortalAction,
  type ImagePortalState,
} from "../../src/image/reducer";

function admission(id: string, sourceHash = `hash-${id}`): ImageAdmission {
  return {
    id,
    bytes: new Uint8Array([1, 2, id.length]),
    sourceHash,
    mimeType: "image/png",
    fileExtension: "png",
    width: 3,
    height: 2,
    provenance: {
      intakeKind: "direct",
      sourceName: `${id}.png`,
      sourcePath: null,
      containerName: null,
      containerHash: null,
      containerPath: null,
      pageNumber: null,
      relationshipId: null,
    },
    warnings: [],
  };
}

function dispatch(state: ImagePortalState, ...actions: ImagePortalAction[]): ImagePortalState {
  return actions.reduce(imagePortalReducer, state);
}

function admit(state: ImagePortalState, generation: number, ...items: ImageAdmission[]): ImagePortalState {
  return dispatch(
    state,
    { type: "operation/started", generation },
    { type: "items/admitted", generation, items },
  );
}

function confirmAndBuild(state: ImagePortalState, generation: number): ImagePortalState {
  const confirmed = imagePortalReducer(state, {
    type: "review/confirmed",
    expectedReviewGeneration: state.reviewGeneration,
  });
  const started = imagePortalReducer(confirmed, {
    type: "build/started",
    generation,
    expectedReviewGeneration: confirmed.reviewGeneration,
  });
  return imagePortalReducer(started, {
    type: "build/completed",
    generation,
    expectedReviewGeneration: started.reviewGeneration,
    output: {
      packageName: "reword-nerd-image-prompt-package.zip",
      packageBytes: ownImageBytes(new Uint8Array([80, 75, generation])),
      itemCount: started.items.filter((item) => item.included).length,
    },
  });
}

describe("Image portal reducer", () => {
  it("correlates individual setting fields with their value types", () => {
    // Catches the action contract accepting a string for a boolean field before runtime.
    type InvalidActionAssignable = {
      type: "item/setting-changed";
      itemId: string;
      expectedReviewRevision: number;
      field: "preserveVisibleText";
      value: "false";
    } extends ImagePortalAction ? true : false;

    expectTypeOf<InvalidActionAssignable>().toEqualTypeOf<false>();
  });

  it("snapshots defaults into future admissions without rewriting existing items", () => {
    // Catches global defaults being retained by reference or retroactively applied to admitted images.
    let state = createInitialImagePortalState({
      defaults: { modelFamily: "ideogram", requestedChanges: "Initial default." },
      tutorialVersion: "0.8",
    });
    state = admit(state, 1, admission("first"));
    state = imagePortalReducer(state, {
      type: "defaults/changed",
      defaults: {
        ...state.defaults,
        modelFamily: "bfl-flux",
        requestedChanges: "Future default.",
      },
    });
    state = admit(state, 2, admission("second"));

    expect(state.items.map((item) => ({ id: item.id, family: item.settings.modelFamily, change: item.settings.requestedChanges }))).toEqual([
      { id: "first", family: "ideogram", change: "Initial default." },
      { id: "second", family: "bfl-flux", change: "Future default." },
    ]);
    expect(state.tutorialSeenVersion).toBe("0.8");
  });

  it("keeps focus, bulk selection, inclusion, and removal as distinct operations", () => {
    // Catches a queue interaction silently changing prompt inclusion or deleting an item.
    let state = admit(createInitialImagePortalState(), 1, admission("first"), admission("second"));
    state = dispatch(
      state,
      { type: "focus/changed", itemId: "first" },
      { type: "bulk/selection-changed", itemId: "second", selected: true },
    );

    expect(state.focusedItemId).toBe("first");
    expect(state.items.map(({ id, bulkSelected, included }) => ({ id, bulkSelected, included }))).toEqual([
      { id: "first", bulkSelected: false, included: true },
      { id: "second", bulkSelected: true, included: true },
    ]);

    state = imagePortalReducer(state, { type: "item/inclusion-changed", itemId: "second", included: false });
    expect(state.focusedItemId).toBe("first");
    expect(state.items).toHaveLength(2);
    expect(state.items[1]).toMatchObject({ bulkSelected: true, included: false });

    state = imagePortalReducer(state, { type: "item/removed", itemId: "first" });
    expect(state.items.map((item) => item.id)).toEqual(["second"]);
    expect(state.focusedItemId).toBe("second");
  });

  it("applies only explicitly masked bulk settings fields", () => {
    // Catches an unchecked bulk field overwriting an image's individual configuration.
    let state = admit(createInitialImagePortalState(), 1, admission("first"), admission("second"));
    state = dispatch(
      state,
      { type: "bulk/selection-changed", itemId: "first", selected: true },
      { type: "bulk/selection-changed", itemId: "second", selected: true },
      {
        type: "bulk/settings-applied",
        expectedReviewGeneration: state.reviewGeneration,
        fields: ["aspectRatio", "requestedChanges"],
        patch: {
          aspectRatio: "16:9",
          requestedChanges: "Make the shared border orange.",
          mustPreserve: "This unchecked value must not apply.",
          preserveVisibleText: false,
        },
      },
    );

    expect(state.items.map((item) => item.settings)).toEqual([
      { ...DEFAULT_IMAGE_PROMPT_SETTINGS, aspectRatio: "16:9", requestedChanges: "Make the shared border orange." },
      { ...DEFAULT_IMAGE_PROMPT_SETTINGS, aspectRatio: "16:9", requestedChanges: "Make the shared border orange." },
    ]);
    expect(state.items.map((item) => item.reviewRevision)).toEqual([1, 1]);
  });

  it("preserves confirmation and output for focus/selection but invalidates them for item configuration", () => {
    // Catches navigation discarding work or, conversely, a changed prompt configuration retaining stale output.
    let state = admit(createInitialImagePortalState(), 1, admission("first"), admission("second"));
    state = confirmAndBuild(state, 10);
    const confirmedGeneration = state.confirmedReviewGeneration;
    const output = state.builtOutput;

    state = dispatch(
      state,
      { type: "focus/changed", itemId: "second" },
      { type: "bulk/selection-changed", itemId: "first", selected: true },
    );
    expect(state.confirmedReviewGeneration).toBe(confirmedGeneration);
    expect(state.builtOutput).toBe(output);

    const firstRevision = state.items[0].reviewRevision;
    state = imagePortalReducer(state, {
      type: "item/setting-changed",
      itemId: "first",
      expectedReviewRevision: firstRevision,
      field: "mustPreserve",
      value: "Keep the badge centered.",
    });
    expect(state.confirmedReviewGeneration).toBeNull();
    expect(state.builtOutput).toBeNull();
    expect(state.buildStatus).toBe("idle");
    expect(state.items[0].reviewRevision).toBe(firstRevision + 1);
  });

  it("invalidates confirmation and output when inclusion, OCR, source, or removal changes", () => {
    // Catches a built package surviving a material change to its confirmed image set.
    let state = admit(createInitialImagePortalState(), 1, admission("first"), admission("second"));
    state = confirmAndBuild(state, 10);
    state = imagePortalReducer(state, { type: "item/inclusion-changed", itemId: "second", included: false });
    expect([state.confirmedReviewGeneration, state.builtOutput]).toEqual([null, null]);

    state = confirmAndBuild(state, state.buildGeneration + 1);
    state = imagePortalReducer(state, {
      type: "ocr/started",
      itemId: "first",
      generation: state.operationGeneration + 1,
    });
    expect([state.confirmedReviewGeneration, state.builtOutput]).toEqual([null, null]);
    const ocrGeneration = state.items[0].ocr.operationGeneration;
    state = imagePortalReducer(state, {
      type: "ocr/completed",
      itemId: "first",
      generation: ocrGeneration,
      detectedText: "DRAFT",
    });
    const ocrRevision = state.items[0].reviewRevision;
    state = imagePortalReducer(state, {
      type: "ocr/reviewed",
      itemId: "first",
      expectedOperationGeneration: ocrGeneration,
      expectedReviewRevision: ocrRevision,
      status: "accepted",
      reviewedText: "FINAL",
    });
    expect(state.items[0].ocr).toMatchObject({ status: "accepted", reviewedText: "FINAL" });

    state = confirmAndBuild(state, state.buildGeneration + 1);
    const replacementGeneration = state.operationGeneration + 1;
    state = dispatch(
      state,
      { type: "operation/started", generation: replacementGeneration },
      {
        type: "source/replaced",
        itemId: "first",
        expectedSourceHash: "hash-first",
        generation: replacementGeneration,
        source: admission("first", "replacement-hash"),
      },
    );
    expect(state.items[0]).toMatchObject({ sourceHash: "replacement-hash", included: true });
    expect(state.items[0].ocr.status).toBe("off");
    expect([state.confirmedReviewGeneration, state.builtOutput]).toEqual([null, null]);

    state = confirmAndBuild(state, state.buildGeneration + 1);
    state = imagePortalReducer(state, { type: "item/removed", itemId: "first" });
    expect([state.confirmedReviewGeneration, state.builtOutput]).toEqual([null, null]);
  });

  it("rejects stale admission, OCR review, build completion, and post-reset completions", () => {
    // Catches a slow earlier async operation overwriting a newer review or resurrecting reset session data.
    let state = createInitialImagePortalState();
    state = imagePortalReducer(state, { type: "operation/started", generation: 3 });
    state = imagePortalReducer(state, { type: "items/admitted", generation: 2, items: [admission("stale")] });
    expect(state.items).toHaveLength(0);
    state = imagePortalReducer(state, { type: "items/admitted", generation: 3, items: [admission("current")] });

    state = imagePortalReducer(state, { type: "ocr/started", itemId: "current", generation: 4 });
    state = imagePortalReducer(state, { type: "ocr/started", itemId: "current", generation: 5 });
    state = imagePortalReducer(state, { type: "ocr/completed", itemId: "current", generation: 4, detectedText: "STALE" });
    expect(state.items[0].ocr).toMatchObject({ status: "processing", detectedText: null, operationGeneration: 5 });
    state = imagePortalReducer(state, { type: "ocr/completed", itemId: "current", generation: 5, detectedText: "CURRENT" });
    const currentReviewRevision = state.items[0].reviewRevision;
    state = imagePortalReducer(state, {
      type: "ocr/reviewed",
      itemId: "current",
      expectedOperationGeneration: 5,
      expectedReviewRevision: currentReviewRevision - 1,
      status: "accepted",
      reviewedText: "STALE REVIEW",
    });
    expect(state.items[0].ocr.reviewedText).toBeNull();

    state = imagePortalReducer(state, { type: "ocr/reviewed", itemId: "current", expectedOperationGeneration: 5, expectedReviewRevision: currentReviewRevision, status: "accepted", reviewedText: "CURRENT REVIEW" });
    state = imagePortalReducer(state, { type: "review/confirmed", expectedReviewGeneration: state.reviewGeneration });
    const buildGeneration = state.buildGeneration + 1;
    state = imagePortalReducer(state, { type: "build/started", generation: buildGeneration, expectedReviewGeneration: state.reviewGeneration });
    state = imagePortalReducer(state, {
      type: "item/setting-changed",
      itemId: "current",
      expectedReviewRevision: state.items[0].reviewRevision,
      field: "aspectRatio",
      value: "3:4",
    });
    state = imagePortalReducer(state, {
      type: "build/completed",
      generation: buildGeneration,
      expectedReviewGeneration: state.reviewGeneration - 1,
      output: { packageName: "stale.zip", packageBytes: ownImageBytes(new Uint8Array([1])), itemCount: 1 },
    });
    expect(state.builtOutput).toBeNull();

    const beforeReset = state;
    state = imagePortalReducer(state, { type: "session/reset" });
    expect(state.items).toEqual([]);
    expect(state.operationGeneration).toBe(beforeReset.operationGeneration + 1);
    expect(state.reviewGeneration).toBe(beforeReset.reviewGeneration + 1);
    expect(state.buildGeneration).toBe(beforeReset.buildGeneration + 1);
    state = imagePortalReducer(state, { type: "ocr/completed", itemId: "current", generation: 5, detectedText: "LATE" });
    state = imagePortalReducer(state, { type: "items/admitted", generation: 3, items: [admission("resurrected")] });
    expect(state.items).toEqual([]);
  });

  it("ignores mismatched or duplicate generations instead of moving counters backward", () => {
    // Catches generation reuse allowing stale operations to become current again.
    let state = createInitialImagePortalState();
    state = imagePortalReducer(state, { type: "operation/started", generation: 8 });
    state = imagePortalReducer(state, { type: "operation/started", generation: 8 });
    state = imagePortalReducer(state, { type: "operation/started", generation: 7 });
    expect(state.operationGeneration).toBe(8);

    state = imagePortalReducer(state, { type: "items/admitted", generation: 8, items: [admission("one")] });
    state = imagePortalReducer(state, { type: "review/confirmed", expectedReviewGeneration: state.reviewGeneration - 1 });
    expect(state.confirmedReviewGeneration).toBeNull();
    state = imagePortalReducer(state, { type: "review/confirmed", expectedReviewGeneration: state.reviewGeneration });
    state = imagePortalReducer(state, { type: "build/started", generation: 2, expectedReviewGeneration: state.reviewGeneration });
    state = imagePortalReducer(state, { type: "build/started", generation: 2, expectedReviewGeneration: state.reviewGeneration });
    expect(state.buildGeneration).toBe(2);
  });

  it("requires bulk patches to use real Image settings keys", () => {
    // Type-level companion: this runtime assertion catches an empty mask applying a populated patch.
    let state = admit(createInitialImagePortalState(), 1, admission("one"));
    state = imagePortalReducer(state, { type: "bulk/selection-changed", itemId: "one", selected: true });
    const before: Readonly<ImagePromptSettings> = state.items[0].settings;
    state = imagePortalReducer(state, {
      type: "bulk/settings-applied",
      expectedReviewGeneration: state.reviewGeneration,
      fields: [],
      patch: { requestedChanges: "Must stay unapplied." },
    });
    expect(state.items[0].settings).toBe(before);
  });

  it("rejects forged individual setting values without corrupting state", () => {
    // Catches JavaScript callers bypassing TypeScript and storing a wrong runtime type or enum member.
    const admitted = admit(createInitialImagePortalState(), 1, admission("one"));
    const revision = admitted.items[0].reviewRevision;
    const forgedBoolean = {
      type: "item/setting-changed",
      itemId: "one",
      expectedReviewRevision: revision,
      field: "preserveVisibleText",
      value: "false",
    } as unknown as ImagePortalAction;
    const forgedEnum = {
      type: "item/setting-changed",
      itemId: "one",
      expectedReviewRevision: revision,
      field: "aspectRatio",
      value: "panorama",
    } as unknown as ImagePortalAction;
    const forgedDefaults = {
      type: "defaults/changed",
      defaults: { ...admitted.defaults, preserveVisibleText: "false" },
    } as unknown as ImagePortalAction;

    expect(imagePortalReducer(admitted, forgedBoolean)).toBe(admitted);
    expect(imagePortalReducer(admitted, forgedEnum)).toBe(admitted);
    expect(imagePortalReducer(admitted, forgedDefaults)).toBe(admitted);
  });

  it("rejects an entire forged bulk patch when a masked value is missing or invalid", () => {
    // Catches partial application leaving selected items with undefined or invalid Image settings.
    let state = admit(createInitialImagePortalState(), 1, admission("one"));
    state = imagePortalReducer(state, { type: "bulk/selection-changed", itemId: "one", selected: true });
    const missingMaskedValue = {
      type: "bulk/settings-applied",
      expectedReviewGeneration: state.reviewGeneration,
      fields: ["aspectRatio", "preserveVisibleText"],
      patch: { aspectRatio: "16:9", preserveVisibleText: undefined },
    } as unknown as ImagePortalAction;
    const invalidMaskedValue = {
      type: "bulk/settings-applied",
      expectedReviewGeneration: state.reviewGeneration,
      fields: ["modelFamily"],
      patch: { modelFamily: "invented-provider" },
    } as unknown as ImagePortalAction;

    expect(imagePortalReducer(state, missingMaskedValue)).toBe(state);
    expect(imagePortalReducer(state, invalidMaskedValue)).toBe(state);
  });
});
