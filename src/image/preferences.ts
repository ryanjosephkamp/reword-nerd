import {
  type ImageAspectRatio,
  type ImageBackgroundBehavior,
  type ImageModelFamilyId,
  type ImagePromptSettings,
  type ImageSizeIntent,
  MAX_IMAGE_PROMPT_TEXT_LENGTH,
} from "./contracts";
import { IMAGE_PROMPT_PROFILES } from "./profiles";

export const IMAGE_PREFERENCES_STORAGE_KEY = "reword-nerd:image-preferences:v1";
export const CURRENT_IMAGE_TUTORIAL_VERSION = "0.8";
export const MAX_IMAGE_PREFERENCE_TEXT_LENGTH = MAX_IMAGE_PROMPT_TEXT_LENGTH;
export const MAX_IMAGE_PREFERENCES_SERIALIZED_BYTES = 20_000;
const IMAGE_PREFERENCES_SCHEMA_VERSION = 1 as const;

export interface SavedImagePreferences {
  readonly defaults?: Partial<ImagePromptSettings>;
  readonly tutorialVersion?: string | null;
}

export type ImagePreferenceSnapshot = SavedImagePreferences;
type MutableImagePromptSettings = { -readonly [Field in keyof ImagePromptSettings]: ImagePromptSettings[Field] };

interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? value as Record<string, unknown>
    : null;
}

function own(data: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(data, key) ? data[key] : undefined;
}

function supported<T extends string>(value: unknown, choices: readonly T[]): T | undefined {
  return typeof value === "string" && choices.includes(value as T) ? value as T : undefined;
}

function boundedText(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && Array.from(value).length <= maximum ? value : undefined;
}

function decodeDefaults(value: unknown): Partial<ImagePromptSettings> | undefined {
  const data = record(value);
  if (!data) return undefined;
  const decoded: Partial<MutableImagePromptSettings> = {};
  const modelFamily = supported<ImageModelFamilyId>(
    own(data, "modelFamily"),
    IMAGE_PROMPT_PROFILES.map((profile) => profile.id),
  );
  const aspectRatio = supported<ImageAspectRatio>(own(data, "aspectRatio"), [
    "match-source",
    "provider-default",
    "1:1",
    "4:3",
    "3:4",
    "16:9",
    "9:16",
  ]);
  const sizeIntent = supported<ImageSizeIntent>(own(data, "sizeIntent"), [
    "match-source-where-supported",
    "highest-practical-quality",
  ]);
  const backgroundBehavior = supported<ImageBackgroundBehavior>(own(data, "backgroundBehavior"), [
    "preserve-source",
    "provider-default",
  ]);
  const requestedChanges = boundedText(own(data, "requestedChanges"), MAX_IMAGE_PREFERENCE_TEXT_LENGTH);
  const mustPreserve = boundedText(own(data, "mustPreserve"), MAX_IMAGE_PREFERENCE_TEXT_LENGTH);
  if (modelFamily !== undefined) decoded.modelFamily = modelFamily;
  if (aspectRatio !== undefined) decoded.aspectRatio = aspectRatio;
  if (sizeIntent !== undefined) decoded.sizeIntent = sizeIntent;
  const preserveVisibleText = own(data, "preserveVisibleText");
  if (typeof preserveVisibleText === "boolean") decoded.preserveVisibleText = preserveVisibleText;
  if (backgroundBehavior !== undefined) decoded.backgroundBehavior = backgroundBehavior;
  if (requestedChanges !== undefined) decoded.requestedChanges = requestedChanges;
  if (mustPreserve !== undefined) decoded.mustPreserve = mustPreserve;
  return decoded;
}

function validatedPreferences(value: unknown): SavedImagePreferences {
  const data = record(value) ?? {};
  const decoded: { defaults?: Partial<ImagePromptSettings>; tutorialVersion?: string | null } = {};
  const defaults = decodeDefaults(own(data, "defaults"));
  const rawTutorialVersion = own(data, "tutorialVersion");
  const tutorialVersion = rawTutorialVersion === null
    ? null
    : boundedText(rawTutorialVersion, 32);
  if (defaults !== undefined) decoded.defaults = defaults;
  if (tutorialVersion !== undefined) decoded.tutorialVersion = tutorialVersion;
  return decoded;
}

export function decodeImagePreferences(serialized: string | null): SavedImagePreferences | null {
  if (serialized === null) return null;
  if (new TextEncoder().encode(serialized).byteLength > MAX_IMAGE_PREFERENCES_SERIALIZED_BYTES) return null;
  try {
    const envelope = record(JSON.parse(serialized));
    if (!envelope
      || own(envelope, "version") !== IMAGE_PREFERENCES_SCHEMA_VERSION
      || !record(own(envelope, "data"))) return null;
    return validatedPreferences(own(envelope, "data"));
  } catch {
    return null;
  }
}

export function snapshotImagePreferences(
  defaults: Readonly<ImagePromptSettings>,
  tutorialVersion: string | null,
): ImagePreferenceSnapshot {
  return validatedPreferences({ defaults: { ...defaults }, tutorialVersion });
}

export function encodeImagePreferences(snapshot: ImagePreferenceSnapshot): string {
  return JSON.stringify({
    version: IMAGE_PREFERENCES_SCHEMA_VERSION,
    data: validatedPreferences(snapshot),
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

export function loadImagePreferences(storage?: PreferenceStorage | null): SavedImagePreferences | null {
  try {
    return decodeImagePreferences(resolvedStorage(storage)?.getItem(IMAGE_PREFERENCES_STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

export function saveImagePreferences(
  snapshot: ImagePreferenceSnapshot,
  storage?: PreferenceStorage | null,
): void {
  try {
    resolvedStorage(storage)?.setItem(IMAGE_PREFERENCES_STORAGE_KEY, encodeImagePreferences(snapshot));
  } catch {
    // Storage is optional; current in-memory Image interactions remain authoritative.
  }
}

export function clearImagePreferences(storage?: PreferenceStorage | null): void {
  try {
    resolvedStorage(storage)?.removeItem(IMAGE_PREFERENCES_STORAGE_KEY);
  } catch {
    // Storage is optional; reset still updates current in-memory Image preferences.
  }
}
