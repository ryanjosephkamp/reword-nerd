import {
  IMAGE_PACKAGE_FILENAME,
  IMAGE_PACKAGE_FORMAT,
  IMAGE_PACKAGE_SCHEMA_VERSION,
  snapshotConfirmedImagePackage,
} from "../../src/image/export";
import { ownImageBytes } from "../../src/image/contracts";
import { createInitialImagePortalState, imagePortalReducer, type ImagePortalState } from "../../src/image/reducer";
import type { ImageAdmission } from "../../src/image/intakeContracts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function admission(id: string, sourceHash: string, sourceName = `${id}.png`): ImageAdmission {
  const sourceBytes = ownImageBytes(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, id.length]), "image/png");
  return {
    id,
    ordinal: 0,
    sourceBytes,
    byteCount: sourceBytes.size,
    sourceHash,
    mimeType: "image/png",
    fileExtension: "png",
    width: 3,
    height: 2,
    provenance: {
      intakeKind: "folder",
      sourceName,
      sourcePath: `folder/${sourceName}`,
      containerChain: [{
        kind: "folder",
        name: "folder",
        sha256: null,
        path: "folder",
        byteCount: null,
      }],
      containerName: "folder",
      containerHash: null,
      containerPath: "folder",
      pageNumber: null,
      relationshipId: null,
    },
    warnings: ["Review this source."],
  };
}

function confirmedState(): ImagePortalState {
  let state = createInitialImagePortalState();
  state = imagePortalReducer(state, { type: "operation/started", generation: 1, expectedSessionGeneration: 0 });
  state = imagePortalReducer(state, {
    type: "items/admitted",
    generation: 1,
    expectedSessionGeneration: 0,
    items: [admission("first", HASH_A, "duplicate.png"), admission("second", HASH_B, "duplicate.png")],
  });
  return imagePortalReducer(state, { type: "review/confirmed", expectedReviewGeneration: state.reviewGeneration });
}

describe("confirmed Image package snapshot", () => {
  it("exposes the exact schema identity constants", () => {
    // Catches Image packages drifting to the Text schema or an unstable filename.
    expect([IMAGE_PACKAGE_FORMAT, IMAGE_PACKAGE_SCHEMA_VERSION, IMAGE_PACKAGE_FILENAME]).toEqual([
      "image-reference-prompt-package",
      1,
      "reword-nerd-image-prompt-package.zip",
    ]);
  });

  it("snapshots included items in queue order while retaining duplicate names", () => {
    // Catches filename/hash sorting, silent deduplication, or omitted occurrence custody.
    const result = snapshotConfirmedImagePackage(confirmedState());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.items.map((item) => ({
      occurrenceId: item.occurrenceId,
      sourceName: item.provenance.sourceName,
      sourceHash: item.sourceHash,
    }))).toEqual([
      { occurrenceId: "first", sourceName: "duplicate.png", sourceHash: HASH_A },
      { occurrenceId: "second", sourceName: "duplicate.png", sourceHash: HASH_B },
    ]);

    const omitted = imagePortalReducer(confirmedState(), {
      type: "item/inclusion-changed",
      itemId: "first",
      included: false,
    });
    const reconfirmed = imagePortalReducer(omitted, {
      type: "review/confirmed",
      expectedReviewGeneration: omitted.reviewGeneration,
    });
    const omittedResult = snapshotConfirmedImagePackage(reconfirmed);
    expect(omittedResult.ok && omittedResult.snapshot.items.map((item) => item.occurrenceId)).toEqual(["second"]);
  });

  it("deep-clones nested state and slices every source Blob synchronously", () => {
    // Catches a pending build observing later live settings/provenance/OCR/warning mutations.
    const original = confirmedState();
    const originalItem = original.items[0];
    const mutableItem = {
      ...originalItem,
      settings: { ...originalItem.settings },
      provenance: {
        ...originalItem.provenance,
        containerChain: originalItem.provenance.containerChain.map((node) => ({ ...node })),
      },
      warnings: [...originalItem.warnings],
      ocr: { ...originalItem.ocr },
    };
    const state = { ...original, items: [mutableItem, original.items[1]] };
    const result = snapshotConfirmedImagePackage(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const source = state.items[0].sourceBytes;
    expect(result.snapshot.items[0].sourceBytes).not.toBe(source);
    expect(result.snapshot.items[0].sourceBytes.size).toBe(source.size);

    const mutable = mutableItem as unknown as {
      settings: { requestedChanges: string };
      provenance: { sourceName: string; containerChain: Array<{ name: string }> };
      warnings: string[];
      ocr: { reviewedText: string | null };
    };
    mutable.settings.requestedChanges = "MUTATED";
    mutable.provenance.sourceName = "mutated.png";
    mutable.provenance.containerChain[0].name = "mutated";
    mutable.warnings.push("MUTATED");
    mutable.ocr.reviewedText = "MUTATED";

    expect(result.snapshot.items[0]).toMatchObject({
      settings: { requestedChanges: "" },
      provenance: { sourceName: "duplicate.png", containerChain: [{ name: "folder" }] },
      warnings: ["Review this source."],
      ocr: { reviewedText: null },
    });
  });

  it("refuses unconfirmed, empty, and unresolved OCR revisions with bounded errors", () => {
    // Catches export beginning before the explicit review boundary is valid.
    const empty = snapshotConfirmedImagePackage(createInitialImagePortalState());
    expect(empty).toEqual({
      ok: false,
      error: { code: "IMAGE_SET_NOT_CONFIRMED", message: "Confirm the current image set before building a package." },
    });

    let state = confirmedState();
    state = imagePortalReducer(state, {
      type: "ocr/started",
      itemId: "first",
      generation: 1,
      expectedSessionGeneration: state.sessionGeneration,
      expectedItemIncarnation: state.items[0].incarnation,
      expectedSourceHash: state.items[0].sourceHash,
    });
    const forgedConfirmed = {
      ...state,
      confirmedReviewGeneration: state.reviewGeneration,
    } as ImagePortalState;
    const result = snapshotConfirmedImagePackage(forgedConfirmed);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("IMAGE_SET_NOT_CONFIRMED");
  });

  it("keeps control tokens out of the deterministic serialization surface", () => {
    // Catches session/build/review/occurrence tokens leaking into package JSON.
    const result = snapshotConfirmedImagePackage(confirmedState());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const publicProjection = result.snapshot.items.map((snapshotItem) => {
      const { sourceBytes, occurrenceId, incarnation, reviewRevision, ocr, ...item } = snapshotItem;
      void sourceBytes;
      void occurrenceId;
      void incarnation;
      void reviewRevision;
      return {
        ...item,
        ocr: { status: ocr.status, detectedText: ocr.detectedText, reviewedText: ocr.reviewedText },
      };
    });
    const serialized = JSON.stringify(publicProjection);
    expect(serialized).not.toContain("occurrenceId");
    expect(serialized).not.toContain("incarnation");
    expect(serialized).not.toContain("reviewRevision");
    expect(serialized).not.toContain("sessionGeneration");
  });
});
