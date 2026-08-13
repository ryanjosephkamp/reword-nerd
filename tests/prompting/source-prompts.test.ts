import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DEFAULT_CODE_REWRITE_OPTIONS, DEFAULT_SETTINGS } from "../../src/domain/settings";
import { CURATED_MODEL_PROFILES } from "../../src/domain/profiles";
import { responseMarkers } from "../../src/prompting/renderPromptSet";

const profile = CURATED_MODEL_PROFILES.find((item) => item.id === "openai-general")!;
const source = [
  { path: "src/main.ts", text: "export const n = 7;\n", originalHash: "a".repeat(64), reviewedTextHash: "b".repeat(64), languageId: "typescript", previewKind: "code" as const },
  { path: "docs/guide.md", text: "# Guide\n", originalHash: "c".repeat(64), reviewedTextHash: "d".repeat(64), languageId: "markdown", previewKind: "markdown" as const },
];

function expectedProjectFinalContract(boundary = "SOURCE_BOUNDARY_1234567890AB") {
  return `## Project Final Output Contract

For this project source, this terminal contract replaces every earlier document-only final-document, single-document, two-block, or fidelity-audit output instruction. Keep fidelity-audit concerns inside RISK_MANIFEST and do not emit a separate audit.

Return exactly the following four top-level sections in this order and no preamble or trailing commentary. Use exact reviewed project paths. Sort changed-file blocks and all manifest entries by path in ascending Unicode code-unit order.

\`\`\`text
<<<CHANGED_FILES>>>
${boundary} BEGIN CHANGED FILES
${boundary} BEGIN CHANGED FILE path/to/changed-file.ext
[Complete UTF-8 contents of this changed text file]
${boundary} END CHANGED FILE path/to/changed-file.ext
${boundary} END CHANGED FILES
<<<END_CHANGED_FILES>>>

<<<UNCHANGED_PATHS>>>
- path/to/unchanged-file.ext
<<<END_UNCHANGED_PATHS>>>

<<<EXCLUDED_PATHS>>>
- path/to/excluded-file.ext
<<<END_EXCLUDED_PATHS>>>

<<<RISK_MANIFEST>>>
- path/to/affected-file.ext | REVIEW | [compact evidence-bound risk]
<<<END_RISK_MANIFEST>>>
\`\`\`

Inside CHANGED_FILES, emit one complete path-delimited block per changed prompt-included text file; never emit a patch, diff, excerpt, ellipsis, or omitted section. If there are no changed files, emit \`None.\` between the CHANGED FILES boundary lines. UNCHANGED_PATHS must list every prompt-included file not returned as changed. EXCLUDED_PATHS must list every supplied excluded path and must not propose changes to it. RISK_MANIFEST must list only concrete affected paths and compact evidence-bound risks; emit \`None.\` when no risk remains. Use \`None.\` for any other empty block. Every prompt-included path must appear exactly once as changed or unchanged.`;
}

