import {
  DEFAULT_IMAGE_PROMPT_SETTINGS,
  cloneImagePromptSettings,
  createImagePortalItem,
  isImagePromptSettings,
  isImagePromptSettingValue,
  isImageOcrTextWithinLimit,
  type ImagePortalItem,
  type ImagePromptSettings,
} from "./contracts";
import {
  IMAGE_PACKAGE_FILENAME,
  IMAGE_PACKAGE_FORMAT,
  IMAGE_PACKAGE_SCHEMA_VERSION,
  type ImageBuiltOutput,
} from "./export/contracts";
import type { ImageAdmission } from "./intakeContracts";
import type { SavedImagePreferences } from "./preferences";

export type { ImageAdmission } from "./intakeContracts";
export type ImageSettingField = keyof ImagePromptSettings;

export type ImageSettingChangeAction = {
  [Field in ImageSettingField]: {
    type: "item/setting-changed";
    itemId: string;
    expectedReviewRevision: number;
    field: Field;
    value: ImagePromptSettings[Field];
  }
}[ImageSettingField];

export type ImageBuildStatus = "idle" | "building" | "ready" | "error";

export interface ImagePortalState {
  readonly items: readonly ImagePortalItem[];
  readonly focusedItemId: string | null;
  readonly defaults: Readonly<ImagePromptSettings>;
  readonly tutorialSeenVersion: string | null;
  readonly nextItemIncarnation: number;
  readonly sessionGeneration: number;
  readonly operationGeneration: number;
  readonly reviewGeneration: number;
  readonly buildGeneration: number;
  readonly confirmedReviewGeneration: number | null;
  readonly buildStatus: ImageBuildStatus;
  readonly builtOutput: ImageBuiltOutput | null;
  readonly safeBuildMessage: string;
}

export type ImagePortalAction =
  | { type: "operation/started"; generation: number; expectedSessionGeneration: number }
  | {
      type: "items/admitted";
      generation: number;
      expectedSessionGeneration: number;
      items: readonly ImageAdmission[];
    }
  | { type: "focus/changed"; itemId: string }
  | { type: "bulk/selection-changed"; itemId: string; selected: boolean }
  | { type: "item/inclusion-changed"; itemId: string; included: boolean }
  | { type: "item/removed"; itemId: string }
  | { type: "defaults/changed"; defaults: ImagePromptSettings }
  | ImageSettingChangeAction
  | {
      type: "bulk/settings-applied";
      expectedReviewGeneration: number;
      fields: readonly ImageSettingField[];
      patch: Partial<ImagePromptSettings>;
    }
  | {
      type: "ocr/started";
      itemId: string;
      generation: number;
      expectedSessionGeneration: number;
      expectedItemIncarnation: number;
      expectedSourceHash: string;
    }
  | {
      type: "ocr/completed";
      itemId: string;
      generation: number;
      expectedSessionGeneration: number;
      expectedItemIncarnation: number;
      expectedSourceHash: string;
      detectedText: string;
    }
  | {
      type: "ocr/failed";
      itemId: string;
      generation: number;
      expectedSessionGeneration: number;
      expectedItemIncarnation: number;
      expectedSourceHash: string;
    }
  | {
      type: "ocr/reviewed";
      itemId: string;
      expectedSessionGeneration: number;
      expectedItemIncarnation: number;
      expectedSourceHash: string;
      expectedOperationGeneration: number;
      expectedReviewRevision: number;
      status: "accepted" | "rejected";
      reviewedText: string | null;
    }
  | {
      type: "source/replaced";
      itemId: string;
      expectedSourceHash: string;
      generation: number;
      expectedSessionGeneration: number;
      source: ImageAdmission;
    }
  | { type: "review/confirmed"; expectedReviewGeneration: number }
  | { type: "build/started"; generation: number; expectedReviewGeneration: number }
  | {
      type: "build/completed";
      generation: number;
      expectedReviewGeneration: number;
      output: ImageBuiltOutput;
    }
  | { type: "build/failed"; generation: number; expectedReviewGeneration: number; message: string }
  | { type: "tutorial/seen"; version: string }
  | { type: "session/reset" };

