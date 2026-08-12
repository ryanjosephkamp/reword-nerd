import {
  CURATED_MODEL_PROFILES,
  MAX_CUSTOM_REQUIREMENTS_LENGTH,
  type ExtractionOptions,
  type Formality,
  type LengthPreference,
  type RewriteSettings,
  type Tone,
} from "../../domain";
import type { WorkbenchState } from "./contracts";

export const PREFERENCES_STORAGE_KEY = "reword-nerd:preferences:v1";
export const CURRENT_TUTORIAL_VERSION = "0.5";
export const MAX_CUSTOM_PROFILE_LABEL_LENGTH = 200;
export const MAX_OUTPUT_LANGUAGE_LENGTH = 200;
const PREFERENCES_SCHEMA_VERSION = 1 as const;

type PersistedProcessing = Omit<ExtractionOptions, "ocrLanguage">;

export interface SavedPreferencesPatch {
  selectedProfileId?: string;
  customProfileLabel?: string;
  contextWindowTokens?: number | null;
  globalSettings?: Partial<RewriteSettings>;
  processing?: Partial<PersistedProcessing>;
  tutorialVersion?: string | null;
}

export type PreferenceSnapshot = SavedPreferencesPatch;

interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function supported<T extends string>(value: unknown, values: readonly T[]): T | undefined {
  return typeof value === "string" && values.includes(value as T) ? value as T : undefined;
}

function canonicalText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const canonical = value.trim();
  return canonical && Array.from(canonical).length <= maximum ? canonical : undefined;
}

function boundedText(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && Array.from(value).length <= maximum ? value : undefined;
}

function contextLimit(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0
    ? value
    : undefined;
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function canonicalPageSelection(value: unknown): ExtractionOptions["pageSelection"] | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "all") return trimmed;
  if (!trimmed || trimmed.length > 120) return undefined;
  const canonical: string[] = [];
  for (const token of trimmed.split(",")) {
    const range = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/u.exec(token);
    if (!range) return undefined;
    const first = Number(range[1]);
    const last = Number(range[2] ?? range[1]);
    if (!Number.isSafeInteger(first)
      || !Number.isSafeInteger(last)
      || first < 1
      || last < first) return undefined;
    canonical.push(first === last ? String(first) : `${first}-${last}`);
  }
  return canonical.join(",");
}

export function parseContextLimitDraft(value: string): number | null | undefined {
  if (value === "") return null;
  if (!/^\d+$/u.test(value)) return undefined;
  return contextLimit(Number(value));
}

export function truncateUnicode(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join("");
}

function decodeSettings(value: unknown): Partial<RewriteSettings> | undefined {
  const data = record(value);
  if (!data) return undefined;
  const decoded: Partial<RewriteSettings> = {};
  const tone = supported<Tone>(data.tone, ["preserve", "academic", "professional", "technical", "plain"]);
  const formality = supported<Formality>(data.formality, ["preserve", "standard", "formal"]);
  const length = supported<LengthPreference>(data.length, ["preserve", "concise", "expanded"]);
  const outputLanguage = canonicalText(data.outputLanguage, MAX_OUTPUT_LANGUAGE_LENGTH);
  const customRequirements = boundedText(data.customRequirements, MAX_CUSTOM_REQUIREMENTS_LENGTH);
  if (tone !== undefined) decoded.tone = tone;
  if (formality !== undefined) decoded.formality = formality;
  if (length !== undefined) decoded.length = length;
  if (outputLanguage !== undefined) decoded.outputLanguage = outputLanguage;
  if (customRequirements !== undefined) decoded.customRequirements = customRequirements;
  return decoded;
}

function decodeProcessing(value: unknown): Partial<PersistedProcessing> | undefined {
  const data = record(value);
  if (!data) return undefined;
  const decoded: Partial<PersistedProcessing> = {};
  const extractEmbeddedImages = boolean(data.extractEmbeddedImages);
  const capturePageVisuals = boolean(data.capturePageVisuals);
  const pages = canonicalPageSelection(data.pageSelection);
  const quality = supported<ExtractionOptions["pageCaptureQuality"]>(data.pageCaptureQuality, ["standard", "high"]);
  const ocrMode = supported<ExtractionOptions["ocrMode"]>(data.ocrMode, ["off", "textless-pages", "all-pages"]);
  const ocrExtractedAssets = boolean(data.ocrExtractedAssets);
  const excludeDecorativeImages = boolean(data.excludeDecorativeImages);
  if (extractEmbeddedImages !== undefined) decoded.extractEmbeddedImages = extractEmbeddedImages;
  if (capturePageVisuals !== undefined) decoded.capturePageVisuals = capturePageVisuals;
  if (pages !== undefined) decoded.pageSelection = pages;
  if (quality !== undefined) decoded.pageCaptureQuality = quality;
  if (ocrMode !== undefined) decoded.ocrMode = ocrMode;
  if (ocrExtractedAssets !== undefined) decoded.ocrExtractedAssets = ocrExtractedAssets;
  if (excludeDecorativeImages !== undefined) decoded.excludeDecorativeImages = excludeDecorativeImages;
  return decoded;
}

