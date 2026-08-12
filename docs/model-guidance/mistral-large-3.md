# Mistral / Large 3 guidance

- Runtime strategy ID: `mistral-large-3-v1`
- Runtime strategy version: `2026-08-11-v1`
- One-shot guidance version: `2026-08-11-v1`
- Reference model: Mistral Large 3
- Default context: 256,000 tokens
- Reviewed: 2026-08-11
- Runtime layout: `task-first`
- Runtime delimiters: `markdown`
- Evidence confidence: High

## First-party evidence

- [Mistral prompting guide](https://docs.mistral.ai/studio-api/conversations/chat-completion/prompting) — define a clear purpose/role, make the prompt complete for a reader with no outside context, and use examples where the behavior needs demonstration. Accessed 2026-08-11.
- [Mistral known limitations](https://docs.mistral.ai/resources/known-limitations) — Mistral Large 3 has a 256K maximum context; input and output share the budget. Accessed 2026-08-11.

## Recommendations for this workflow

Start with the current purpose and stage. Use hierarchical Markdown headings to keep requirements and artifacts legible. Replace vague quality language with measurable fidelity and output requirements. Supply every fact the stage needs because the prompt should be executable without assumed outside context.

The 256K budget is smaller than most other curated defaults, so keep instructions economical and pay attention to the in-app warning. Decompose and Verify should be explicit about the categories they must cover; Rewrite and Final should produce the complete requested text.

## Manual chat versus API

JSON mode, function calling, and API token limits are not injected. The package’s Markdown response markers are portable and avoid relying on API-only schemas. API users must budget output within the same 256K context envelope.

## Stage guidance injected

- Decompose: Capture every material claim, fact, relationship, constraint, protected term, and ambiguity before rewriting.
- Rewrite: Return a complete rewrite that follows the decomposition while changing surface structure and phrasing substantially.
- Verify: Compare the rewrite against the decomposition and source, and report concrete omissions, additions, or meaning changes.
- Final: Repair only verified issues, preserve supported meaning, and return the polished document without process commentary.

## Runtime guidance

> Start with a precise purpose, organize instructions hierarchically, use measurable requirements, and avoid subjective or contradictory wording.

## One-shot guidance injected

Inference from Mistral's first-party completeness and measurable-output guidance above; Mistral does not benchmark this exact rewrite workflow.

> Use the explicit four-stage procedure as an internal checklist and return only the measurable two-part output contract without intermediate prose.

## Evidence gaps

The reviewed guide is general to Mistral models rather than a Large-3-specific rewriting evaluation. No provider recommendation established XML or source-last as superior, so runtime remains task-first Markdown.

## Change log

- **2026-08-11:** Added versioned One-shot guidance from the current first-party prompt guidance.
- **2026-08-11:** Initial Mistral Large 3 review and 256K context default.
