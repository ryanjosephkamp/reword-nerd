import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const prompt = (filename: string) => readFileSync(`prompts/${filename}`, "utf8");

describe("canonical prompt hardening", () => {
  it("requires complete Stage 1 coverage even for long documents", () => {
    // This catches a decomposition prompt that trades away material coverage for concision.
    const stage = prompt("01_decompose.md");

    expect(stage).toMatch(/every material claim, fact, constraint, relationship, protected term, citation, and ambiguity/i);
    expect(stage).toMatch(/concision applies to wording, not coverage/i);
    expect(stage).toMatch(/even for long documents/i);
  });

  it("allows Stage 2 reorganization while requiring selected preferences", () => {
    // This catches a rewrite instruction that preserves order mechanically or ignores user preferences.
    const stage = prompt("02_rewrite.md");

    expect(stage).toMatch(/reorganize sections and paragraph flow/i);
    expect(stage).toMatch(/preserves logical relationships/i);
    expect(stage).toMatch(/selected preferences/i);
  });

  it("requires Stage 3 preference assessment and an explicit empty issue list", () => {
    // This catches verification reports that skip preference adherence or hide a clean issue list.
    const stage = prompt("03_verify.md");

    expect(stage).toMatch(/preference adherence/i);
    expect(stage).toMatch(/Specific Issues[\s\S]*None\./i);
  });

  it("requires Stage 4 to receive every artifact and return only the repaired final document", () => {
    // This catches a final pass that cannot cross-check all prior work or returns commentary.
    const stage = prompt("04_final.md");

    expect(stage).toMatch(/source document, decomposition, rewrite, and verification report/i);
    expect(stage).toMatch(/repair every supported issue/i);
    expect(stage).toMatch(/cross-check against the source and decomposition/i);
    expect(stage).toMatch(/only the final document/i);
  });
});
