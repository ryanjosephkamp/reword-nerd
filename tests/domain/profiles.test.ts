import { describe, expect, it, vi } from "vitest";

describe("curated model profiles", () => {
  it("provides the ordered conservative defaults without making a provider call", async () => {
    // This catches profile metadata drift, a mutable list, or an accidental network dependency.
    vi.stubGlobal("fetch", () => {
      throw new Error("Profiles must not call providers.");
    });

    const profiles = await import("../../src/domain/profiles");

    expect(profiles.CURATED_MODEL_PROFILES.map((profile) => [
      profile.id,
      profile.family,
      profile.label,
      profile.contextWindowTokens,
      profile.lastReviewed,
    ])).toEqual([
      ["openai-general", "openai", "OpenAI / ChatGPT", 128_000, "2026-08-11"],
      ["anthropic-general", "anthropic", "Anthropic / Claude", 200_000, "2026-08-11"],
      ["google-general", "google", "Google / Gemini", 1_000_000, "2026-08-11"],
      ["xai-general", "xai", "xAI / Grok", 1_000_000, "2026-08-11"],
      ["local-general", "local", "Local model", null, "2026-08-11"],
      ["custom", "custom", "Custom model", null, "2026-08-11"],
    ]);
    expect(Object.isFrozen(profiles.CURATED_MODEL_PROFILES)).toBe(true);
    expect(Object.isFrozen(profiles.CURATED_MODEL_PROFILES[0])).toBe(true);
    expect(profiles.CURATED_MODEL_PROFILES[0].workflowNote).toMatch(/new conversation for each document/i);
    expect(profiles.CURATED_MODEL_PROFILES[0].workflowNote).toMatch(/four prompts in order/i);
    expect(profiles.CURATED_MODEL_PROFILES[0].workflowNote).toMatch(/previous stage outputs/i);
    expect(profiles.CURATED_MODEL_PROFILES[0].workflowNote).toMatch(/limits vary by model and account/i);
  });

  it("creates an independent valid custom profile and rejects unsafe values", async () => {
    // This catches mutation of curated defaults and acceptance of unusable context limits.
    const profiles = await import("../../src/domain/profiles");
    const originalLabel = profiles.CURATED_MODEL_PROFILES[5].label;

    const profile = profiles.createCustomProfile("  Campus LLM  ", 32_768);

    expect(profile).toMatchObject({
      id: "custom",
      family: "custom",
      label: "Campus LLM",
      contextWindowTokens: 32_768,
      lastReviewed: "2026-08-11",
    });
    expect(profile).not.toBe(profiles.CURATED_MODEL_PROFILES[5]);
    expect(profiles.CURATED_MODEL_PROFILES[5].label).toBe(originalLabel);
    expect(profiles.createCustomProfile("Offline", null).contextWindowTokens).toBeNull();

    for (const invalid of [" ", 0, -1, 1.5, Number.POSITIVE_INFINITY]) {
      expect(() => profiles.createCustomProfile(invalid as never, 1)).toThrow(profiles.ProfileValidationError);
    }
    for (const invalidLimit of [0, -1, 1.5, Number.NaN]) {
      expect(() => profiles.createCustomProfile("Safe", invalidLimit)).toThrow(profiles.ProfileValidationError);
    }
  });
});
