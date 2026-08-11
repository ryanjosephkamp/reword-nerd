import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

describe("curated model profiles", () => {
  it("provides the ordered conservative defaults without making a provider call", async () => {
    // This catches profile metadata drift, a mutable list, or an accidental network dependency.
    vi.stubGlobal("fetch", () => {
      throw new Error("Profiles must not call providers.");
    });

    const profiles = await import("../../src/domain/profiles");

    expect(profiles.DEFAULT_MODEL_PROFILE_ID).toBe("openai-general");
    expect(profiles.CURATED_MODEL_PROFILES.map((profile) => [
      profile.id,
      profile.family,
      profile.label,
      profile.contextWindowTokens,
      profile.lastReviewed,
      profile.promptStrategy.referenceModel,
      profile.promptStrategy.layout,
      profile.promptStrategy.delimiterStyle,
    ])).toEqual([
      ["alibaba-qwen", "alibaba", "Alibaba / Qwen", 1_000_000, "2026-08-11", "Qwen3.7 Max", "task-first", "markdown"],
      ["anthropic-general", "anthropic", "Anthropic / Claude", 1_000_000, "2026-08-11", "Claude Opus 5", "source-first-task-last", "xml"],
      ["custom", "custom", "Custom model", null, "2026-08-11", "User supplied", "task-first", "markdown"],
      ["deepseek-general", "deepseek", "DeepSeek / V4 Pro", 1_000_000, "2026-08-11", "DeepSeek V4 Pro", "task-first", "markdown"],
      ["google-general", "google", "Google / Gemini", 1_048_576, "2026-08-11", "Gemini 3.1 Pro Preview", "source-first-task-last", "xml"],
      ["meta-muse", "meta", "Meta / Muse", 1_000_000, "2026-08-11", "Muse Spark 1.1", "task-first", "markdown"],
      ["minimax-general", "minimax", "MiniMax / M3", 1_000_000, "2026-08-11", "MiniMax M3", "source-first-task-last", "markdown"],
      ["mistral-general", "mistral", "Mistral / Large 3", 256_000, "2026-08-11", "Mistral Large 3", "task-first", "markdown"],
      ["moonshot-kimi", "moonshot", "MoonshotAI / Kimi", 1_000_000, "2026-08-11", "Kimi K3", "task-first", "markdown"],
      ["openai-general", "openai", "OpenAI / ChatGPT", 1_050_000, "2026-08-11", "GPT-5.6 Sol", "task-first", "markdown"],
      ["xai-general", "xai", "xAI / Grok", 500_000, "2026-08-11", "Grok 4.5", "task-first", "markdown"],
      ["zai-glm", "zai", "Z.AI / GLM", 200_000, "2026-08-11", "GLM-5.1", "task-first", "markdown"],
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
    const customDefault = profiles.CURATED_MODEL_PROFILES.find((profile) => profile.id === "custom");
    const originalLabel = customDefault?.label;

    const profile = profiles.createCustomProfile("  Campus LLM  ", 32_768);

    expect(profile).toMatchObject({
      id: "custom",
      family: "custom",
      label: "Campus LLM",
      contextWindowTokens: 32_768,
      lastReviewed: "2026-08-11",
      promptStrategy: expect.objectContaining({
        id: "custom-neutral-v1",
        referenceModel: "User supplied",
      }),
    });
    expect(profile).not.toBe(customDefault);
    expect(customDefault?.label).toBe(originalLabel);
    expect(profiles.createCustomProfile("Offline", null).contextWindowTokens).toBeNull();

    for (const invalid of [" ", 0, -1, 1.5, Number.POSITIVE_INFINITY]) {
      expect(() => profiles.createCustomProfile(invalid as never, 1)).toThrow(profiles.ProfileValidationError);
    }
    for (const invalidLimit of [0, -1, 1.5, Number.NaN]) {
      expect(() => profiles.createCustomProfile("Safe", invalidLimit)).toThrow(profiles.ProfileValidationError);
    }
  });

  it("keeps every runtime strategy traceable to its dated research artifact", async () => {
    const { CURATED_MODEL_PROFILES } = await import("../../src/domain/profiles");

    for (const profile of CURATED_MODEL_PROFILES) {
      const strategy = profile.promptStrategy;
      const research = readFileSync(strategy.guidanceDocument, "utf8");
      expect(research).toContain(`Runtime strategy ID: \`${strategy.id}\``);
      expect(research).toContain(`Runtime strategy version: \`${strategy.version}\``);
      expect(research).toContain(`Reference model: ${strategy.referenceModel}`);
      expect(research).toContain(`Reviewed: ${strategy.reviewedAt}`);
      expect(research).toContain(`Runtime layout: \`${strategy.layout}\``);
      expect(research).toContain(`Runtime delimiters: \`${strategy.delimiterStyle}\``);
      expect(research).toContain(strategy.sharedGuidance);
      for (const stageGuidance of Object.values(strategy.stageGuidance)) {
        expect(research).toContain(stageGuidance);
      }
    }
  });
});