const IMAGE_SETTING_FIELDS: readonly ImageSettingField[] = Object.freeze([
  "modelFamily",
  "aspectRatio",
  "sizeIntent",
  "preserveVisibleText",
  "backgroundBehavior",
  "requestedChanges",
  "mustPreserve",
]);

const IMAGE_OCR_TEXT_LIMIT_WARNING =
  "OCR text exceeded the 20,000 Unicode code-point limit and was not retained.";

export function createInitialImagePortalState(
  preferences: SavedImagePreferences | null = null,
): ImagePortalState {
  return {
    items: [],
    focusedItemId: null,
    defaults: {
      ...DEFAULT_IMAGE_PROMPT_SETTINGS,
      ...preferences?.defaults,
    },
    tutorialSeenVersion: preferences?.tutorialVersion ?? null,
    nextItemIncarnation: 1,
    sessionGeneration: 0,
    operationGeneration: 0,
    reviewGeneration: 0,
    buildGeneration: 0,
    confirmedReviewGeneration: null,
    buildStatus: "idle",
    builtOutput: null,
    safeBuildMessage: "",
  };
}

function invalidated(state: ImagePortalState, items: readonly ImagePortalItem[]): ImagePortalState {
  return {
    ...state,
    items,
    reviewGeneration: state.reviewGeneration + 1,
    buildGeneration: state.buildGeneration + 1,
    confirmedReviewGeneration: null,
    buildStatus: "idle",
    builtOutput: null,
    safeBuildMessage: "",
  };
}

function replaceItem(
  items: readonly ImagePortalItem[],
  itemId: string,
  update: (item: ImagePortalItem) => ImagePortalItem,
): readonly ImagePortalItem[] {
  return items.map((item) => item.id === itemId ? update(item) : item);
}

function settingValue(
  settings: Readonly<ImagePromptSettings>,
  field: ImageSettingField,
): ImagePromptSettings[ImageSettingField] {
  return settings[field];
}

function withSetting(
  settings: Readonly<ImagePromptSettings>,
  field: ImageSettingField,
  value: ImagePromptSettings[ImageSettingField],
): ImagePromptSettings {
  return { ...settings, [field]: value } as ImagePromptSettings;
}

function canConfirm(items: readonly ImagePortalItem[]): boolean {
  const included = items.filter((item) => item.included);
  return included.length > 0
    && included.every((item) => item.ocr.status !== "processing" && item.ocr.status !== "needs-review");
}

