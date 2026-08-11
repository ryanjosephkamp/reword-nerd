# xAI / Grok guidance

- Runtime strategy ID: `xai-grok-v1`
- Runtime strategy version: `2026-08-11-v1`
- Reference model: Grok 4.5
- Default context: 500,000 tokens
- Reviewed: 2026-08-11
- Runtime layout: `task-first`
- Runtime delimiters: `markdown`
- Evidence confidence: Medium

## First-party evidence

- [Grok 4.5 guide](https://docs.x.ai/developers/grok-4-5) — frontier coding/agentic/knowledge-work model, low/medium/high reasoning settings, and API caching recommendation. Accessed 2026-08-11.
- [Grok 4.5 model page](https://docs.x.ai/developers/models/grok-4.5) — 500K context, structured outputs, and reasoning. Accessed 2026-08-11.

## Recommendations for this workflow

xAI’s reviewed material demonstrates short, direct task examples but provides limited rewriting-specific prompt guidance. Use a minimal task-first prompt that names the current result, source boundary, fidelity constraints, and output form. Avoid redundant process directions.

For verification, users with an exposed reasoning control can consider stronger reasoning, but the prompt itself requests an inspectable discrepancy report rather than chain of thought. Final returns only the repaired document.

## Manual chat versus API

`reasoning_effort`, `prompt_cache_key`, `x-grok-conv-id`, compaction, tools, and structured-output settings are API controls. They remain documented rather than embedded so the prompts work in manual chat.

## Stage guidance injected

- Decompose: Capture every material claim, fact, relationship, constraint, protected term, and ambiguity before rewriting.
- Rewrite: Return a complete rewrite that follows the decomposition while changing surface structure and phrasing substantially.
- Verify: Compare the rewrite against the decomposition and source, and report concrete omissions, additions, or meaning changes.
- Final: Repair only verified issues, preserve supported meaning, and return the polished document without process commentary.

## Runtime guidance

> Use a minimal direct task with explicit source boundaries and result format. Use stronger reasoning settings for the verification stage when the interface offers them.

## Evidence gaps

No reviewed first-party prompt guide establishes a preferred delimiter/layout for long-form semantic rewriting. The runtime strategy is a cautious inference from official examples and capability documentation.

## Change log

- **2026-08-11:** Initial Grok 4.5 review; separated caching/reasoning API advice from manual prompts.