function validatedPreferences(data: Record<string, unknown>): SavedPreferencesPatch {
  const decoded: SavedPreferencesPatch = {};
  const selectedProfileId = typeof data.selectedProfileId === "string"
    && CURATED_MODEL_PROFILES.some((profile) => profile.id === data.selectedProfileId)
    ? data.selectedProfileId
    : undefined;
  const customProfileLabel = canonicalText(data.customProfileLabel, MAX_CUSTOM_PROFILE_LABEL_LENGTH);
  const currentContextLimit = contextLimit(data.contextWindowTokens);
  const globalSettings = decodeSettings(data.globalSettings);
  const processing = decodeProcessing(data.processing);
  const tutorialVersion = data.tutorialVersion === null
    ? null
    : canonicalText(data.tutorialVersion, 32);
  if (selectedProfileId !== undefined) decoded.selectedProfileId = selectedProfileId;
  if (customProfileLabel !== undefined) decoded.customProfileLabel = customProfileLabel;
  if (currentContextLimit !== undefined) decoded.contextWindowTokens = currentContextLimit;
  if (globalSettings !== undefined) decoded.globalSettings = globalSettings;
  if (processing !== undefined) decoded.processing = processing;
  if (tutorialVersion !== undefined) decoded.tutorialVersion = tutorialVersion;
  return decoded;
}

export function decodeSavedPreferences(serialized: string | null): SavedPreferencesPatch | null {
  if (serialized === null) return null;
  try {
    const envelope = record(JSON.parse(serialized));
    const data = record(envelope?.data);
    if (envelope?.version !== PREFERENCES_SCHEMA_VERSION || !data) return null;
    return validatedPreferences(data);
  } catch {
    return null;
  }
}

type PreferenceState = Pick<WorkbenchState,
  | "selectedProfileId"
  | "customProfileLabel"
  | "workingProfile"
  | "globalSettings"
  | "globalExtractionOptions"
  | "tutorialSeenVersion"
>;

export function snapshotPreferences(state: PreferenceState): PreferenceSnapshot {
  const options = state.globalExtractionOptions;
  return validatedPreferences({
    selectedProfileId: state.selectedProfileId,
    customProfileLabel: state.customProfileLabel,
    contextWindowTokens: state.workingProfile.contextWindowTokens,
    globalSettings: { ...state.globalSettings },
    processing: {
      extractEmbeddedImages: options.extractEmbeddedImages,
      capturePageVisuals: options.capturePageVisuals,
      pageSelection: options.pageSelection,
      pageCaptureQuality: options.pageCaptureQuality,
      ocrMode: options.ocrMode,
      ocrExtractedAssets: options.ocrExtractedAssets,
      excludeDecorativeImages: options.excludeDecorativeImages,
    },
    tutorialVersion: state.tutorialSeenVersion,
  });
}

export function encodeSavedPreferences(snapshot: PreferenceSnapshot): string {
  return JSON.stringify({
    version: PREFERENCES_SCHEMA_VERSION,
    data: validatedPreferences(snapshot as unknown as Record<string, unknown>),
  });
}

function browserStorage(): PreferenceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function resolvedStorage(storage?: PreferenceStorage | null): PreferenceStorage | null {
  return storage === undefined ? browserStorage() : storage;
}

export function loadSavedPreferences(storage?: PreferenceStorage | null): SavedPreferencesPatch | null {
  try {
    return decodeSavedPreferences(resolvedStorage(storage)?.getItem(PREFERENCES_STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

export function savePreferences(snapshot: PreferenceSnapshot, storage?: PreferenceStorage | null): void {
  try {
    resolvedStorage(storage)?.setItem(PREFERENCES_STORAGE_KEY, encodeSavedPreferences(snapshot));
  } catch {
    // Storage is optional; current in-memory interactions remain authoritative.
  }
}

export function clearSavedPreferences(storage?: PreferenceStorage | null): void {
  try {
    resolvedStorage(storage)?.removeItem(PREFERENCES_STORAGE_KEY);
  } catch {
    // Storage is optional; Reset still updates current in-memory preferences.
  }
}
