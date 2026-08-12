import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const markers = [
  "<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>",
  "<<<INSERT_STAGE_2_REWRITE_RESPONSE>>>",
  "<<<INSERT_STAGE_3_VERIFICATION_RESPONSE>>>",
];

const markerOccurrences = (prompt: string, marker: string) => prompt.split(marker).length - 1;

describe("four-stage prompt rendering", () => {
  it("renders a one-shot prompt beside the unchanged manual workflow", async () => {
    // This catches a bundle renderer that drops a manual stage or mutates the canonical manual prompt bytes.
    const prompting = await import("../../src/prompting/renderPromptSet");
    const settings = await import("../../src/domain/settings");
    const profiles = await import("../../src/domain/profiles");
    const profile = profiles.CURATED_MODEL_PROFILES.find((item) => item.id === "openai-general")!;

    const bundle = prompting.renderPromptBundle("Source", settings.DEFAULT_SETTINGS, profile);
    const legacy = prompting.renderPromptSet("Source", settings.DEFAULT_SETTINGS, profile);

    expect(bundle.manual).toEqual(legacy);
    expect(Object.keys(bundle.manual)).toEqual(["decompose", "rewrite", "verify", "final"]);
    expect(bundle.oneShot).toContain("# One-shot: Decompose, Rewrite, Verify, Final");
    expect(bundle.oneShot).not.toContain("INSERT_STAGE_");
  });

  it("gives one-shot a stable final-document and compact-audit contract", async () => {
    // This catches a one-shot response that exposes bulky intermediate stages or cannot be parsed into its two deliverables.
    const prompting = await import("../../src/prompting/renderPromptSet");
    const settings = await import("../../src/domain/settings");
    const profiles = await import("../../src/domain/profiles");
    const canonical = readFileSync("prompts/00_one_shot.md", "utf8");
    const profile = profiles.CURATED_MODEL_PROFILES.find((item) => item.id === "openai-general")!;
    const resolved = settings.resolveSettings(settings.DEFAULT_SETTINGS, {
      customRequirements: "Keep the heading.\n\nRetain  internal spacing.",
    });

    const prompt = prompting.renderPromptBundle("Source\nwith math $x^2$\n", resolved, profile, {
      format: "latex-project",
      assets: [{
        id: "asset-figure1",
        filename: "figure-1.png",
        mimeType: "image/png",
        sourcePath: "figures/figure-1.png",
        included: true,
      }],
      latexMainFile: "main.tex",
    }).oneShot;

    expect(prompt.startsWith(canonical)).toBe(true);
    expect(prompt).toContain("Perform all four stages internally");
    expect(prompt).toContain("<<<FINAL_DOCUMENT>>>");
    expect(prompt).toContain("<<<END_FINAL_DOCUMENT>>>");
    expect(prompt).toContain("<<<FIDELITY_AUDIT>>>");
    expect(prompt).toContain("<<<END_FIDELITY_AUDIT>>>");
    expect(prompt).toContain("Keep the heading.\n\nRetain  internal spacing.");
    expect(prompt).toContain("asset-figure1 | figure-1.png | source figures/figure-1.png");
    expect(prompt).toContain("Preserve LaTeX preambles, macros, math, citations, labels, references, paths, and figure environments");
    expect(prompt.split(profile.promptStrategy.sharedGuidance)).toHaveLength(2);
    expect(prompt.split(profile.promptStrategy.oneShotGuidance)).toHaveLength(2);
    expect(prompt.match(/## Model-Specific Execution Guidance/g)).toHaveLength(1);
  });

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

    const profile = profiles.CURATED_MODEL_PROFILES.find((item) => item.id === "openai-general")!;
    const promptSet = prompting.renderPromptSet(source, resolved, profile);
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
      expect(rendered).toContain("===== BEGIN CUSTOM REQUIREMENTS =====\nKeep citation style.\n===== END CUSTOM REQUIREMENTS =====");
      expect(rendered).toContain(`===== BEGIN SOURCE DOCUMENT =====\n${source}===== END SOURCE DOCUMENT =====`);
    }
  });

  it("uses the selected provider strategy without changing canonical stage text", async () => {
    // This catches a generic one-layout renderer that ignores long-context and delimiter guidance.
    const prompting = await import("../../src/prompting/renderPromptSet");
    const settings = await import("../../src/domain/settings");
    const profiles = await import("../../src/domain/profiles");
    const canonical = readFileSync("prompts/01_decompose.md", "utf8");
    const profile = profiles.CURATED_MODEL_PROFILES.find((item) => item.id === "anthropic-general")!;

    const prompt = prompting.renderPromptSet("Long source", settings.DEFAULT_SETTINGS, profile).decompose;

    expect(prompt).toContain("## Model-Specific Execution Guidance");
    expect(prompt).toContain("Reference model: Claude Opus 5");
    expect(prompt).toContain("<source_document>\nLong source\n</source_document>");
    expect(prompt.indexOf("<source_document>")).toBeLessThan(prompt.indexOf(canonical));
    expect(prompt.endsWith(canonical)).toBe(true);
  });

  it("preserves multiline custom requirements inside a named artifact", async () => {
    // This catches flattening or trimming of meaningful internal spaces and blank lines.
    const prompting = await import("../../src/prompting/renderPromptSet");
    const settings = await import("../../src/domain/settings");
    const profiles = await import("../../src/domain/profiles");
    const profile = profiles.CURATED_MODEL_PROFILES.find((item) => item.id === "custom")!;
    const resolved = settings.resolveSettings(settings.DEFAULT_SETTINGS, {
      customRequirements: "  Keep  this spacing.\n\nRetain the blank line.  ",
    });

    const prompt = prompting.renderPromptSet("Source", resolved, profile).rewrite;

    expect(prompt).toContain(
      "===== BEGIN CUSTOM REQUIREMENTS =====\nKeep  this spacing.\n\nRetain the blank line.\n===== END CUSTOM REQUIREMENTS =====",
    );
    expect(prompt).toContain("Use a conservative provider-neutral prompt structure");
  });

  it("uses only the intended response markers in the intended stage order", async () => {
    // This catches duplicated markers, markers leaking into the wrong stage, or an incorrectly named handoff block.
    const prompting = await import("../../src/prompting/renderPromptSet");
    const settings = await import("../../src/domain/settings");
    const profiles = await import("../../src/domain/profiles");
    const profile = profiles.CURATED_MODEL_PROFILES.find((item) => item.id === "custom")!;
    const promptSet = prompting.renderPromptSet("Source", settings.DEFAULT_SETTINGS, profile);

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

    const profile = profiles.CURATED_MODEL_PROFILES.find((item) => item.id === "custom")!;
    const promptSet = prompting.renderPromptSet("Source", settings.DEFAULT_SETTINGS, profile);

    expect(promptSet.decompose).toContain("===== BEGIN CUSTOM REQUIREMENTS =====\nNone.\n===== END CUSTOM REQUIREMENTS =====");
    expect(promptSet.final).toContain("Selected model: Custom model");
  });

  it("adds stage-specific figure placement and LaTeX fidelity instructions without altering canonical tasks", async () => {
    // This catches assets being exported without prompting the model to inventory, place, verify, and preserve them.
    const prompting = await import("../../src/prompting/renderPromptSet");
    const settings = await import("../../src/domain/settings");
    const profiles = await import("../../src/domain/profiles");
    const profile = profiles.CURATED_MODEL_PROFILES.find((item) => item.id === "openai-general")!;
    const context = {
      format: "latex-project" as const,
      assets: [{
        id: "asset-figure1",
        filename: "figure-1.png",
        mimeType: "image/png",
        pageNumber: 4,
        sourcePath: "figures/figure-1.png",
        caption: "Measured and predicted affinity",
        altText: undefined,
        included: true,
      }],
      latexMainFile: "main.tex",
    };

    const prompts = prompting.renderPromptSet("Source", settings.DEFAULT_SETTINGS, profile, context);

    expect(prompts.decompose).toContain("inventory every included visual asset");
    expect(prompts.rewrite).toContain("place each required visual asset near the rewritten discussion");
    expect(prompts.verify).toContain("verify every included asset is referenced");
    expect(prompts.final).toContain("repair missing or incorrect visual placement");
    for (const prompt of Object.values(prompts)) {
      expect(prompt).toContain("asset-figure1 | figure-1.png | source figures/figure-1.png | page 4");
      expect(prompt).toContain("Preserve LaTeX preambles, macros, math, citations, labels, references, paths, and figure environments");
      expect(prompt).toContain("<<<FILE relative/path.tex>>>");
    }
  });
});
