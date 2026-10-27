# Meta / Muse guidance

- Runtime strategy ID: `meta-muse-v1`
- Runtime strategy version: `2026-08-11-v1`
- One-shot guidance version: `2026-08-11-v1`
- Reference model: Muse Spark 1.1
- Default context: 1,000,000 tokens
- Reviewed: 2026-08-11
- Runtime layout: `task-first`
- Runtime delimiters: `markdown`
- Evidence confidence: Medium

## First-party evidence

- [Introducing Muse Spark 1.1](https://ai.meta.com/blog/introducing-muse-spark-meta-model-api/) — multimodal reasoning and agentic model, public-preview Meta Model API, 1M actively managed context, structured procedural-workflow capability, and long-horizon work. Accessed 2026-08-11.

## Recommendations for this workflow

Meta’s launch material establishes capability but does not publish a detailed general-purpose prompt guide. reword-nerd uses a concise task-first layout with named scope, source, constraints, and deliverable. Each prompt confines the model to one canonical stage so its broader agentic tendencies do not expand the workflow.

The source and prior-stage response remain the evidence base. Decompose should inventory content before any rewrite. Verify should identify concrete discrepancies rather than start an open-ended research task. Final should stop after the polished document.

## Manual chat versus API

Thinking mode, tool use, multi-agent orchestration, context compaction, and structured output are product/API capabilities. They are not assumed by the manual prompt package. No Meta-specific control tokens are injected.

## Stage guidance injected

- Decompose: Capture every material claim, fact, relationship, constraint, protected term, and ambiguity before rewriting.
- Rewrite: Return a complete rewrite that follows the decomposition while changing surface structure and phrasing substantially.
- Verify: Compare the rewrite against the decomposition and source, and report concrete omissions, additions, or meaning changes.
- Final: Repair only verified issues, preserve supported meaning, and return the polished document without process commentary.

## Runtime guidance

> State the scope, constraints, and complete deliverable concisely. Keep the model focused on the current stage and supplied evidence.

## One-shot guidance injected

Inference from Meta's first-party description of long-context procedural workflows above; Meta does not publish prompt-design evidence for this exact rewrite workflow.

> Treat the request as one bounded four-stage procedure, retain intermediates internally, and emit only the marked final document and concise audit.

## Evidence gaps

The reviewed first-party announcement does not establish whether Muse prefers Markdown, XML, task-first, or task-last prompting for long documents. The selected layout is deliberately conventional and should be revisited when Meta publishes prompt-specific guidance.

## Change log

- **2026-08-11:** Added versioned One-shot guidance from the current first-party release material.
- **2026-08-11:** Initial Muse Spark 1.1 capability review; prompt-specific evidence gap recorded.
