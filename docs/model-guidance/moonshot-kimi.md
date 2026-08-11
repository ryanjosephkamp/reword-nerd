# MoonshotAI / Kimi guidance

- Runtime strategy ID: `moonshot-kimi-v1`
- Runtime strategy version: `2026-08-11-v1`
- Reference model: Kimi K3
- Default context: 1,000,000 tokens
- Reviewed: 2026-08-11
- Runtime layout: `task-first`
- Runtime delimiters: `markdown`
- Evidence confidence: Medium-high

## First-party evidence

- [Moonshot AI model index](https://www.moonshot.ai/) — lists Kimi K3 as the July 2026 flagship. Accessed 2026-08-11.
- [Kimi K3 technical blog](https://www.kimi.com/blog/kimi-k3) — 1M-token context and long-horizon knowledge-work capability. Accessed 2026-08-11.
- [Kimi API prompt best practices](https://platform.moonshot.ai/docs/guide/prompt-best-practice) — include important details/context, define roles, delimit references, provide explicit steps, and specify output length. Accessed 2026-08-11.

## Recommendations for this workflow

State the current stage and deliverable explicitly, then provide clearly delimited reference artifacts, exact constraints, and expected length/format. Preserve the existing stage sequence rather than asking Kimi to conduct all work in one undifferentiated request. Require source grounding in every stage.

Decompose should expose the semantic structure. Rewrite should use the decomposition as a binding plan. Verify should enumerate grounded discrepancies. Final should repair those discrepancies and return only the document.

## Manual chat versus API

Kimi’s API, caching, thinking behavior, and any product-specific long-context tier are not encoded in prompts. Users should confirm that their chosen Kimi access path exposes the full context default.

## Stage guidance injected

- Decompose: Capture every material claim, fact, relationship, constraint, protected term, and ambiguity before rewriting.
- Rewrite: Return a complete rewrite that follows the decomposition while changing surface structure and phrasing substantially.
- Verify: Compare the rewrite against the decomposition and source, and report concrete omissions, additions, or meaning changes.
- Final: Repair only verified issues, preserve supported meaning, and return the polished document without process commentary.

## Runtime guidance

> Give clear instructions, delimit reference text, define the steps and output length, and ground each stage in the supplied document artifacts.

## Evidence gaps

The prompt guide predates K3 and is not a K3-specific controlled study. The current task-first Markdown layout follows the documented general practices but should be reevaluated when K3-specific prompting documentation appears.

## Change log

- **2026-08-11:** Initial Kimi K3 model review with Moonshot’s general prompt guidance.
