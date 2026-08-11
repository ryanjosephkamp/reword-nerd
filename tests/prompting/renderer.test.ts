import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const markers = [
  "<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>",
  "<<<INSERT_STAGE_2_REWRITE_RESPONSE>>>",
  "<<<INSERT_STAGE_3_VERIFICATION_RESPONSE>>>",
];

const markerOccurrences = (prompt: string, marker: string) => prompt.split(marker).length - 1;

describe("four-stage prompt rendering", () => {
  it("renders self-contained prompts in canonical order with preserved source artifacts", async () => {
    // This catches prompt assembly that alters source bytes or omits the model/settings context.
    const prompting = await import("../../src/prompting/renderPromptSet");
    const settings = await import("../../src/domain/settings");
    const profiles = await import("../../src/domain/profiles");
    const source = "Original {brace} `backtick` 😀\nTrailing line\n";
    const resolved = settings.resolveSettings(settings.DEFAULT_SETTINGS, {
      tone: "academic",
      formality: "formal",
      length: "concise",
      outputLanguage: "English",
      customRequirements: "Keep citation style.",
    });

    const promptSet = prompting.renderPromptSet(source, resolved, profiles.CURATED_MODEL_PROFILES[0]);
    const stageTemplates = [
      ["decompose", "01_decompose.md"],
      ["rewrite", "02_rewrite.md"],
      ["verify", "03_verify.md"],
      ["final", "04_final.md"],
    ] as const;

    for (const [stage, filename] of stageTemplates) {
      const rendered = promptSet[stage];
      const canonical = readFileSync(`prompts/${filename}`, "utf8");

      expect(rendered.startsWith(canonical)).toBe(true);
      expect(rendered.indexOf("## Model Workflow")).toBeGreaterThanOrEqual(canonical.length);
      expect(rendered.indexOf("## Rewrite Preferences")).toBeGreaterThan(rendered.indexOf("## Model Workflow"));
      expect(rendered).toContain("Selected model: OpenAI / ChatGPT");
      expect(rendered).toContain("Tone: Academic");
      expect(rendered).toContain("Formality: Formal");
      expect(rendered).toContain("Length: Concise");
      expect(rendered).toContain("Output language: English");
      expect(rendered).toContain("Custom requirements: Keep citation style.");
      expect(rendered).toContain(`===== BEGIN SOURCE DOCUMENT =====\n${source}===== END SOURCE DOCUMENT =====`);
    }
  });

  it("uses only the intended response markers in the intended stage order", async () => {
    // This catches duplicated markers, markers leaking into the wrong stage, or an incorrectly named handoff block.
    const prompting = await import("../../src/prompting/renderPromptSet");
    const settings = await import("../../src/domain/settings");
    const profiles = await import("../../src/domain/profiles");
    const promptSet = prompting.renderPromptSet("Source", settings.DEFAULT_SETTINGS, profiles.CURATED_MODEL_PROFILES[4]);

    expect(markers.filter((marker) => promptSet.decompose.includes(marker))).toEqual([]);
    expect(markers.filter((marker) => promptSet.rewrite.includes(marker))).toEqual([markers[0]]);
    expect(markers.filter((marker) => promptSet.verify.includes(marker))).toEqual(markers.slice(0, 2));
    expect(markers.filter((marker) => promptSet.final.includes(marker))).toEqual(markers);

    for (const prompt of [promptSet.rewrite, promptSet.verify, promptSet.final]) {
      const present = markers.filter((marker) => prompt.includes(marker));
      expect([...present].sort((left, right) => prompt.indexOf(left) - prompt.indexOf(right))).toEqual(present);
    }

    expect(markers.map((marker) => markerOccurrences(promptSet.decompose, marker))).toEqual([0, 0, 0]);
    expect(markers.map((marker) => markerOccurrences(promptSet.rewrite, marker))).toEqual([1, 0, 0]);
    expect(markers.map((marker) => markerOccurrences(promptSet.verify, marker))).toEqual([1, 1, 0]);
    expect(markers.map((marker) => markerOccurrences(promptSet.final, marker))).toEqual([1, 1, 1]);

    const expectedBlocks = [
      ["STAGE 1 DECOMPOSITION", markers[0]],
      ["STAGE 2 REWRITE", markers[1]],
      ["STAGE 3 VERIFICATION", markers[2]],
    ] as const;
    for (const [stage, prompt] of [
      [1, promptSet.rewrite],
      [2, promptSet.verify],
      [3, promptSet.final],
    ] as const) {
      for (const [name, marker] of expectedBlocks.slice(0, stage)) {
        expect(prompt).toContain(`===== BEGIN ${name} =====\n${marker}\n===== END ${name} =====`);
      }
    }
  });

  it("renders None. for an empty custom-requirements preference", async () => {
    // This catches a blank preference field that gives the model no deterministic instruction.
    const prompting = await import("../../src/prompting/renderPromptSet");
    const settings = await import("../../src/domain/settings");
    const profiles = await import("../../src/domain/profiles");

    const promptSet = prompting.renderPromptSet("Source", settings.DEFAULT_SETTINGS, profiles.CURATED_MODEL_PROFILES[5]);

    expect(promptSet.decompose).toContain("Custom requirements: None.");
    expect(promptSet.final).toContain("Selected model: Custom model");
  });
});
