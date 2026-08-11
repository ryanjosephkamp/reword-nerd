# OpenAI / ChatGPT guidance

- Runtime strategy ID: `openai-chatgpt-v1`
- Runtime strategy version: `2026-08-11-v1`
- Reference model: GPT-5.6 Sol
- Default context: 1,050,000 tokens
- Reviewed: 2026-08-11
- Runtime layout: `task-first`
- Runtime delimiters: `markdown`
- Evidence confidence: High

## First-party evidence

- [GPT-5.6 Sol model page](https://developers.openai.com/api/docs/models/gpt-5.6-sol) — 1,050,000-token context, 128,000 maximum output, structured outputs and reasoning support. Accessed 2026-08-11.
- [GPT-5.6 model guidance](https://developers.openai.com/api/docs/guides/latest-model) — favors lean prompts, each instruction stated once, explicit outcome and boundaries, and task-specific output length/structure. Accessed 2026-08-11.

## Recommendations for this workflow

Use a lean task-first prompt. State the current stage and fidelity boundary once, then provide named source and prior-stage artifacts. Preserve product requirements—semantic equivalence, four-stage ordering, response markers, and output-only final delivery—but avoid repeating them as motivational prose. Specify the result form and any length requirement explicitly.

For decomposition, ask for the complete inspectable semantic inventory. For rewrite, bind the output to that inventory and source rather than asking the model to rediscover requirements. For verification, give concrete comparison categories. For the final pass, ask for the document only. This staged design supplies clear success criteria without prescribing unnecessary hidden reasoning.

## Long context

The model accepts 1.05M tokens, but prompts over 272K input tokens have different API pricing. reword-nerd keeps the canonical task concise and provides the full reviewed source because fidelity matters. Users should still heed the in-app estimate and split documents if their chat product exposes a smaller practical limit.

## Manual chat versus API

Manual prompts do not include `reasoning.effort`, `reasoning.mode`, `text.verbosity`, explicit caching breakpoints, or persisted-reasoning controls. The API guide recommends choosing these by evaluation; those settings are not portable to ChatGPT paste-in workflows. For a difficult verification pass, an API user can evaluate higher reasoning effort separately.

## Stage guidance injected

- Decompose: Capture every material claim, fact, relationship, constraint, protected term, and ambiguity before rewriting.
- Rewrite: Return a complete rewrite that follows the decomposition while changing surface structure and phrasing substantially.
- Verify: Compare the rewrite against the decomposition and source, and report concrete omissions, additions, or meaning changes.
- Final: Repair only verified issues, preserve supported meaning, and return the polished document without process commentary.

## Runtime guidance

> Keep the prompt lean and state each instruction once. Specify the outcome, relevant context, constraints, evidence boundary, and output format.

## Evidence gaps

The official guide is API-oriented; ChatGPT product behavior and plan-specific context can differ. No first-party result specifically benchmarks semantic rewriting with this four-stage package.

## Change log

- **2026-08-11:** Initial GPT-5.6 Sol review and runtime strategy.
