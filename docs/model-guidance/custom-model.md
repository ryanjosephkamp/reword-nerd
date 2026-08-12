# Custom model guidance

- Runtime strategy ID: `custom-neutral-v1`
- Runtime strategy version: `2026-08-11-v1`
- One-shot guidance version: `2026-08-11-v1`
- Reference model: User supplied
- Default context: Unknown; editable
- Reviewed: 2026-08-11
- Runtime layout: `task-first`
- Runtime delimiters: `markdown`
- Evidence confidence: Design policy rather than provider evidence

## Scope

Custom model covers local, self-hosted, fine-tuned, experimental, and otherwise unlisted models. Because the selected model and its instruction-tuning format are unknown, reword-nerd does not assume XML affinity, hidden reasoning controls, a tokenizer, or a context size.

## Recommendations

Use a conservative, provider-neutral structure: one current task, plainly named input sections, explicit fidelity constraints, and a concrete output contract. Keep each of the four stages self-contained. Avoid provider-specific control tokens, chat-template syntax, and API parameters. Users should set the editable context limit from their serving stack and should consult that model’s own card when available.

For rewriting, name the source and prior-stage artifacts and require fidelity to them. For verification, ask for concrete omissions, unsupported additions, and meaning changes. For the final stage, require only the repaired document. These are workflow requirements, not claims about a particular model’s ideal prompt style.

## Manual chat versus API

The generated prompts are safe to paste into a chat interface or local frontend. Serving parameters such as temperature, top-p, repetition penalty, chat templates, and context truncation belong to the user’s runtime and are intentionally not injected.

## Stage guidance injected

- Decompose: Capture every material claim, fact, relationship, constraint, protected term, and ambiguity before rewriting.
- Rewrite: Return a complete rewrite that follows the decomposition while changing surface structure and phrasing substantially.
- Verify: Compare the rewrite against the decomposition and source, and report concrete omissions, additions, or meaning changes.
- Final: Repair only verified issues, preserve supported meaning, and return the polished document without process commentary.

## Runtime guidance

> Use a conservative provider-neutral prompt structure with explicit stages, named inputs, constraints, and output requirements.

## One-shot guidance injected

Design-policy inference only. No provider-specific evidence can apply until the user identifies the custom model and its current model card.

> Perform all four stages internally in one request and emit only the marked final document plus a short evidence-bound fidelity audit.

## Evidence gaps

All model-specific behavior is unknown. Smaller or base models may need shorter inputs, examples, a native chat template, or a more constrained output. The context estimate is only a rough cross-tokenizer heuristic.

## Change log

- **2026-08-11:** Added versioned provider-neutral One-shot guidance.
- **2026-08-11:** Consolidated the former Local and Custom choices into one provider-neutral profile.
