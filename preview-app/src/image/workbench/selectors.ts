import type { ImagePortalItem, ImagePromptSettings } from "../contracts";
import type { ImagePortalState, ImageSettingField } from "../reducer";

export const IMAGE_SETTING_FIELDS: readonly ImageSettingField[] = Object.freeze([
  "modelFamily",
  "aspectRatio",
  "sizeIntent",
  "preserveVisibleText",
  "backgroundBehavior",
  "requestedChanges",
  "mustPreserve",
]);

export function selectFocusedImage(state: ImagePortalState): ImagePortalItem | null {
  return state.items.find((item) => item.id === state.focusedItemId) ?? null;
}

export function selectBulkImages(state: ImagePortalState): readonly ImagePortalItem[] {
  return state.items.filter((item) => item.bulkSelected);
}

export function selectIncludedImages(state: ImagePortalState): readonly ImagePortalItem[] {
  return state.items.filter((item) => item.included);
}

export function selectCommonImageSettings(
  items: readonly Readonly<ImagePortalItem>[],
): Partial<ImagePromptSettings> {
  if (items.length === 0) return {};
  const common: Partial<ImagePromptSettings> = {};
  for (const field of IMAGE_SETTING_FIELDS) {
    const first = items[0].settings[field];
    if (items.every((item) => Object.is(item.settings[field], first))) {
      Object.assign(common, { [field]: first });
    }
  }
  return common;
}

export interface ImageConfirmationView {
  readonly guidance: string;
  readonly ready: boolean;
  readonly confirmed: boolean;
}

export function selectImageConfirmation(state: ImagePortalState): ImageConfirmationView {
  if (state.items.length === 0) {
    return { guidance: "Add images to begin.", ready: false, confirmed: false };
  }
  const included = selectIncludedImages(state);
  if (included.length === 0) {
    return { guidance: "Include at least one image.", ready: false, confirmed: false };
  }
  if (included.some((item) => item.ocr.status === "processing")) {
    return { guidance: "Wait for included-image OCR to finish.", ready: false, confirmed: false };
  }
  if (included.some((item) => item.ocr.status === "needs-review")) {
    return { guidance: "Accept or reject included OCR that needs review.", ready: false, confirmed: false };
  }
  if (state.confirmedReviewGeneration === state.reviewGeneration) {
    return {
      guidance: "Image set confirmed for the current review generation.",
      ready: false,
      confirmed: true,
    };
  }
  return { guidance: "Ready to confirm the current image set.", ready: true, confirmed: false };
}
