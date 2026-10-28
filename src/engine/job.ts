// What the user wants done to their text: the rewrite settings shared by every hand-off.

export type Goal = "clear" | "polish" | "academic" | "custom";
export type Tone = "original" | "plain" | "professional" | "academic" | "technical" | "friendly";
export type Formality = "original" | "natural" | "formal";
export type Length = "original" | "shorter" | "longer";

/** Which parts of code and structured files the model may change. Code itself never changes. */
export interface CodeScope {
  docsAndMarkup: boolean;
  comments: boolean;
  userFacingStrings: boolean;
  dataValues: boolean;
}

export interface RewriteJob {
  goal: Goal;
  tone: Tone;
  formality: Formality;
  length: Length;
  /** Empty means "same language as the source". */
  outputLanguage: string;
  notes: string;
  codeScope: CodeScope;
}

export const MAX_NOTES_LENGTH = 2_000;

export const DEFAULT_CODE_SCOPE: Readonly<CodeScope> = Object.freeze({
  docsAndMarkup: true,
  comments: true,
  userFacingStrings: true,
  dataValues: false,
});

export const GOALS: Readonly<
  Record<Goal, { label: string; summary: string; tone: Tone; formality: Formality }>
> = Object.freeze({
  clear: {
    label: "Make it clear",
    summary: "Plain language, same substance.",
    tone: "plain",
    formality: "natural",
  },
  polish: {
    label: "Polish it",
    summary: "Considered, confident, and professional.",
    tone: "professional",
    formality: "natural",
  },
  academic: {
    label: "Make it academic",
    summary: "Precise language for scholarly readers.",
    tone: "academic",
    formality: "formal",
  },
  custom: {
    label: "Custom",
    summary: "Set every option yourself.",
    tone: "original",
    formality: "original",
  },
});

export const DEFAULT_JOB: Readonly<RewriteJob> = Object.freeze({
  goal: "clear",
  tone: GOALS.clear.tone,
  formality: GOALS.clear.formality,
  length: "original",
  outputLanguage: "",
  notes: "",
  codeScope: DEFAULT_CODE_SCOPE,
});

export const TONE_LABELS: Readonly<Record<Tone, string>> = Object.freeze({
  original: "Keep the original tone",
  plain: "Plain",
  professional: "Professional",
  academic: "Academic",
  technical: "Technical",
  friendly: "Friendly",
});

export const FORMALITY_LABELS: Readonly<Record<Formality, string>> = Object.freeze({
  original: "Keep the original formality",
  natural: "Natural",
  formal: "Formal",
});

export const LENGTH_LABELS: Readonly<Record<Length, string>> = Object.freeze({
  original: "About the same length",
  shorter: "Shorter",
  longer: "Longer",
});

/** Applies a goal's tone and formality; length, language, and notes stay as they were. */
export function withGoal(job: RewriteJob, goal: Goal): RewriteJob {
  if (goal === "custom") return { ...job, goal };
  return { ...job, goal, tone: GOALS[goal].tone, formality: GOALS[goal].formality };
}

/** The settings block every prompt and task file shares. */
export function describeJob(job: RewriteJob): string {
  const lines = [
    `- Tone: ${TONE_LABELS[job.tone]}`,
    `- Formality: ${FORMALITY_LABELS[job.formality]}`,
    `- Length: ${LENGTH_LABELS[job.length]}`,
    `- Output language: ${job.outputLanguage.trim() || "The same language as the source"}`,
    `- Notes from the user: ${job.notes.trim() || "None."}`,
  ];
  if (job.goal !== "custom")
    lines.unshift(`- Goal: ${GOALS[job.goal].label}. ${GOALS[job.goal].summary}`);
  return lines.join("\n");
}

export function describeCodeScope(scope: CodeScope): string {
  const yes = (allowed: boolean) => (allowed ? "may change" : "keep exactly as written");
  return [
    `- Documentation and markup prose: ${yes(scope.docsAndMarkup)}`,
    `- Code comments and docstrings: ${yes(scope.comments)}`,
    `- User-facing strings: ${yes(scope.userFacingStrings)}`,
    `- Prose values inside structured data: ${yes(scope.dataValues)}`,
    "- Code, identifiers, keys, paths, numbers, placeholders, and syntax: never change",
  ].join("\n");
}
