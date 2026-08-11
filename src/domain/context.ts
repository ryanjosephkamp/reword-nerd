export interface ContextAssessment {
  estimateLabel: "Estimated tokens";
  sourceTokens: number;
  workflowTokens: number;
  contextWindowTokens: number | null;
  ratio: number | null;
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
  const workflowTokens = Math.ceil(sourceTokens * 4 + 3_000);
  const ratio = contextWindowTokens === null ? null : workflowTokens / contextWindowTokens;
  const oversized = contextWindowTokens !== null && workflowTokens > contextWindowTokens;

  return {
    estimateLabel: "Estimated tokens",
    sourceTokens,
    workflowTokens,
    contextWindowTokens,
    ratio,
    oversized,
    acknowledgmentRequired: oversized,
  };
}
