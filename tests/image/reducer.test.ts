import { DEFAULT_IMAGE_PROMPT_SETTINGS, ownImageBytes, type ImagePromptSettings } from "../../src/image/contracts";
import {
  createInitialImagePortalState,
  imagePortalReducer as strictImagePortalReducer,
  type ImagePortalAction,
  type ImagePortalState,
} from "../../src/image/reducer";
import type { ImageAdmission } from "../../src/image/intakeContracts";

type ImageOcrAction = Extract<ImagePortalAction, { type: `ocr/${string}` }>;
type ImageOcrTokenField = "expectedSessionGeneration" | "expectedItemIncarnation" | "expectedSourceHash";
type TestImageOcrAction = ImageOcrAction extends infer Action
  ? Action extends ImageOcrAction
    ? Omit<Action, ImageOcrTokenField> & Partial<Pick<Action, ImageOcrTokenField>>
    : never
  : never;
type TestImagePortalAction = Exclude<ImagePortalAction, { type: `ocr/${string}` }> | TestImageOcrAction;

function imagePortalReducer(state: ImagePortalState, action: TestImagePortalAction): ImagePortalState {
  if (action.type.startsWith("ocr/")) {
    const ocrAction = action as TestImageOcrAction;
    const current = state.items.find((item) => item.id === ocrAction.itemId);
    if (current) {
      return strictImagePortalReducer(state, {
        expectedSessionGeneration: state.sessionGeneration,
        expectedItemIncarnation: current.incarnation,
        expectedSourceHash: current.sourceHash,
        ...ocrAction,
      } as ImagePortalAction);
    }
  }
  return strictImagePortalReducer(state, action as ImagePortalAction);
}

function admission(id: string, sourceHash = `hash-${id}`): ImageAdmission {
  return {
    id,
    ordinal: 0,
    sourceBytes: ownImageBytes(new Uint8Array([1, 2, id.length]), "image/png"),
    byteCount: 3,
    sourceHash,
    mimeType: "image/png",
    fileExtension: "png",
    width: 3,
    height: 2,
    provenance: {
      intakeKind: "direct",
      sourceName: `${id}.png`,
      sourcePath: null,
      containerChain: [],
      containerName: null,
      containerHash: null,
      containerPath: null,
      pageNumber: null,
      relationshipId: null,
    },
    warnings: [],
  };
}

function dispatch(state: ImagePortalState, ...actions: TestImagePortalAction[]): ImagePortalState {
  return actions.reduce(imagePortalReducer, state);
}

