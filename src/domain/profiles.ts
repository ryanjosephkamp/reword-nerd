export type ModelFamily =
  | "alibaba"
  | "anthropic"
  | "custom"
  | "deepseek"
  | "google"
  | "meta"
  | "minimax"
  | "mistral"
  | "moonshot"
  | "openai"
  | "xai"
  | "zai";

export type PromptStage = "decompose" | "rewrite" | "verify" | "final";
export type PromptLayout = "task-first" | "source-first-task-last";
export type PromptDelimiterStyle = "markdown" | "xml";

export interface ModelPromptStrategy {
  id: string;
  version: string;
  referenceModel: string;
  reviewedAt: string;
  guidanceDocument: string;
  layout: PromptLayout;
  delimiterStyle: PromptDelimiterStyle;
  sharedGuidance: string;
  stageGuidance: Readonly<Record<PromptStage, string>>;
}

export interface ModelProfile {
  id: string;
  family: ModelFamily;
  label: string;
  contextWindowTokens: number | null;
  lastReviewed: string;
  workflowNote: string;
  promptStrategy: Readonly<ModelPromptStrategy>;
}

export class ProfileValidationError extends Error {
  readonly name = "ProfileValidationError";
}

const REVIEW_DATE = "2026-08-11";
const STRATEGY_VERSION = "2026-08-11-v1";
const WORKFLOW_NOTE =
  "Start a new conversation for each document, run the four prompts in order, and replace response markers with the previous stage outputs. Context limits vary by model and account; check them with the user before running the workflow.";

const STAGE_GUIDANCE: Readonly<Record<PromptStage, string>> = Object.freeze({
  decompose: "Capture every material claim, fact, relationship, constraint, protected term, and ambiguity before rewriting.",
  rewrite: "Return a complete rewrite that follows the decomposition while changing surface structure and phrasing substantially.",
  verify: "Compare the rewrite against the decomposition and source, and report concrete omissions, additions, or meaning changes.",
  final: "Repair only verified issues, preserve supported meaning, and return the polished document without process commentary.",
});

function strategy(
  id: string,
  referenceModel: string,
  guidanceDocument: string,
  layout: PromptLayout,
  delimiterStyle: PromptDelimiterStyle,
  sharedGuidance: string,
): Readonly<ModelPromptStrategy> {
  return Object.freeze({
    id,
    version: STRATEGY_VERSION,
    referenceModel,
    reviewedAt: REVIEW_DATE,
    guidanceDocument,
    layout,
    delimiterStyle,
    sharedGuidance,
    stageGuidance: STAGE_GUIDANCE,
  });
}

