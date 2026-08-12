import { describe, expect, it } from "vitest";

describe("conservative context sizing", () => {
  it("estimates tokens from Unicode code points, including empty text", async () => {
    // This catches UTF-16 code-unit counting or floor rounding that underestimates the input.
    const context = await import("../../src/domain/context");

    expect(context.estimateTextTokens("")).toBe(0);
    expect(context.estimateTextTokens("abcd")).toBe(1);
    expect(context.estimateTextTokens("abcde")).toBe(2);
    expect(context.estimateTextTokens("😀😀😀😀")).toBe(1);
  });

  it("reports separate one-shot and manual estimates while preserving the manual threshold gate", async () => {
    // This catches conflating the smaller one-shot estimate with the required manual-workflow safety gate.
    const context = await import("../../src/domain/context");

    const assessment = context.assessContext("abcd", 3_004);

    expect(assessment).toMatchObject({
      sourceTokens: 1,
      workflowTokens: 3_004,
      manualWorkflowTokens: 3_004,
      oneShotWorkflowTokens: 1_502,
      contextWindowTokens: 3_004,
      ratio: 1,
      manualRatio: 1,
      oneShotRatio: 1_502 / 3_004,
      oversized: false,
      manualOversized: false,
      oneShotOversized: false,
      oneShotWarning: false,
      acknowledgmentRequired: false,
    });
    expect(assessment.estimateLabel).toMatch(/estimate/i);
  });

  it("warns only when a known limit is exceeded and never acknowledges it itself", async () => {
    // This catches treating unknown context as blocked or silently storing an acknowledgment.
    const context = await import("../../src/domain/context");

    expect(context.assessContext("abcd", 3_003)).toMatchObject({
      oversized: true,
      manualOversized: true,
      acknowledgmentRequired: true,
    });
    expect(context.assessContext("abcd", null)).toMatchObject({
      ratio: null,
      manualRatio: null,
      oneShotRatio: null,
      oversized: false,
      oneShotOversized: false,
      oneShotWarning: false,
      acknowledgmentRequired: false,
    });
    expect(context.assessContext("abcd", 3_003)).not.toHaveProperty("contextWarningAcknowledged");
  });

  it("makes an exceeded one-shot estimate advisory while manual acknowledgment remains required", async () => {
    // This catches a one-shot warning becoming a new blocking acknowledgment or replacing the stricter manual gate.
    const context = await import("../../src/domain/context");

    expect(context.assessContext("abcd", 1_501)).toMatchObject({
      oneShotOversized: true,
      oneShotWarning: true,
      manualOversized: true,
      acknowledgmentRequired: true,
    });
  });

  it("rejects an invalid known context limit with a safe typed error", async () => {
    // This catches accepting values that cannot represent a usable model context window.
    const context = await import("../../src/domain/context");

    for (const invalidLimit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => context.assessContext("source", invalidLimit)).toThrow(context.ContextValidationError);
    }
  });
});
