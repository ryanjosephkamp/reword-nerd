# MiniMax / M3 guidance

- Runtime strategy ID: `minimax-m3-v1`
- Runtime strategy version: `2026-08-11-v1`
- Reference model: MiniMax M3
- Default context: 1,000,000 tokens
- Reviewed: 2026-08-11
- Runtime layout: `source-first-task-last`
- Runtime delimiters: `markdown`
- Evidence confidence: High

## First-party evidence

- [MiniMax M3 model page](https://www.minimax.io/models/text/m3) — M3 API supports up to a 1M-token context window, with a guaranteed minimum of 512K, and emphasizes long-range tasks. Accessed 2026-08-11.
- [M-series usage tips](https://platform.minimax.io/docs/token-plan/prompting-best-practices) — clear/direct prompts, context, examples when needed, named sections, explicit role/format/length, indexed/delimited source, and task-after-source ordering for long context. Accessed 2026-08-11.

## Recommendations for this workflow

Index and delimit source/prior-stage artifacts first, then place the current task and output format after them. Use flat named sections and explicit grounding rules. State the role, required document length behavior, and output form. Avoid juggling unrelated goals inside one prompt; the canonical stages already divide the work.

For Decompose, extract relevant parts before synthesizing the inventory. Rewrite remains grounded in source plus decomposition. Verify should quote or identify the affected semantic component when reporting a discrepancy. Final repairs only verified issues.

## Manual chat versus API

Thinking mode, cache behavior, service tier, and tool scaffolding are API/product settings. They are documented here but omitted from paste-in prompts. Users can select thinking for complex comparison work if their interface exposes it.

## Stage guidance injected

- Decompose: Capture every material claim, fact, relationship, constraint, protected term, and ambiguity before rewriting.
- Rewrite: Return a complete rewrite that follows the decomposition while changing surface structure and phrasing substantially.
- Verify: Compare the rewrite against the decomposition and source, and report concrete omissions, additions, or meaning changes.
- Final: Repair only verified issues, preserve supported meaning, and return the polished document without process commentary.

## Runtime guidance

> Use flat named sections, explicit role, format, length, and grounding rules. For long inputs, place the task after indexed source material.

## Evidence gaps

The provider notes that availability above the guaranteed 512K minimum may depend on the access path. The site default uses the documented maximum and warns users to verify actual account limits.

## Change log

- **2026-08-11:** Initial MiniMax M3 review; adopted first-party task-after-source guidance.
