# Z.AI / GLM guidance

- Runtime strategy ID: `zai-glm-v1`
- Runtime strategy version: `2026-08-11-v1`
- Reference model: GLM-5.1
- Default context: 200,000 tokens
- Reviewed: 2026-08-11
- Runtime layout: `task-first`
- Runtime delimiters: `markdown`
- Evidence confidence: Medium

## First-party evidence

- [GLM-5.1 guide](https://docs.z.ai/guides/llm/glm-5.1) — 200K context, 128K maximum output, complex instruction following, long-context understanding, structured output, and optional thinking modes. Accessed 2026-08-11.

## Recommendations for this workflow

Use clear task-first instructions, explicit semantic constraints, and named input sections. Keep the current stage visible and avoid combining all four stages. The 200K context is the smallest curated default after accounting for output, so heed context warnings on large documents.

Decomposition should be comprehensive but compact. Rewrite must remain bound to source and decomposition. Verification is the strongest candidate for deeper thinking when the interface provides it. Final should produce only the repaired document.

## Manual chat versus API

The `thinking` object, temperature, caching, structured output, SDK, and endpoint are API settings and are not included in generated prompts. Manual users can select an available thinking mode in their UI without altering the package.

## Stage guidance injected

- Decompose: Capture every material claim, fact, relationship, constraint, protected term, and ambiguity before rewriting.
- Rewrite: Return a complete rewrite that follows the decomposition while changing surface structure and phrasing substantially.
- Verify: Compare the rewrite against the decomposition and source, and report concrete omissions, additions, or meaning changes.
- Final: Repair only verified issues, preserve supported meaning, and return the polished document without process commentary.

## Runtime guidance

> Use clear instructions and constraints, and enable deeper thinking for complex semantic comparison when the interface offers it.

## Evidence gaps

The provider page is capability-focused and does not identify a preferred Markdown/XML or source ordering for rewriting. The task-first Markdown strategy is conservative.

## Change log

- **2026-08-11:** Initial GLM-5.1 review and 200K context default.