function withWarning(warnings: readonly string[], warning: string): readonly string[] {
  return warnings.includes(warning) ? warnings : [...warnings, warning];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCurrentBuiltOutput(
  state: ImagePortalState,
  generation: number,
  expectedReviewGeneration: number,
  candidate: unknown,
): candidate is ImageBuiltOutput {
  if (!isRecord(candidate)
    || !(candidate.packageBytes instanceof Blob)
    || !Array.isArray(candidate.previewPairs)
    || !isRecord(candidate.manifest)
    || !isRecord(candidate.manifest.package)
    || !Array.isArray(candidate.manifest.pairs)) return false;

  return candidate.buildGeneration === generation
    && candidate.builtForReviewGeneration === expectedReviewGeneration
    && candidate.builtForSessionGeneration === state.sessionGeneration
    && candidate.packageName === IMAGE_PACKAGE_FILENAME
    && candidate.packageBytes.type === "application/zip"
    && Number.isSafeInteger(candidate.packageByteCount)
    && (candidate.packageByteCount as number) > 0
    && candidate.packageBytes.size === candidate.packageByteCount
    && typeof candidate.packageSha256 === "string"
    && /^[a-f0-9]{64}$/u.test(candidate.packageSha256)
    && Number.isSafeInteger(candidate.itemCount)
    && (candidate.itemCount as number) >= 1
    && (candidate.itemCount as number) <= 100
    && candidate.itemCount === candidate.previewPairs.length
    && candidate.itemCount === candidate.manifest.package.pairCount
    && candidate.itemCount === candidate.manifest.pairs.length
    && candidate.manifest.schemaVersion === IMAGE_PACKAGE_SCHEMA_VERSION
    && candidate.manifest.package.format === IMAGE_PACKAGE_FORMAT
    && candidate.manifest.package.filename === IMAGE_PACKAGE_FILENAME;
}

export function imagePortalReducer(state: ImagePortalState, action: ImagePortalAction): ImagePortalState {
  switch (action.type) {
    case "operation/started":
      return action.expectedSessionGeneration === state.sessionGeneration
        && Number.isSafeInteger(action.generation)
        && action.generation > state.operationGeneration
        ? { ...state, operationGeneration: action.generation }
        : state;

    case "items/admitted": {
      if (action.expectedSessionGeneration !== state.sessionGeneration
        || action.generation !== state.operationGeneration) return state;
      const knownIds = new Set(state.items.map((item) => item.id));
      let nextItemIncarnation = state.nextItemIncarnation;
      const admitted = action.items.flatMap((candidate) => {
        if (knownIds.has(candidate.id)) return [];
        knownIds.add(candidate.id);
        return [createImagePortalItem({
          ...candidate,
          incarnation: nextItemIncarnation++,
          settings: cloneImagePromptSettings(state.defaults),
        })];
      });
      if (admitted.length === 0) return state;
      return {
        ...invalidated(state, [...state.items, ...admitted]),
        focusedItemId: state.focusedItemId ?? admitted[0].id,
        nextItemIncarnation,
      };
    }

    case "focus/changed":
      return state.items.some((item) => item.id === action.itemId) && state.focusedItemId !== action.itemId
        ? { ...state, focusedItemId: action.itemId }
        : state;

    case "bulk/selection-changed": {
      const current = state.items.find((item) => item.id === action.itemId);
      if (!current || current.bulkSelected === action.selected) return state;
      return {
        ...state,
        items: replaceItem(state.items, action.itemId, (item) => ({ ...item, bulkSelected: action.selected })),
      };
    }

    case "item/inclusion-changed": {
      const current = state.items.find((item) => item.id === action.itemId);
      if (!current || current.included === action.included) return state;
      return invalidated(state, replaceItem(state.items, action.itemId, (item) => ({
        ...item,
        included: action.included,
        reviewRevision: item.reviewRevision + 1,
      })));
    }

    case "item/removed": {
      if (!state.items.some((item) => item.id === action.itemId)) return state;
      const items = state.items.filter((item) => item.id !== action.itemId);
      const focusedItemId = state.focusedItemId === action.itemId
        ? items[0]?.id ?? null
        : state.focusedItemId;
      return { ...invalidated(state, items), focusedItemId };
    }

    case "defaults/changed": {
      if (!isImagePromptSettings(action.defaults)) return state;
      const defaults = cloneImagePromptSettings(action.defaults);
      return IMAGE_SETTING_FIELDS.every((field) => Object.is(state.defaults[field], defaults[field]))
        ? state
        : { ...state, defaults };
    }

    case "item/setting-changed": {
      const current = state.items.find((item) => item.id === action.itemId);
      if (!current
        || current.reviewRevision !== action.expectedReviewRevision
        || !isImagePromptSettingValue(action.field, action.value)
        || Object.is(settingValue(current.settings, action.field), action.value)) return state;
      return invalidated(state, replaceItem(state.items, action.itemId, (item) => ({
        ...item,
        settings: withSetting(item.settings, action.field, action.value),
        reviewRevision: item.reviewRevision + 1,
      })));
    }

    case "bulk/settings-applied": {
      if (action.expectedReviewGeneration !== state.reviewGeneration) return state;
      if (action.fields.some((field) => !IMAGE_SETTING_FIELDS.includes(field))) return state;
      const fields = [...new Set(action.fields)];
      if (fields.length === 0) return state;
      if (fields.some((field) => !Object.hasOwn(action.patch, field)
        || !isImagePromptSettingValue(field, action.patch[field]))) return state;
      let changed = false;
      const items = state.items.map((item) => {
        if (!item.bulkSelected) return item;
        let settings = item.settings;
        for (const field of fields) {
          if (!Object.hasOwn(action.patch, field)) continue;
          const value = action.patch[field] as ImagePromptSettings[ImageSettingField];
          if (Object.is(settingValue(settings, field), value)) continue;
          settings = withSetting(settings, field, value);
        }
        if (settings === item.settings) return item;
        changed = true;
        return { ...item, settings, reviewRevision: item.reviewRevision + 1 };
      });
      return changed ? invalidated(state, items) : state;
    }

    case "ocr/started": {
      const current = state.items.find((item) => item.id === action.itemId);
      if (!current
        || action.expectedSessionGeneration !== state.sessionGeneration
        || action.expectedItemIncarnation !== current.incarnation
        || action.expectedSourceHash !== current.sourceHash
        || !Number.isSafeInteger(action.generation)
        || action.generation <= current.ocr.operationGeneration) return state;
      const items = replaceItem(state.items, action.itemId, (item) => ({
        ...item,
        ocr: {
          status: "processing",
          detectedText: null,
          reviewedText: null,
          operationGeneration: action.generation,
          reviewRevision: item.ocr.reviewRevision + 1,
        },
        reviewRevision: item.reviewRevision + 1,
      }));
      return invalidated(state, items);
    }

    case "ocr/completed": {
      const current = state.items.find((item) => item.id === action.itemId);
      if (!current
        || action.expectedSessionGeneration !== state.sessionGeneration
        || action.expectedItemIncarnation !== current.incarnation
        || action.expectedSourceHash !== current.sourceHash
        || current.ocr.status !== "processing"
        || current.ocr.operationGeneration !== action.generation) return state;
      const withinLimit = isImageOcrTextWithinLimit(action.detectedText);
      return invalidated(state, replaceItem(state.items, action.itemId, (item) => ({
        ...item,
        ocr: {
          ...item.ocr,
          status: withinLimit ? "needs-review" : "failed",
          detectedText: withinLimit ? action.detectedText : null,
          reviewedText: null,
          reviewRevision: item.ocr.reviewRevision + 1,
        },
        warnings: withinLimit
          ? item.warnings
          : withWarning(item.warnings, IMAGE_OCR_TEXT_LIMIT_WARNING),
        reviewRevision: item.reviewRevision + 1,
      })));
    }

    case "ocr/failed": {
      const current = state.items.find((item) => item.id === action.itemId);
      if (!current
        || action.expectedSessionGeneration !== state.sessionGeneration
        || action.expectedItemIncarnation !== current.incarnation
        || action.expectedSourceHash !== current.sourceHash
        || current.ocr.status !== "processing"
        || current.ocr.operationGeneration !== action.generation) return state;
      return invalidated(state, replaceItem(state.items, action.itemId, (item) => ({
        ...item,
        ocr: {
          ...item.ocr,
          status: "failed",
          detectedText: null,
          reviewedText: null,
          reviewRevision: item.ocr.reviewRevision + 1,
        },
        reviewRevision: item.reviewRevision + 1,
      })));
    }

    case "ocr/reviewed": {
      const current = state.items.find((item) => item.id === action.itemId);
      if (!current
        || action.expectedSessionGeneration !== state.sessionGeneration
        || action.expectedItemIncarnation !== current.incarnation
        || action.expectedSourceHash !== current.sourceHash
        || current.reviewRevision !== action.expectedReviewRevision
        || current.ocr.operationGeneration !== action.expectedOperationGeneration
        || current.ocr.status !== "needs-review"
        || (action.status === "accepted" && action.reviewedText === null)) return state;
      if (action.reviewedText !== null && !isImageOcrTextWithinLimit(action.reviewedText)) {
        return invalidated(state, replaceItem(state.items, action.itemId, (item) => ({
          ...item,
          ocr: {
            ...item.ocr,
            status: "needs-review",
            reviewedText: null,
            reviewRevision: item.ocr.reviewRevision + 1,
          },
          warnings: withWarning(item.warnings, IMAGE_OCR_TEXT_LIMIT_WARNING),
          reviewRevision: item.reviewRevision + 1,
        })));
      }
      return invalidated(state, replaceItem(state.items, action.itemId, (item) => ({
        ...item,
        ocr: {
          ...item.ocr,
          status: action.status,
          reviewedText: action.status === "accepted" ? action.reviewedText : null,
          reviewRevision: item.ocr.reviewRevision + 1,
        },
        reviewRevision: item.reviewRevision + 1,
      })));
    }

    case "source/replaced": {
      const current = state.items.find((item) => item.id === action.itemId);
      if (!current
        || action.expectedSessionGeneration !== state.sessionGeneration
        || action.generation !== state.operationGeneration
        || action.source.id !== action.itemId
        || current.sourceHash !== action.expectedSourceHash) return state;
      const replacement = createImagePortalItem({
        ...action.source,
        incarnation: state.nextItemIncarnation,
        settings: cloneImagePromptSettings(current.settings),
      });
      const item: ImagePortalItem = {
        ...replacement,
        included: current.included,
        bulkSelected: current.bulkSelected,
        ocr: {
          ...replacement.ocr,
          operationGeneration: current.ocr.operationGeneration,
        },
        reviewRevision: current.reviewRevision + 1,
      };
      return {
        ...invalidated(state, replaceItem(state.items, action.itemId, () => item)),
        nextItemIncarnation: state.nextItemIncarnation + 1,
      };
    }

    case "review/confirmed":
      return action.expectedReviewGeneration === state.reviewGeneration && canConfirm(state.items)
        ? { ...state, confirmedReviewGeneration: state.reviewGeneration }
        : state;

    case "build/started":
      return action.expectedReviewGeneration === state.reviewGeneration
        && state.confirmedReviewGeneration === state.reviewGeneration
        && Number.isSafeInteger(action.generation)
        && action.generation > state.buildGeneration
        ? {
            ...state,
            buildGeneration: action.generation,
            buildStatus: "building",
            builtOutput: null,
            safeBuildMessage: "",
          }
        : state;

    case "build/completed":
      return state.buildStatus === "building"
        && action.generation === state.buildGeneration
        && action.expectedReviewGeneration === state.reviewGeneration
        && state.confirmedReviewGeneration === state.reviewGeneration
        && isCurrentBuiltOutput(state, action.generation, action.expectedReviewGeneration, action.output)
        ? { ...state, buildStatus: "ready", builtOutput: action.output, safeBuildMessage: "" }
        : state;

    case "build/failed":
      return state.buildStatus === "building"
        && action.generation === state.buildGeneration
        && action.expectedReviewGeneration === state.reviewGeneration
        && state.confirmedReviewGeneration === state.reviewGeneration
        ? { ...state, buildStatus: "error", builtOutput: null, safeBuildMessage: action.message }
        : state;

    case "tutorial/seen":
      return state.tutorialSeenVersion === action.version
        ? state
        : { ...state, tutorialSeenVersion: action.version };

    case "session/reset":
      return {
        ...state,
        items: [],
        focusedItemId: null,
        sessionGeneration: state.sessionGeneration + 1,
        operationGeneration: state.operationGeneration + 1,
        reviewGeneration: state.reviewGeneration + 1,
        buildGeneration: state.buildGeneration + 1,
        confirmedReviewGeneration: null,
        buildStatus: "idle",
        builtOutput: null,
        safeBuildMessage: "",
      };
  }
}
