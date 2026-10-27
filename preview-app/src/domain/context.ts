export interface ContextAssessment {
  estimateLabel: "Estimated tokens";
  sourceTokens: number;
  oneShotWorkflowTokens: number;
  manualWorkflowTokens: number;
  oneShotRatio: number | null;
  manualRatio: number | null;
  oneShotOversized: boolean;
  manualOversized: boolean;
  oneShotWarning: boolean;
  /** @deprecated Compatibility alias for manualWorkflowTokens. */
  workflowTokens: number;
  contextWindowTokens: number | null;
  /** @deprecated Compatibility alias for manualRatio. */
  ratio: number | null;
  /** @deprecated Compatibility alias for manualOversized. */
  oversized: boolean;
  acknowledgmentRequired: boolean;
  includedFileCount?: number;
  amberRisk?: boolean;
  amberRiskReasons?: ("included-file-count" | "one-shot-ratio")[];
  inspectDiffsAndRunTestsWarning?: "Inspect the generated diffs and run your normal tests/build after applying changes.";
}

export const PROJECT_FILE_FRAMING_TOKENS = 24;
export const CONTEXT_DIFF_TEST_WARNING = "Inspect the generated diffs and run your normal tests/build after applying changes." as const;

export interface ContextSourceFile {
  path: string;
  text: string;
  previewKind: import("./sourceText").SourcePreviewKind;
}

export type SourceContextInput =
  | { kind: "document"; text: string }
  | { kind: "project"; includedFiles: readonly ContextSourceFile[] };

export class ContextValidationError extends Error {
  readonly name = "ContextValidationError";
}

export function estimateTextTokens(text: string): number {
  return Math.ceil(Array.from(text).length / 4);
}

function validLimit(contextWindowTokens: number | null): boolean {
  return (
    contextWindowTokens === null ||
    (typeof contextWindowTokens === "number" &&
      Number.isFinite(contextWindowTokens) &&
      Number.isInteger(contextWindowTokens) &&
      contextWindowTokens > 0)
  );
}

export function assessContext(sourceText: string, contextWindowTokens: number | null): ContextAssessment {
  return assessSourceContext({ kind: "document", text: sourceText }, contextWindowTokens);
}

function projectFileTokens(file: ContextSourceFile): number {
  const divisor = file.previewKind === "code"
    || file.previewKind === "markup"
    || file.previewKind === "structured-data"
    || file.previewKind === "table"
    || file.previewKind === "latex"
    ? 3
    : 4;
  return Math.ceil(Array.from(file.text).length / divisor) + PROJECT_FILE_FRAMING_TOKENS;
}

export function assessSourceContext(source: SourceContextInput, contextWindowTokens: number | null): ContextAssessment {
  if (!validLimit(contextWindowTokens)) {
    throw new ContextValidationError("Context limit must be a positive whole number or unknown.");
  }

  const includedFileCount = source.kind === "project" ? source.includedFiles.length : 1;
  const sourceTokens = source.kind === "project"
    ? source.includedFiles.reduce((total, file) => total + projectFileTokens(file), 0)
    : estimateTextTokens(source.text);
  const oneShotWorkflowTokens = Math.ceil(sourceTokens * 2 + 1_500);
  const manualWorkflowTokens = Math.ceil(sourceTokens * 4 + 3_000);
  const oneShotRatio = contextWindowTokens === null ? null : oneShotWorkflowTokens / contextWindowTokens;
  const manualRatio = contextWindowTokens === null ? null : manualWorkflowTokens / contextWindowTokens;
  const oneShotOversized = contextWindowTokens !== null && oneShotWorkflowTokens > contextWindowTokens;
  const manualOversized = contextWindowTokens !== null && manualWorkflowTokens > contextWindowTokens;
  const amberRiskReasons: NonNullable<ContextAssessment["amberRiskReasons"]> = [];
  if (includedFileCount >= 25) amberRiskReasons.push("included-file-count");
  if (oneShotRatio !== null && oneShotRatio >= 0.5) amberRiskReasons.push("one-shot-ratio");

  return {
    estimateLabel: "Estimated tokens",
    sourceTokens,
    oneShotWorkflowTokens,
    manualWorkflowTokens,
    oneShotRatio,
    manualRatio,
    oneShotOversized,
    manualOversized,
    oneShotWarning: oneShotOversized,
    workflowTokens: manualWorkflowTokens,
    contextWindowTokens,
    ratio: manualRatio,
    oversized: manualOversized,
    acknowledgmentRequired: manualOversized,
    includedFileCount,
    amberRisk: amberRiskReasons.length > 0,
    amberRiskReasons,
    inspectDiffsAndRunTestsWarning: CONTEXT_DIFF_TEST_WARNING,
  };
}
