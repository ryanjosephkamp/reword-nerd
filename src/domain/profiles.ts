export type ModelFamily = "openai" | "anthropic" | "google" | "xai" | "local" | "custom";

export interface ModelProfile {
  id: string;
  family: ModelFamily;
  label: string;
  contextWindowTokens: number | null;
  lastReviewed: string;
  workflowNote: string;
}

export class ProfileValidationError extends Error {
  readonly name = "ProfileValidationError";
}

const REVIEW_DATE = "2026-08-11";
const WORKFLOW_NOTE =
  "Start a new conversation for each document, run the four prompts in order, and replace response markers with the previous stage outputs. Context limits vary by model and account; check them with the user before running the workflow.";

function profile(
  id: string,
  family: ModelFamily,
  label: string,
  contextWindowTokens: number | null,
): Readonly<ModelProfile> {
  return Object.freeze({
    id,
    family,
    label,
    contextWindowTokens,
    lastReviewed: REVIEW_DATE,
    workflowNote: WORKFLOW_NOTE,
  });
}

export const CURATED_MODEL_PROFILES: readonly Readonly<ModelProfile>[] = Object.freeze([
  profile("openai-general", "openai", "OpenAI / ChatGPT", 128_000),
  profile("anthropic-general", "anthropic", "Anthropic / Claude", 200_000),
  profile("google-general", "google", "Google / Gemini", 1_000_000),
  profile("xai-general", "xai", "xAI / Grok", 1_000_000),
  profile("local-general", "local", "Local model", null),
  profile("custom", "custom", "Custom model", null),
]);

function validContextLimit(contextWindowTokens: number | null): boolean {
  return (
    contextWindowTokens === null ||
    (typeof contextWindowTokens === "number" &&
      Number.isFinite(contextWindowTokens) &&
      Number.isInteger(contextWindowTokens) &&
      contextWindowTokens > 0)
  );
}

export function createCustomProfile(label: string, contextWindowTokens: number | null): ModelProfile {
  if (typeof label !== "string" || !label.trim()) {
    throw new ProfileValidationError("Enter a model label.");
  }
  if (!validContextLimit(contextWindowTokens)) {
    throw new ProfileValidationError("Context limit must be a positive whole number or unknown.");
  }

  return {
    id: "custom",
    family: "custom",
    label: label.trim(),
    contextWindowTokens,
    lastReviewed: REVIEW_DATE,
    workflowNote: WORKFLOW_NOTE,
  };
}
