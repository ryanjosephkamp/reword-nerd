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
}

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
  if (!validLimit(contextWindowTokens)) {
    throw new ContextValidationError("Context limit must be a positive whole number or unknown.");
  }

  const sourceTokens = estimateTextTokens(sourceText);
  const oneShotWorkflowTokens = Math.ceil(sourceTokens * 2 + 1_500);
  const manualWorkflowTokens = Math.ceil(sourceTokens * 4 + 3_000);
  const oneShotRatio = contextWindowTokens === null ? null : oneShotWorkflowTokens / contextWindowTokens;
  const manualRatio = contextWindowTokens === null ? null : manualWorkflowTokens / contextWindowTokens;
  const oneShotOversized = contextWindowTokens !== null && oneShotWorkflowTokens > contextWindowTokens;
  const manualOversized = contextWindowTokens !== null && manualWorkflowTokens > contextWindowTokens;

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
  };
}