const STRATEGIES = {
  alibaba: strategy(
    "alibaba-qwen-v1",
    "Qwen3.7 Max",
    "docs/model-guidance/alibaba-qwen.md",
    "task-first",
    "markdown",
    "Use a clear task, named sections, explicit constraints, and a concrete output contract. Keep instructions direct and internally consistent.",
  ),
  anthropic: strategy(
    "anthropic-claude-v1",
    "Claude Opus 5",
    "docs/model-guidance/anthropic-claude.md",
    "source-first-task-last",
    "xml",
    "Use descriptive XML tags to separate inputs. For long documents, place source material before the task. State the required deliverable and length explicitly, without redundant self-verification instructions.",
  ),
  custom: strategy(
    "custom-neutral-v1",
    "User supplied",
    "docs/model-guidance/custom-model.md",
    "task-first",
    "markdown",
    "Use a conservative provider-neutral prompt structure with explicit stages, named inputs, constraints, and output requirements.",
  ),
  deepseek: strategy(
    "deepseek-v4-pro-v1",
    "DeepSeek V4 Pro",
    "docs/model-guidance/deepseek-v4-pro.md",
    "task-first",
    "markdown",
    "Define the role, current stage, source boundaries, constraints, and required output explicitly. Keep the staged workflow unambiguous.",
  ),
  google: strategy(
    "google-gemini-v1",
    "Gemini 3.1 Pro Preview",
    "docs/model-guidance/google-gemini.md",
    "source-first-task-last",
    "xml",
    "Use consistent structured sections, define ambiguous terms and output verbosity, and place the specific task after long source context.",
  ),
  meta: strategy(
    "meta-muse-v1",
    "Muse Spark 1.1",
    "docs/model-guidance/meta-muse.md",
    "task-first",
    "markdown",
    "State the scope, constraints, and complete deliverable concisely. Keep the model focused on the current stage and supplied evidence.",
  ),
  minimax: strategy(
    "minimax-m3-v1",
    "MiniMax M3",
    "docs/model-guidance/minimax-m3.md",
    "source-first-task-last",
    "markdown",
    "Use flat named sections, explicit role, format, length, and grounding rules. For long inputs, place the task after indexed source material.",
  ),
  mistral: strategy(
    "mistral-large-3-v1",
    "Mistral Large 3",
    "docs/model-guidance/mistral-large-3.md",
    "task-first",
    "markdown",
    "Start with a precise purpose, organize instructions hierarchically, use measurable requirements, and avoid subjective or contradictory wording.",
  ),
  moonshot: strategy(
    "moonshot-kimi-v1",
    "Kimi K3",
    "docs/model-guidance/moonshot-kimi.md",
    "task-first",
    "markdown",
    "Give clear instructions, delimit reference text, define the steps and output length, and ground each stage in the supplied document artifacts.",
  ),
  openai: strategy(
    "openai-chatgpt-v1",
    "GPT-5.6 Sol",
    "docs/model-guidance/openai-chatgpt.md",
    "task-first",
    "markdown",
    "Keep the prompt lean and state each instruction once. Specify the outcome, relevant context, constraints, evidence boundary, and output format.",
  ),
  xai: strategy(
    "xai-grok-v1",
    "Grok 4.5",
    "docs/model-guidance/xai-grok.md",
    "task-first",
    "markdown",
    "Use a minimal direct task with explicit source boundaries and result format. Use stronger reasoning settings for the verification stage when the interface offers them.",
  ),
  zai: strategy(
    "zai-glm-v1",
    "GLM-5.1",
    "docs/model-guidance/zai-glm.md",
    "task-first",
    "markdown",
    "Use clear instructions and constraints, and enable deeper thinking for complex semantic comparison when the interface offers it.",
  ),
} as const;

function profile(
  id: string,
  family: ModelFamily,
  label: string,
  contextWindowTokens: number | null,
  promptStrategy: Readonly<ModelPromptStrategy>,
): Readonly<ModelProfile> {
  return Object.freeze({
    id,
    family,
    label,
    contextWindowTokens,
    lastReviewed: REVIEW_DATE,
    workflowNote: WORKFLOW_NOTE,
    promptStrategy,
  });
}

export const DEFAULT_MODEL_PROFILE_ID = "openai-general";

export const CURATED_MODEL_PROFILES: readonly Readonly<ModelProfile>[] = Object.freeze([
  profile("alibaba-qwen", "alibaba", "Alibaba / Qwen", 1_000_000, STRATEGIES.alibaba),
  profile("anthropic-general", "anthropic", "Anthropic / Claude", 1_000_000, STRATEGIES.anthropic),
  profile("custom", "custom", "Custom model", null, STRATEGIES.custom),
  profile("deepseek-general", "deepseek", "DeepSeek / V4 Pro", 1_000_000, STRATEGIES.deepseek),
  profile("google-general", "google", "Google / Gemini", 1_048_576, STRATEGIES.google),
  profile("meta-muse", "meta", "Meta / Muse", 1_000_000, STRATEGIES.meta),
  profile("minimax-general", "minimax", "MiniMax / M3", 1_000_000, STRATEGIES.minimax),
  profile("mistral-general", "mistral", "Mistral / Large 3", 256_000, STRATEGIES.mistral),
  profile("moonshot-kimi", "moonshot", "MoonshotAI / Kimi", 1_000_000, STRATEGIES.moonshot),
  profile("openai-general", "openai", "OpenAI / ChatGPT", 1_050_000, STRATEGIES.openai),
  profile("xai-general", "xai", "xAI / Grok", 500_000, STRATEGIES.xai),
  profile("zai-glm", "zai", "Z.AI / GLM", 200_000, STRATEGIES.zai),
]);

function validContextLimit(contextWindowTokens: number | null): boolean {
  return (
    contextWindowTokens === null
    || (typeof contextWindowTokens === "number"
      && Number.isFinite(contextWindowTokens)
      && Number.isInteger(contextWindowTokens)
      && contextWindowTokens > 0)
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
    promptStrategy: STRATEGIES.custom,
  };
}
