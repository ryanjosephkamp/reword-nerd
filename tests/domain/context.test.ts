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

  it("uses the four-stage estimate and allows an exact known context threshold", async () => {
    // This catches an overly strict equality check or a workflow estimate that ignores stage overhead.
    const context = await import("../../src/domain/context");

    const assessment = context.assessContext("abcd", 3_004);

    expect(assessment).toMatchObject({
      sourceTokens: 1,
      workflowTokens: 3_004,
      contextWindowTokens: 3_004,
      ratio: 1,
      oversized: false,
      acknowledgmentRequired: false,
    });
    expect(assessment.estimateLabel).toMatch(/estimate/i);
  });

  it("warns only when a known limit is exceeded and never acknowledges it itself", async () => {
    // This catches treating unknown context as blocked or silently storing an acknowledgment.
    const context = await import("../../src/domain/context");

    expect(context.assessContext("abcd", 3_003)).toMatchObject({
      oversized: true,
      acknowledgmentRequired: true,
    });
    expect(context.assessContext("abcd", null)).toMatchObject({
      ratio: null,
      oversized: false,
      acknowledgmentRequired: false,
    });
    expect(context.assessContext("abcd", 3_003)).not.toHaveProperty("contextWarningAcknowledged");
  });

  it("rejects an invalid known context limit with a safe typed error", async () => {
    // This catches accepting values that cannot represent a usable model context window.
    const context = await import("../../src/domain/context");

    for (const invalidLimit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => context.assessContext("source", invalidLimit)).toThrow(context.ContextValidationError);
    }
  });
});