function admit(state: ImagePortalState, generation: number, ...items: ImageAdmission[]): ImagePortalState {
  const expectedSessionGeneration = state.sessionGeneration;
  return dispatch(
    state,
    { type: "operation/started", generation, expectedSessionGeneration },
    { type: "items/admitted", generation, expectedSessionGeneration, items },
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

  it("requires session, incarnation, and source custody on every OCR transition", () => {
    // Catches typed callers creating an OCR completion that cannot distinguish item incarnations.
    type MissingOcrCustodyAssignable = {
      type: "ocr/completed";
      itemId: string;
      generation: number;
      expectedSessionGeneration: number;
      detectedText: string;
    } extends ImagePortalAction ? true : false;

    expectTypeOf<MissingOcrCustodyAssignable>().toEqualTypeOf<false>();
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
      expectedSessionGeneration: state.sessionGeneration,
    });
    expect([state.confirmedReviewGeneration, state.builtOutput]).toEqual([null, null]);
    const ocrGeneration = state.items[0].ocr.operationGeneration;
    state = imagePortalReducer(state, {
      type: "ocr/completed",
      itemId: "first",
      generation: ocrGeneration,
      expectedSessionGeneration: state.sessionGeneration,
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
      {
        type: "operation/started",
        generation: replacementGeneration,
        expectedSessionGeneration: state.sessionGeneration,
      },
      {
        type: "source/replaced",
        itemId: "first",
        expectedSourceHash: "hash-first",
        generation: replacementGeneration,
        expectedSessionGeneration: state.sessionGeneration,
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

  it("keeps a pending admission epoch current while OCR starts and completes", () => {
    // Catches an item-local OCR generation rejecting itself against, or consuming, the admission epoch.
    let state = admit(createInitialImagePortalState(), 1, admission("first"));
    state = imagePortalReducer(state, {
      type: "operation/started",
      generation: 10,
      expectedSessionGeneration: state.sessionGeneration,
    });
    state = imagePortalReducer(state, {
      type: "ocr/started",
      itemId: "first",
      generation: 1,
      expectedSessionGeneration: state.sessionGeneration,
    });

    expect(state.operationGeneration).toBe(10);
    expect(state.items[0].ocr).toMatchObject({ status: "processing", operationGeneration: 1 });

    state = imagePortalReducer(state, {
      type: "items/admitted",
      generation: 10,
      expectedSessionGeneration: state.sessionGeneration,
      items: [admission("second")],
    });
    state = imagePortalReducer(state, {
      type: "ocr/completed",
      itemId: "first",
      generation: 1,
      expectedSessionGeneration: state.sessionGeneration,
      detectedText: "FIRST",
    });

    expect(state.items.map((item) => item.id)).toEqual(["first", "second"]);
    expect(state.items[0].ocr).toMatchObject({ status: "needs-review", detectedText: "FIRST" });
  });

  it("keeps a pending source replacement current when a higher OCR generation starts", () => {
    // Catches OCR advancing the state epoch and making the matching source replacement look stale.
    let state = admit(createInitialImagePortalState(), 1, admission("first"), admission("second"));
    state = imagePortalReducer(state, {
      type: "operation/started",
      generation: 20,
      expectedSessionGeneration: state.sessionGeneration,
    });
    state = imagePortalReducer(state, {
      type: "ocr/started",
      itemId: "second",
      generation: 21,
      expectedSessionGeneration: state.sessionGeneration,
    });

    expect(state.operationGeneration).toBe(20);

    state = imagePortalReducer(state, {
      type: "source/replaced",
      itemId: "first",
      expectedSourceHash: "hash-first",
      generation: 20,
      expectedSessionGeneration: state.sessionGeneration,
      source: admission("first", "replacement-hash"),
    });
    state = imagePortalReducer(state, {
      type: "ocr/completed",
      itemId: "second",
      generation: 21,
      expectedSessionGeneration: state.sessionGeneration,
      detectedText: "SECOND",
    });

    expect(state.items[0].sourceHash).toBe("replacement-hash");
    expect(state.items[1].ocr).toMatchObject({ status: "needs-review", detectedText: "SECOND" });
  });

  it("preserves item-local OCR monotonicity when source replacement follows OCR", () => {
    // Catches source replacement resetting the OCR counter and allowing an old-source completion to collide.
    let state = admit(createInitialImagePortalState(), 1, admission("first"));
    state = imagePortalReducer(state, {
      type: "ocr/started",
      itemId: "first",
      generation: 1,
      expectedSessionGeneration: state.sessionGeneration,
    });
    const oldCompletion = {
      type: "ocr/completed",
      itemId: "first",
      generation: 1,
      expectedSessionGeneration: state.sessionGeneration,
      detectedText: "OLD SOURCE",
    } as const;

    state = imagePortalReducer(state, {
      type: "operation/started",
      generation: 10,
      expectedSessionGeneration: state.sessionGeneration,
    });
    state = imagePortalReducer(state, {
      type: "source/replaced",
      itemId: "first",
      expectedSourceHash: "hash-first",
      generation: 10,
      expectedSessionGeneration: state.sessionGeneration,
      source: admission("first", "replacement-hash"),
    });
    expect(state.items[0].ocr).toMatchObject({ status: "off", operationGeneration: 1 });

    state = imagePortalReducer(state, oldCompletion);
    state = imagePortalReducer(state, {
      type: "ocr/started",
      itemId: "first",
      generation: 1,
      expectedSessionGeneration: state.sessionGeneration,
    });
    expect(state.items[0].ocr.status).toBe("off");

    state = imagePortalReducer(state, {
      type: "ocr/started",
      itemId: "first",
      generation: 2,
      expectedSessionGeneration: state.sessionGeneration,
    });
    state = imagePortalReducer(state, {
      type: "ocr/completed",
      itemId: "first",
      generation: 2,
      expectedSessionGeneration: state.sessionGeneration,
      detectedText: "NEW SOURCE",
    });
    expect(state.items[0].ocr).toMatchObject({ status: "needs-review", detectedText: "NEW SOURCE" });
  });

  it("allows concurrent item-local OCR and rejects stale, removed, or reset completions", () => {
    // Catches one image's OCR generation superseding another image or late OCR restoring cleared state.
    let state = admit(createInitialImagePortalState(), 7, admission("first"), admission("second"));
    state = dispatch(
      state,
      {
        type: "ocr/started",
        itemId: "first",
        generation: 1,
        expectedSessionGeneration: state.sessionGeneration,
      },
      {
        type: "ocr/started",
        itemId: "second",
        generation: 1,
        expectedSessionGeneration: state.sessionGeneration,
      },
      {
        type: "ocr/started",
        itemId: "first",
        generation: 2,
        expectedSessionGeneration: state.sessionGeneration,
      },
    );

    state = imagePortalReducer(state, {
      type: "ocr/completed",
      itemId: "first",
      generation: 1,
      expectedSessionGeneration: state.sessionGeneration,
      detectedText: "STALE FIRST",
    });
    state = imagePortalReducer(state, {
      type: "ocr/completed",
      itemId: "second",
      generation: 1,
      expectedSessionGeneration: state.sessionGeneration,
      detectedText: "CURRENT SECOND",
    });
    expect(state.items[0].ocr).toMatchObject({ status: "processing", detectedText: null, operationGeneration: 2 });
    expect(state.items[1].ocr).toMatchObject({ status: "needs-review", detectedText: "CURRENT SECOND" });

    state = imagePortalReducer(state, { type: "item/removed", itemId: "first" });
    const afterRemoval = state;
    state = imagePortalReducer(state, {
      type: "ocr/completed",
      itemId: "first",
      generation: 2,
      expectedSessionGeneration: state.sessionGeneration,
      detectedText: "LATE REMOVED",
    });
    expect(state).toBe(afterRemoval);

    state = imagePortalReducer(state, {
      type: "ocr/started",
      itemId: "second",
      generation: 2,
      expectedSessionGeneration: state.sessionGeneration,
    });
    const resetSessionGeneration = state.sessionGeneration;
    state = imagePortalReducer(state, { type: "session/reset" });
    state = imagePortalReducer(state, {
      type: "ocr/completed",
      itemId: "second",
      generation: 2,
      expectedSessionGeneration: resetSessionGeneration,
      detectedText: "LATE RESET",
    });
    expect(state.items).toEqual([]);
  });

  it("rejects an old-session OCR completion after the same ID and generation are reused", () => {
    // Catches deterministic item IDs making an old OCR completion indistinguishable after reset.
    let state = admit(createInitialImagePortalState(), 7, admission("same-id"));
    state = imagePortalReducer(state, {
      type: "ocr/started",
      itemId: "same-id",
      generation: 1,
      expectedSessionGeneration: state.sessionGeneration,
    });
    const oldSessionGeneration = state.sessionGeneration;
    const oldCompletion = {
      type: "ocr/completed",
      itemId: "same-id",
      generation: 1,
      expectedSessionGeneration: oldSessionGeneration,
      detectedText: "OLD SESSION",
    } as const;

    state = imagePortalReducer(state, { type: "session/reset" });
    state = admit(state, 9, admission("same-id"));
    state = imagePortalReducer(state, {
      type: "ocr/started",
      itemId: "same-id",
      generation: 1,
      expectedSessionGeneration: state.sessionGeneration,
    });
    state = imagePortalReducer(state, oldCompletion);

    expect(state.items[0].ocr).toMatchObject({ status: "processing", detectedText: null });

    state = imagePortalReducer(state, {
      type: "ocr/completed",
      itemId: "same-id",
      generation: 1,
      expectedSessionGeneration: state.sessionGeneration,
      detectedText: "NEW SESSION",
    });
    expect(state.items[0].ocr).toMatchObject({ status: "needs-review", detectedText: "NEW SESSION" });
  });

  it("rejects old completion and failure actions after same-ID removal and readmission", () => {
    // Catches a same-session occurrence reusing both the deterministic ID and numeric OCR generation.
    let state = admit(createInitialImagePortalState(), 1, admission("same-id"));
    const oldItem = state.items[0];
    const oldToken = {
      expectedSessionGeneration: state.sessionGeneration,
      expectedItemIncarnation: oldItem.incarnation,
      expectedSourceHash: oldItem.sourceHash,
    };
    state = strictImagePortalReducer(state, {
      type: "ocr/started",
      itemId: oldItem.id,
      generation: 1,
      ...oldToken,
    });
    const oldCompletion = {
      type: "ocr/completed",
      itemId: oldItem.id,
      generation: 1,
      detectedText: "OLD OCCURRENCE",
      ...oldToken,
    } as const;
    const oldFailure = {
      type: "ocr/failed",
      itemId: oldItem.id,
      generation: 1,
      ...oldToken,
    } as const;

    state = strictImagePortalReducer(state, { type: "item/removed", itemId: oldItem.id });
    state = admit(state, 2, admission("same-id"));
    const current = state.items[0];
    expect(current.incarnation).toBeGreaterThan(oldItem.incarnation);
    state = strictImagePortalReducer(state, {
      type: "ocr/started",
      itemId: current.id,
      generation: 1,
      expectedSessionGeneration: state.sessionGeneration,
      expectedItemIncarnation: current.incarnation,
      expectedSourceHash: current.sourceHash,
    });

    state = strictImagePortalReducer(state, oldCompletion);
    state = strictImagePortalReducer(state, oldFailure);
    expect(state.items[0].ocr).toMatchObject({ status: "processing", detectedText: null });

    state = strictImagePortalReducer(state, {
      type: "ocr/completed",
      itemId: current.id,
      generation: 1,
      expectedSessionGeneration: state.sessionGeneration,
      expectedItemIncarnation: current.incarnation,
      expectedSourceHash: current.sourceHash,
      detectedText: "CURRENT OCCURRENCE",
    });
    expect(state.items[0].ocr).toMatchObject({ status: "needs-review", detectedText: "CURRENT OCCURRENCE" });
  });

  it("rejects old review actions after same-ID readmission in the same or a reset session", () => {
    // Catches operation/review revisions colliding when a deterministic ID is re-created from zero.
    let state = admit(createInitialImagePortalState(), 1, admission("same-id"));
    const oldItem = state.items[0];
    const oldToken = {
      expectedSessionGeneration: state.sessionGeneration,
      expectedItemIncarnation: oldItem.incarnation,
      expectedSourceHash: oldItem.sourceHash,
    };
    state = strictImagePortalReducer(state, { type: "ocr/started", itemId: oldItem.id, generation: 1, ...oldToken });
    state = strictImagePortalReducer(state, {
      type: "ocr/completed",
      itemId: oldItem.id,
      generation: 1,
      detectedText: "OLD DRAFT",
      ...oldToken,
    });
    const oldReview = {
      type: "ocr/reviewed",
      itemId: oldItem.id,
      expectedOperationGeneration: 1,
      expectedReviewRevision: state.items[0].reviewRevision,
      status: "accepted",
      reviewedText: "OLD REVIEW",
      ...oldToken,
    } as const;

    state = strictImagePortalReducer(state, { type: "item/removed", itemId: oldItem.id });
    state = admit(state, 2, admission("same-id"));
    let current = state.items[0];
    const sameSessionToken = {
      expectedSessionGeneration: state.sessionGeneration,
      expectedItemIncarnation: current.incarnation,
      expectedSourceHash: current.sourceHash,
    };
    state = strictImagePortalReducer(state, { type: "ocr/started", itemId: current.id, generation: 1, ...sameSessionToken });
    state = strictImagePortalReducer(state, {
      type: "ocr/completed",
      itemId: current.id,
      generation: 1,
      detectedText: "CURRENT SAME SESSION",
      ...sameSessionToken,
    });
    state = strictImagePortalReducer(state, oldReview);
    expect(state.items[0].ocr).toMatchObject({ status: "needs-review", reviewedText: null, detectedText: "CURRENT SAME SESSION" });

    state = strictImagePortalReducer(state, { type: "session/reset" });
    state = admit(state, 4, admission("same-id"));
    current = state.items[0];
    const newSessionToken = {
      expectedSessionGeneration: state.sessionGeneration,
      expectedItemIncarnation: current.incarnation,
      expectedSourceHash: current.sourceHash,
    };
    state = strictImagePortalReducer(state, { type: "ocr/started", itemId: current.id, generation: 1, ...newSessionToken });
    state = strictImagePortalReducer(state, {
      type: "ocr/completed",
      itemId: current.id,
      generation: 1,
      detectedText: "CURRENT NEW SESSION",
      ...newSessionToken,
    });
    state = strictImagePortalReducer(state, oldReview);
    expect(state.items[0].ocr).toMatchObject({ status: "needs-review", reviewedText: null, detectedText: "CURRENT NEW SESSION" });
  });

  it("invalidates old-source OCR custody without affecting current replacement OCR", () => {
    // Catches source replacement retaining an async token that can mutate the new bytes.
    let state = admit(createInitialImagePortalState(), 1, admission("one"));
    const oldItem = state.items[0];
    const oldToken = {
      expectedSessionGeneration: state.sessionGeneration,
      expectedItemIncarnation: oldItem.incarnation,
      expectedSourceHash: oldItem.sourceHash,
    };
    state = strictImagePortalReducer(state, { type: "ocr/started", itemId: oldItem.id, generation: 1, ...oldToken });
    state = strictImagePortalReducer(state, {
      type: "operation/started",
      generation: 2,
      expectedSessionGeneration: state.sessionGeneration,
    });
    state = strictImagePortalReducer(state, {
      type: "source/replaced",
      itemId: oldItem.id,
      expectedSourceHash: oldItem.sourceHash,
      generation: 2,
      expectedSessionGeneration: state.sessionGeneration,
      source: admission("one", "replacement-hash"),
    });
    const replacement = state.items[0];
    expect(replacement.incarnation).toBeGreaterThan(oldItem.incarnation);
    const replacementToken = {
      expectedSessionGeneration: state.sessionGeneration,
      expectedItemIncarnation: replacement.incarnation,
      expectedSourceHash: replacement.sourceHash,
    };
    state = strictImagePortalReducer(state, { type: "ocr/started", itemId: replacement.id, generation: 2, ...replacementToken });

    state = strictImagePortalReducer(state, {
      type: "ocr/completed",
      itemId: oldItem.id,
      generation: 2,
      detectedText: "OLD SOURCE",
      ...oldToken,
    });
    state = strictImagePortalReducer(state, {
      type: "ocr/failed",
      itemId: oldItem.id,
      generation: 2,
      ...oldToken,
    });
    expect(state.items[0].ocr).toMatchObject({ status: "processing", detectedText: null });

    state = strictImagePortalReducer(state, {
      type: "ocr/completed",
      itemId: replacement.id,
      generation: 2,
      detectedText: "CURRENT SOURCE",
      ...replacementToken,
    });
    expect(state.items[0].ocr).toMatchObject({ status: "needs-review", detectedText: "CURRENT SOURCE" });
  });

  it("counts OCR Unicode code points and fails over-limit detection without retaining text", () => {
    // Catches UTF-16 length checks or detected OCR crossing the bounded in-memory custody boundary.
    const exactlyAtLimit = "😀".repeat(20_000);
    const sensitiveMarker = "PRIVATE-OCR-CONTENT";
    const overLimit = `${"x".repeat(20_001)}${sensitiveMarker}`;
    const safeWarning = "OCR text exceeded the 20,000 Unicode code-point limit and was not retained.";
    let state = admit(createInitialImagePortalState(), 1, admission("one"));

    state = dispatch(
      state,
      {
        type: "ocr/started",
        itemId: "one",
        generation: 1,
        expectedSessionGeneration: state.sessionGeneration,
      },
      {
        type: "ocr/completed",
        itemId: "one",
        generation: 1,
        expectedSessionGeneration: state.sessionGeneration,
        detectedText: exactlyAtLimit,
      },
    );
    expect(state.items[0].ocr).toMatchObject({ status: "needs-review", detectedText: exactlyAtLimit });

    state = dispatch(
      state,
      {
        type: "ocr/started",
        itemId: "one",
        generation: 2,
        expectedSessionGeneration: state.sessionGeneration,
      },
      {
        type: "ocr/completed",
        itemId: "one",
        generation: 2,
        expectedSessionGeneration: state.sessionGeneration,
        detectedText: overLimit,
      },
    );
    expect(state.items[0].ocr).toMatchObject({
      status: "failed",
      detectedText: null,
      reviewedText: null,
    });
    expect(state.items[0].warnings).toEqual([safeWarning]);
    expect(state.items[0].warnings.join(" ")).not.toContain(sensitiveMarker);
    expect(state.items[0].warnings[0].length).toBeLessThan(120);

    state = dispatch(
      state,
      {
        type: "ocr/started",
        itemId: "one",
        generation: 3,
        expectedSessionGeneration: state.sessionGeneration,
      },
      {
        type: "ocr/completed",
        itemId: "one",
        generation: 3,
        expectedSessionGeneration: state.sessionGeneration,
        detectedText: overLimit,
      },
    );
    expect(state.items[0].warnings).toEqual([safeWarning]);
  });

  it("keeps over-limit reviewed OCR pending and accepts exactly 20,000 code points", () => {
    // Catches review bypassing the OCR custody limit or confirmation accepting unresolved oversized text.
    const exactlyAtLimit = "🧠".repeat(20_000);
    const sensitiveMarker = "PRIVATE-REVIEWED-OCR";
    const overLimit = `${"y".repeat(20_001)}${sensitiveMarker}`;
    const safeWarning = "OCR text exceeded the 20,000 Unicode code-point limit and was not retained.";
    let state = admit(createInitialImagePortalState(), 1, admission("one"));
    state = dispatch(
      state,
      {
        type: "ocr/started",
        itemId: "one",
        generation: 1,
        expectedSessionGeneration: state.sessionGeneration,
      },
      {
        type: "ocr/completed",
        itemId: "one",
        generation: 1,
        expectedSessionGeneration: state.sessionGeneration,
        detectedText: "DRAFT",
      },
    );

    state = imagePortalReducer(state, {
      type: "ocr/reviewed",
      itemId: "one",
      expectedOperationGeneration: 1,
      expectedReviewRevision: state.items[0].reviewRevision,
      status: "accepted",
      reviewedText: overLimit,
    });
    expect(state.items[0].ocr).toMatchObject({
      status: "needs-review",
      detectedText: "DRAFT",
      reviewedText: null,
    });
    expect(state.items[0].warnings).toEqual([safeWarning]);
    expect(state.items[0].warnings.join(" ")).not.toContain(sensitiveMarker);

    state = imagePortalReducer(state, {
      type: "review/confirmed",
      expectedReviewGeneration: state.reviewGeneration,
    });
    expect(state.confirmedReviewGeneration).toBeNull();

    state = imagePortalReducer(state, {
      type: "ocr/reviewed",
      itemId: "one",
      expectedOperationGeneration: 1,
      expectedReviewRevision: state.items[0].reviewRevision,
      status: "accepted",
      reviewedText: exactlyAtLimit,
    });
    expect(state.items[0].ocr).toMatchObject({ status: "accepted", reviewedText: exactlyAtLimit });
  });

  it("rejects stale admission, OCR review, build completion, and post-reset completions", () => {
    // Catches a slow earlier async operation overwriting a newer review or resurrecting reset session data.
    let state = createInitialImagePortalState();
    state = imagePortalReducer(state, {
      type: "operation/started",
      generation: 3,
      expectedSessionGeneration: state.sessionGeneration,
    });
    state = imagePortalReducer(state, {
      type: "items/admitted",
      generation: 2,
      expectedSessionGeneration: state.sessionGeneration,
      items: [admission("stale")],
    });
    expect(state.items).toHaveLength(0);
    state = imagePortalReducer(state, {
      type: "items/admitted",
      generation: 3,
      expectedSessionGeneration: state.sessionGeneration,
      items: [admission("current")],
    });

    state = imagePortalReducer(state, { type: "ocr/started", itemId: "current", generation: 4, expectedSessionGeneration: state.sessionGeneration });
    state = imagePortalReducer(state, { type: "ocr/started", itemId: "current", generation: 5, expectedSessionGeneration: state.sessionGeneration });
    state = imagePortalReducer(state, { type: "ocr/completed", itemId: "current", generation: 4, expectedSessionGeneration: state.sessionGeneration, detectedText: "STALE" });
    expect(state.items[0].ocr).toMatchObject({ status: "processing", detectedText: null, operationGeneration: 5 });
    state = imagePortalReducer(state, { type: "ocr/completed", itemId: "current", generation: 5, expectedSessionGeneration: state.sessionGeneration, detectedText: "CURRENT" });
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
    expect(state.sessionGeneration).toBe(beforeReset.sessionGeneration + 1);
    expect(state.operationGeneration).toBe(beforeReset.operationGeneration + 1);
    expect(state.reviewGeneration).toBe(beforeReset.reviewGeneration + 1);
    expect(state.buildGeneration).toBe(beforeReset.buildGeneration + 1);
    state = imagePortalReducer(state, { type: "ocr/completed", itemId: "current", generation: 5, expectedSessionGeneration: beforeReset.sessionGeneration, detectedText: "LATE" });
    state = imagePortalReducer(state, { type: "items/admitted", generation: 3, expectedSessionGeneration: beforeReset.sessionGeneration, items: [admission("resurrected")] });
    expect(state.items).toEqual([]);
  });

  it("ignores mismatched or duplicate generations instead of moving counters backward", () => {
    // Catches generation reuse allowing stale operations to become current again.
    let state = createInitialImagePortalState();
    state = imagePortalReducer(state, { type: "operation/started", generation: 8, expectedSessionGeneration: state.sessionGeneration });
    state = imagePortalReducer(state, { type: "operation/started", generation: 8, expectedSessionGeneration: state.sessionGeneration });
    state = imagePortalReducer(state, { type: "operation/started", generation: 7, expectedSessionGeneration: state.sessionGeneration });
    expect(state.operationGeneration).toBe(8);

    state = imagePortalReducer(state, { type: "items/admitted", generation: 8, expectedSessionGeneration: state.sessionGeneration, items: [admission("one")] });
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
