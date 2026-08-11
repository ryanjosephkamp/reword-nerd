import { describe, expect, it } from "vitest";
import type { RewriteSettings } from "../../src/domain/settings";

describe("settings resolution and validation", () => {
  it("merges a trimmed per-file override without mutating either input", async () => {
    // This catches a resolver that mutates state or fails to normalize user-entered text.
    const settings = await import("../../src/domain/settings");
    const globalSettings = {
      tone: "academic",
      formality: "formal",
      length: "expanded",
      outputLanguage: " English ",
      customRequirements: "  Keep  internal\nspacing.  ",
    } satisfies RewriteSettings;
    const override = {
      tone: "plain",
      outputLanguage: "  French  ",
      customRequirements: "\n  Retain headings.\n",
    } satisfies Partial<RewriteSettings>;

    const resolved = settings.resolveSettings(globalSettings, override);

    expect(resolved).toEqual({
      tone: "plain",
      formality: "formal",
      length: "expanded",
      outputLanguage: "French",
      customRequirements: "Retain headings.",
    });
    expect(globalSettings.outputLanguage).toBe(" English ");
    expect(override.outputLanguage).toBe("  French  ");
    expect(globalSettings.customRequirements).toBe("  Keep  internal\nspacing.  ");
    expect(override.customRequirements).toBe("\n  Retain headings.\n");
  });

  it("trims custom requirements only at the edges while preserving internal spacing and line breaks", async () => {
    // This catches normalization that collapses meaningful formatting inside a user instruction.
    const settings = await import("../../src/domain/settings");

    const resolved = settings.resolveSettings(
      {
        ...settings.DEFAULT_SETTINGS,
        customRequirements: "  Keep  this exact spacing.\n\nRetain this line break.  ",
      },
      {},
    );

    expect(resolved.customRequirements).toBe("Keep  this exact spacing.\n\nRetain this line break.");
  });

  it("uses preserve defaults and natural labels", async () => {
    // This catches defaults or prompt labels that turn "preserve" into an unnatural instruction.
    const settings = await import("../../src/domain/settings");

    expect(settings.resolveSettings(settings.DEFAULT_SETTINGS, {})).toEqual({
      tone: "preserve",
      formality: "preserve",
      length: "preserve",
      outputLanguage: "Preserve source language",
      customRequirements: "",
    });
    expect(settings.toneLabel("preserve")).toBe("Preserve the source tone");
    expect(settings.formalityLabel("preserve")).toBe("Preserve the source formality");
    expect(settings.lengthLabel("preserve")).toBe("Preserve the source length");
  });

  it("rejects unsafe enum values, blank language, and requirements over 2,000 Unicode code points", async () => {
    // This catches acceptance of malformed settings that would make prompts ambiguous or oversized.
    const settings = await import("../../src/domain/settings");

    for (const invalid of [
      { tone: "casual" },
      { formality: "ceremonial" },
      { length: "brief" },
      { outputLanguage: " \n " },
      { customRequirements: `${"😀".repeat(2_000)}x` },
    ]) {
      expect(() => settings.resolveSettings(settings.DEFAULT_SETTINGS, invalid as never)).toThrow(
        settings.SettingsValidationError,
      );
    }

    try {
      settings.resolveSettings(settings.DEFAULT_SETTINGS, { tone: "casual" } as never);
    } catch (error) {
      expect(error).toBeInstanceOf(settings.SettingsValidationError);
      expect((error as Error).message).not.toMatch(/stack|internal|undefined/i);
    }
  });
});
