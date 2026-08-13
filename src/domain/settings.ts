export type Tone = "preserve" | "academic" | "professional" | "technical" | "plain";
export type Formality = "preserve" | "standard" | "formal";
export type LengthPreference = "preserve" | "concise" | "expanded";

export interface RewriteSettings {
  tone: Tone;
  formality: Formality;
  length: LengthPreference;
  outputLanguage: string;
  customRequirements: string;
}

export interface CodeRewriteOptions {
  documentationAndMarkup: boolean;
  commentsAndDocstrings: boolean;
  userFacingStrings: boolean;
  narrativeStructuredDataValues: boolean;
  honorRootGitignore: boolean;
  excludeDependenciesBuildGenerated: boolean;
  preserveSafeNonTextAssets: boolean;
  readonly protectedExecutableSyntax: true;
}

export type CodeRewriteOptionsInput = Partial<Omit<CodeRewriteOptions, "protectedExecutableSyntax">> & {
  protectedExecutableSyntax?: unknown;
};

export type SettingsOverride = Partial<RewriteSettings>;

export const MAX_CUSTOM_REQUIREMENTS_LENGTH = 2_000;

export const DEFAULT_SETTINGS: Readonly<RewriteSettings> = Object.freeze({
  tone: "preserve",
  formality: "preserve",
  length: "preserve",
  outputLanguage: "Preserve source language",
  customRequirements: "",
});

export const DEFAULT_CODE_REWRITE_OPTIONS: Readonly<CodeRewriteOptions> = Object.freeze({
  documentationAndMarkup: true,
  commentsAndDocstrings: true,
  userFacingStrings: true,
  narrativeStructuredDataValues: false,
  honorRootGitignore: true,
  excludeDependenciesBuildGenerated: true,
  preserveSafeNonTextAssets: true,
  protectedExecutableSyntax: true,
});

export class SettingsValidationError extends Error {
  readonly name = "SettingsValidationError";
}

const tones = new Set<Tone>(["preserve", "academic", "professional", "technical", "plain"]);
const formalities = new Set<Formality>(["preserve", "standard", "formal"]);
const lengths = new Set<LengthPreference>(["preserve", "concise", "expanded"]);

function settingError(message: string): never {
  throw new SettingsValidationError(message);
}

function normalizedText(value: unknown, field: string): string {
  if (typeof value !== "string") {
    return settingError(`${field} must be text.`);
  }

  return value.trim();
}

function validateTone(value: unknown): Tone {
  if (typeof value !== "string" || !tones.has(value as Tone)) {
    return settingError("Choose a supported tone.");
  }

  return value as Tone;
}

function validateFormality(value: unknown): Formality {
  if (typeof value !== "string" || !formalities.has(value as Formality)) {
    return settingError("Choose a supported formality.");
  }

  return value as Formality;
}

function validateLength(value: unknown): LengthPreference {
  if (typeof value !== "string" || !lengths.has(value as LengthPreference)) {
    return settingError("Choose a supported length preference.");
  }

  return value as LengthPreference;
}

function validateRequirements(value: unknown): string {
  const requirements = normalizedText(value, "Custom requirements");
  if (Array.from(requirements).length > MAX_CUSTOM_REQUIREMENTS_LENGTH) {
    return settingError(`Custom requirements must be ${MAX_CUSTOM_REQUIREMENTS_LENGTH} Unicode characters or fewer.`);
  }

  return requirements;
}

export function resolveCodeRewriteOptions(input: CodeRewriteOptionsInput = {}): CodeRewriteOptions {
  const result = { ...DEFAULT_CODE_REWRITE_OPTIONS };
  for (const key of [
    "documentationAndMarkup",
    "commentsAndDocstrings",
    "userFacingStrings",
    "narrativeStructuredDataValues",
    "honorRootGitignore",
    "excludeDependenciesBuildGenerated",
    "preserveSafeNonTextAssets",
  ] as const) {
    const value = input[key];
    if (value !== undefined) {
      if (typeof value !== "boolean") settingError(`${key} must be on or off.`);
      result[key] = value;
    }
  }
  return result;
}

export function resolveSettings(
  globalSettings: RewriteSettings,
  override: SettingsOverride = {},
): RewriteSettings {
  const merged = { ...globalSettings, ...override };
  const outputLanguage = normalizedText(merged.outputLanguage, "Output language");
  if (!outputLanguage) {
    return settingError("Choose an output language.");
  }

  return {
    tone: validateTone(merged.tone),
    formality: validateFormality(merged.formality),
    length: validateLength(merged.length),
    outputLanguage,
    customRequirements: validateRequirements(merged.customRequirements),
  };
}

export function toneLabel(tone: Tone): string {
  return tone === "preserve" ? "Preserve the source tone" : tone[0].toUpperCase() + tone.slice(1);
}

export function formalityLabel(formality: Formality): string {
  return formality === "preserve"
    ? "Preserve the source formality"
    : formality[0].toUpperCase() + formality.slice(1);
}

export function lengthLabel(length: LengthPreference): string {
  return length === "preserve" ? "Preserve the source length" : length[0].toUpperCase() + length.slice(1);
}