describe("code and project prompt-source contracts", () => {
  it("derives and extends a source boundary until it cannot collide with included content", async () => {
    // This catches a fixed delimiter appearing inside source and ending a path block early.
    const prompting = await import("../../src/prompting/renderPromptSet");
    const treeHash = "1234567890abcdef".repeat(4);
    const base = prompting.sourceBoundaryToken(treeHash, []);
    const extended = prompting.sourceBoundaryToken(treeHash, [{ ...source[0], text: `before ${base} after` }]);

    expect(base).toBe("SOURCE_BOUNDARY_1234567890AB");
    expect(extended).toBe("SOURCE_BOUNDARY_1234567890ABCDEF");
  });

  it("renders deterministic path-delimited reviewed sources with immutable and reviewed hashes", async () => {
    // This catches path flattening or reviewed bytes losing their provenance hash pair.
    const prompting = await import("../../src/prompting/renderPromptSet");
    const rendered = prompting.renderPromptSource({
      kind: "project",
      reviewedTreeHash: "1234567890abcdef".repeat(4),
      includedFiles: [...source].reverse(),
      excludedPaths: ["dist/app.js"],
    });

    expect(rendered.indexOf("docs/guide.md")).toBeLessThan(rendered.indexOf("src/main.ts"));
    expect(rendered).toContain(`SOURCE_BOUNDARY_1234567890AB BEGIN FILE docs/guide.md | ORIGINAL ${"c".repeat(64)} | REVIEWED ${"d".repeat(64)}`);
    expect(rendered).toContain("SOURCE_BOUNDARY_1234567890AB END FILE docs/guide.md");
    expect(rendered).toContain("Excluded paths: dist/app.js");
    expect(rendered.split("SOURCE_BOUNDARY_1234567890AB").length).toBeGreaterThan(2);
  });

  it("frames every file with the collision-free snapshot boundary when source contains the former closing marker", async () => {
    // This catches source text impersonating a fixed file terminator and escaping its path/hash frame.
    const prompting = await import("../../src/prompting/renderPromptSet");
    const formerClosingMarker = "<<<END FILE src/main.ts>>>";
    const rendered = prompting.renderPromptSource({
      kind: "project",
      reviewedTreeHash: "1234567890abcdef".repeat(4),
      includedFiles: [{ ...source[0], text: `before\n${formerClosingMarker}\nafter\n` }],
      excludedPaths: [],
    });

    expect(rendered.split(formerClosingMarker)).toHaveLength(2);
    expect(rendered).toContain(`SOURCE_BOUNDARY_1234567890AB BEGIN FILE src/main.ts | ORIGINAL ${"a".repeat(64)} | REVIEWED ${"b".repeat(64)}`);
    expect(rendered).toContain("SOURCE_BOUNDARY_1234567890AB END FILE src/main.ts");
  });

  it("keeps shared project fidelity stage-neutral and gives each stage one coherent output responsibility", async () => {
    // This catches final changed-file/manifests guidance leaking into Decompose, Rewrite, or Verify.
    const prompting = await import("../../src/prompting/renderPromptSet");
    const context = {
      kind: "project" as const,
      format: "code" as const,
      assets: [],
      reviewedTreeHash: "1234567890abcdef".repeat(4),
      includedFiles: source,
      excludedPaths: ["dist/app.js"],
      codeRewriteOptions: DEFAULT_CODE_REWRITE_OPTIONS,
    };
    const bundle = prompting.renderPromptBundle("legacy source is ignored for project framing", DEFAULT_SETTINGS, profile, context);
    const prompts = [bundle.oneShot, ...Object.values(bundle.manual)];
    const exactGuidance = "Preserve executable syntax, control flow, identifiers, imports and signatures, paths, keys, types, numbers, placeholders and escapes, citations and licenses, markup structure, and table shape and formulas.";

    for (const prompt of prompts) {
      expect(prompt.split(exactGuidance)).toHaveLength(2);
      expect(prompt).toContain("Do not modify excluded files");
      expect(prompt).toContain("Do not claim that builds or tests were run");
      expect(prompt).toContain("Inspect the generated diffs and run your normal tests/build after applying changes.");
      expect(prompt).toContain("dist/app.js");
      expect(prompt).toContain("Documentation and markup: include");
      expect(prompt).toContain("Narrative structured-data values: exclude");
      expect(prompt).toContain("Protected executable syntax: always preserve");
    }
    expect(bundle.manual.decompose).toContain("return only a structured semantic inventory organized by exact included path");
    expect(bundle.manual.decompose).not.toContain("BEGIN CHANGED FILE");
    expect(bundle.manual.decompose).not.toContain("Report unchanged, excluded, and risk manifests");
    expect(bundle.manual.rewrite).toContain("return only candidate complete UTF-8 changed-file blocks");
    expect(bundle.manual.rewrite).toContain("SOURCE_BOUNDARY_1234567890AB BEGIN CANDIDATE FILE path/to/changed-file.ext");
    expect(bundle.manual.rewrite).not.toContain("Produce **only** the rewritten document");
    expect(bundle.manual.rewrite).not.toContain("<<<UNCHANGED_PATHS>>>");
    expect(bundle.manual.rewrite).not.toContain("## Project Final Output Contract");
    expect(bundle.manual.verify).toContain("return only an evidence-bound verification report organized by exact path");
    expect(bundle.manual.verify).not.toContain("BEGIN CHANGED FILE");
    expect(bundle.manual.verify).not.toContain("<<<RISK_MANIFEST>>>");
    expect(bundle.oneShot).toContain("perform the four project stages internally and finalize changed included project files");
    expect(bundle.manual.final).toContain("repair only verified issues in included project files and follow the terminal project final output contract");
    expect(bundle.manual.rewrite.split(responseMarkers.decompose)).toHaveLength(2);
    expect(bundle.manual.verify.split(responseMarkers.rewrite)).toHaveLength(2);
    expect(bundle.manual.final.split(responseMarkers.verify)).toHaveLength(2);
  });

  it("applies the same fidelity contract to a standalone code source", async () => {
    // This catches fidelity guidance being limited to folder/ZIP projects while standalone code remains unsafe to rewrite.
    const prompting = await import("../../src/prompting/renderPromptSet");
    const bundle = prompting.renderPromptBundle("export const id = 'fixed';\n", DEFAULT_SETTINGS, profile, {
      kind: "document",
      format: "code",
      assets: [],
      codeRewriteOptions: { ...DEFAULT_CODE_REWRITE_OPTIONS, userFacingStrings: false },
    });

    for (const prompt of [bundle.oneShot, ...Object.values(bundle.manual)]) {
      expect(prompt).toContain("## Code and Project Fidelity Contract");
      expect(prompt).toContain("User-facing strings: exclude");
      expect(prompt).toContain("Protected executable syntax: always preserve");
    }
  });

  it("keeps one-shot and manual source/fidelity blocks byte-identical", async () => {
    // This catches workflow selection silently changing the project custody or rewrite boundary.
    const prompting = await import("../../src/prompting/renderPromptSet");
    const context = {
      kind: "project" as const,
      format: "code" as const,
      assets: [],
      reviewedTreeHash: "1234567890abcdef".repeat(4),
      includedFiles: source,
      excludedPaths: [],
      codeRewriteOptions: DEFAULT_CODE_REWRITE_OPTIONS,
    };
    const bundle = prompting.renderPromptBundle("unused", DEFAULT_SETTINGS, profile, context);
    const sourceBlock = prompting.renderPromptSource(context);

    expect(bundle.oneShot.split(sourceBlock)).toHaveLength(2);
    for (const prompt of Object.values(bundle.manual)) expect(prompt.split(sourceBlock)).toHaveLength(2);
  });

  it("terminates task-first project One-shot and Manual Final with one exact changed-files output grammar", async () => {
    // This catches canonical document-only output rules overriding the changed-files contract for project workspaces.
    const prompting = await import("../../src/prompting/renderPromptSet");
    const context = {
      kind: "project" as const,
      format: "code" as const,
      assets: [],
      reviewedTreeHash: "1234567890abcdef".repeat(4),
      includedFiles: source,
      excludedPaths: ["dist/app.js"],
      codeRewriteOptions: DEFAULT_CODE_REWRITE_OPTIONS,
    };
    const bundle = prompting.renderPromptBundle("unused", DEFAULT_SETTINGS, profile, context);
    const contract = expectedProjectFinalContract();

    expect(bundle.oneShot.endsWith(contract)).toBe(true);
    expect(bundle.manual.final.endsWith(contract)).toBe(true);
    expect(bundle.oneShot.slice(bundle.oneShot.lastIndexOf("## Project Final Output Contract"))).toBe(contract);
    expect(bundle.manual.final.slice(bundle.manual.final.lastIndexOf("## Project Final Output Contract"))).toBe(contract);
    expect(bundle.oneShot).not.toContain("## Required Output Contract");
    expect(bundle.oneShot).not.toContain(profile.promptStrategy.oneShotGuidance);
    expect(bundle.oneShot).not.toContain("finalize the rewritten document");
    expect(bundle.oneShot).not.toContain("<<<FINAL_DOCUMENT>>>");
    expect(bundle.oneShot).not.toContain("<<<FIDELITY_AUDIT>>>");
    expect(bundle.manual.final).not.toContain("## Output\n");
    expect(bundle.manual.final).not.toContain(profile.promptStrategy.stageGuidance.final);
    expect(bundle.manual.final).not.toContain("Produce the final polished version of the document");
    expect(bundle.manual.final).not.toContain("Return only the final document");
    expect(contract).toContain("replaces every earlier document-only");
    expect(contract).toContain("Keep fidelity-audit concerns inside RISK_MANIFEST");
    expect(contract).toContain("<<<CHANGED_FILES>>>");
    expect(contract).toContain("BEGIN CHANGED FILE path/to/changed-file.ext");
    expect(contract).toContain("<<<UNCHANGED_PATHS>>>");
    expect(contract).toContain("<<<EXCLUDED_PATHS>>>");
    expect(contract).toContain("<<<RISK_MANIFEST>>>");
    expect(contract).toContain("never emit a patch, diff, excerpt, ellipsis, or omitted section");
    expect(contract).toContain("Every prompt-included path must appear exactly once as changed or unchanged");
    for (const stage of [bundle.manual.decompose, bundle.manual.rewrite, bundle.manual.verify]) {
      expect(stage).not.toContain("## Project Final Output Contract");
    }
    expect(bundle.manual.final.split(responseMarkers.verify)).toHaveLength(2);
  });

  it("keeps the project final grammar terminal and byte-identical for source-first provider layouts", async () => {
    // This catches a source-first canonical task being appended after and contradicting the project-specific override.
    const prompting = await import("../../src/prompting/renderPromptSet");
    const sourceFirst = CURATED_MODEL_PROFILES.find((item) => item.id === "anthropic-general")!;
    const context = {
      kind: "project" as const,
      format: "code" as const,
      assets: [],
      reviewedTreeHash: "1234567890abcdef".repeat(4),
      includedFiles: source,
      excludedPaths: ["dist/app.js"],
      codeRewriteOptions: DEFAULT_CODE_REWRITE_OPTIONS,
    };
    const bundle = prompting.renderPromptBundle("unused", DEFAULT_SETTINGS, sourceFirst, context);
    const contract = expectedProjectFinalContract();
    const sourceBlock = prompting.renderPromptSource(context);
    const decomposeContract = "For this project stage, return only a structured semantic inventory organized by exact included path. Inventory rewriteable narrative and every protected code or structured-data constraint; do not return changed files or a final manifest.";
    const rewriteContract = "For this project stage, return only candidate complete UTF-8 changed-file blocks, sorted by exact path, using SOURCE_BOUNDARY_1234567890AB BEGIN CANDIDATE FILE path/to/changed-file.ext and SOURCE_BOUNDARY_1234567890AB END CANDIDATE FILE path/to/changed-file.ext. Omit unchanged and excluded file contents. Do not return final unchanged, excluded, or risk manifests at this stage.";
    const verifyContract = "For this project stage, return only an evidence-bound verification report organized by exact path. Identify supported repairs and remaining risks without returning changed-file contents or final manifests.";

    expect(bundle.oneShot.indexOf(sourceBlock)).toBeLessThan(bundle.oneShot.indexOf("# One-shot: Decompose, Rewrite, Verify, Final"));
    expect(bundle.manual.final.indexOf(sourceBlock)).toBeLessThan(bundle.manual.final.indexOf("# Stage 4: Final Pass"));
    expect(bundle.oneShot.endsWith(contract)).toBe(true);
    expect(bundle.manual.final.endsWith(contract)).toBe(true);
    expect(bundle.manual.decompose.endsWith(decomposeContract)).toBe(true);
    expect(bundle.manual.rewrite.endsWith(rewriteContract)).toBe(true);
    expect(bundle.manual.verify.endsWith(verifyContract)).toBe(true);
    expect(bundle.oneShot).not.toContain(sourceFirst.promptStrategy.oneShotGuidance);
    expect(bundle.oneShot).not.toContain("finalize the rewritten document");
    expect(bundle.manual.final).not.toContain(sourceFirst.promptStrategy.stageGuidance.final);
    expect(bundle.manual.final).not.toContain("Produce the final polished version of the document");
    expect(bundle.oneShot.slice(bundle.oneShot.lastIndexOf("## Project Final Output Contract")))
      .toBe(bundle.manual.final.slice(bundle.manual.final.lastIndexOf("## Project Final Output Contract")));
    expect(bundle.manual.final.split(responseMarkers.decompose)).toHaveLength(2);
    expect(bundle.manual.final.split(responseMarkers.rewrite)).toHaveLength(2);
    expect(bundle.manual.final.split(responseMarkers.verify)).toHaveLength(2);
  });

  it("uses only project path contracts for LaTeX projects in task-first and source-first layouts", async () => {
    // This catches legacy LaTeX document blocks or single-document outputs competing with project contracts.
    const prompting = await import("../../src/prompting/renderPromptSet");
    const sourceFirst = CURATED_MODEL_PROFILES.find((item) => item.id === "anthropic-general")!;
    const context = {
      kind: "project" as const,
      format: "latex-project" as const,
      assets: [],
      reviewedTreeHash: "1234567890abcdef".repeat(4),
      includedFiles: [{ ...source[1], path: "paper/main.tex", languageId: "latex", text: "\\documentclass{article}\n\\begin{document}Hello\\end{document}\n" }],
      excludedPaths: ["paper/references.bib"],
      codeRewriteOptions: DEFAULT_CODE_REWRITE_OPTIONS,
      latexMainFile: "paper/main.tex",
    };

    for (const model of [profile, sourceFirst]) {
      const bundle = prompting.renderPromptBundle("unused", DEFAULT_SETTINGS, model, context);
      for (const prompt of [bundle.oneShot, ...Object.values(bundle.manual)]) {
        expect(prompt).not.toContain("<<<FILE");
        expect(prompt).not.toContain("rewritten source\n<<<END FILE>>>");
        expect(prompt).toContain("Main file: paper/main.tex");
      }
      expect(bundle.oneShot).not.toContain("<<<FINAL_DOCUMENT>>>");
      expect(bundle.oneShot).not.toContain("finalize the rewritten document");
      expect(bundle.manual.rewrite).not.toContain("Produce **only** the rewritten document");
      expect(bundle.manual.final).not.toContain("Produce the final polished version of the document");
      expect(bundle.manual.final).not.toContain("Return only the final document");
      expect(bundle.oneShot.endsWith(expectedProjectFinalContract())).toBe(true);
      expect(bundle.manual.final.endsWith(expectedProjectFinalContract())).toBe(true);
      expect(bundle.manual.rewrite.endsWith("Do not return final unchanged, excluded, or risk manifests at this stage.")).toBe(true);
    }
  });

  it("leaves standalone document One-shot and Manual Final output contracts unchanged", async () => {
    // This catches project terminal grammar leaking into ordinary document prompts.
    const prompting = await import("../../src/prompting/renderPromptSet");
    const taskFirst = prompting.renderPromptBundle("ordinary source", DEFAULT_SETTINGS, profile, {
      kind: "document",
      format: "code",
      assets: [],
      codeRewriteOptions: DEFAULT_CODE_REWRITE_OPTIONS,
    });
    const sourceFirstProfile = CURATED_MODEL_PROFILES.find((item) => item.id === "anthropic-general")!;
    const sourceFirst = prompting.renderPromptBundle("ordinary source", DEFAULT_SETTINGS, sourceFirstProfile, {
      kind: "document",
      format: "code",
      assets: [],
      codeRewriteOptions: DEFAULT_CODE_REWRITE_OPTIONS,
    });

    for (const bundle of [taskFirst, sourceFirst]) {
      expect(bundle.oneShot).toContain("<<<FINAL_DOCUMENT>>>");
      expect(bundle.oneShot).toContain("<<<FIDELITY_AUDIT>>>");
      expect(bundle.manual.final).toContain("Return only the final document");
      expect(bundle.oneShot).not.toContain("## Project Final Output Contract");
      expect(bundle.manual.final).not.toContain("## Project Final Output Contract");
    }
    expect(taskFirst.oneShot.startsWith(readFileSync("prompts/00_one_shot.md", "utf8"))).toBe(true);
    expect(taskFirst.manual.final.startsWith(readFileSync("prompts/04_final.md", "utf8"))).toBe(true);
    expect(sourceFirst.oneShot.endsWith(readFileSync("prompts/00_one_shot.md", "utf8"))).toBe(true);
    expect(sourceFirst.manual.final.endsWith(readFileSync("prompts/04_final.md", "utf8"))).toBe(true);
  });
});
