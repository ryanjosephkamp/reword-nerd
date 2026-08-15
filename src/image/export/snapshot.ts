import { MAX_IMAGE_SESSION_COUNT } from "../intakeContracts";
import { imagePromptProfile } from "../profiles";
import type { ImagePortalState } from "../reducer";
import type {
  ImagePackageFailure,
  ImagePackageSnapshotItem,
  ImagePackageSnapshotResult,
} from "./contracts";

const NOT_CONFIRMED: ImagePackageFailure = Object.freeze({
  code: "IMAGE_SET_NOT_CONFIRMED",
  message: "Confirm the current image set before building a package.",
});

function cloneProvenance(item: ImagePackageSnapshotItem["provenance"]): ImagePackageSnapshotItem["provenance"] {
  return Object.freeze({
    ...item,
    containerChain: Object.freeze(item.containerChain.map((node) => Object.freeze({ ...node }))),
  });
}

function cloneSnapshotItem(item: ImagePortalState["items"][number]): ImagePackageSnapshotItem {
  const profile = imagePromptProfile(item.settings.modelFamily);
  return Object.freeze({
    occurrenceId: item.id,
    incarnation: item.incarnation,
    sourceBytes: item.sourceBytes.slice(0, item.byteCount, item.mimeType),
    byteCount: item.byteCount,
    sourceHash: item.sourceHash,
    mimeType: item.mimeType,
    fileExtension: item.fileExtension,
    dimensions: Object.freeze({ ...item.dimensions }),
    provenance: cloneProvenance(item.provenance),
    settings: Object.freeze({ ...item.settings }),
    ocr: Object.freeze({ ...item.ocr }),
    warnings: Object.freeze([...item.warnings]),
    reviewRevision: item.reviewRevision,
    expectedProfileVersion: profile.profileVersion,
    expectedProfileVerifiedAt: profile.lastVerifiedAt,
  });
}

export function snapshotConfirmedImagePackage(state: Readonly<ImagePortalState>): ImagePackageSnapshotResult {
  const included = state.items.filter((item) => item.included);
  if (state.confirmedReviewGeneration !== state.reviewGeneration
    || included.length < 1
    || included.length > MAX_IMAGE_SESSION_COUNT
    || included.some((item) => item.ocr.status === "processing" || item.ocr.status === "needs-review")) {
    return { ok: false, error: NOT_CONFIRMED };
  }
  return {
    ok: true,
    snapshot: Object.freeze({
      sessionGeneration: state.sessionGeneration,
      reviewGeneration: state.reviewGeneration,
      confirmedReviewGeneration: state.confirmedReviewGeneration,
      items: Object.freeze(included.map(cloneSnapshotItem)),
    }),
  };
}
