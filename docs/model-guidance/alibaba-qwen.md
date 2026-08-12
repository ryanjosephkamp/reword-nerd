# Alibaba / Qwen guidance

- Runtime strategy ID: `alibaba-qwen-v1`
- Runtime strategy version: `2026-08-11-v1`
- One-shot guidance version: `2026-08-11-v1`
- Reference model: Qwen3.7 Max
- Default context: 1,000,000 tokens
- Reviewed: 2026-08-11
- Runtime layout: `task-first`
- Runtime delimiters: `markdown`
- Evidence confidence: High for capabilities; medium-high for prompt tactics

## First-party evidence

- [Qwen3.7 Max model information](https://www.alibabacloud.com/help/en/model-studio/qwen3-7-max) — 1M context, 991,808 maximum input, 65,536 maximum output, thinking/non-thinking operation, and no native structured-output support. Accessed 2026-08-11.
- [Alibaba Model Studio FAQ](https://www.alibabacloud.com/help/en/model-studio/faq-about-alibaba-cloud-model-studio) — recommends strict grounding in supplied documents, citations where relevant, roles, and decomposing tasks into steps to reduce unsupported claims. Accessed 2026-08-11.
- [Alibaba Model Studio text-to-text prompt guide](https://www.alibabacloud.com/help/en/model-studio/prompt-engineering-guide) — recommends clear, specific tasks and delimited long document blocks. Accessed 2026-08-11.

## Recommendations for this workflow

Use one clear stage task, flat named Markdown sections, explicit constraints, and a concrete output contract. Do not depend on a JSON/structured-output feature for the manual workflow; the canonical response markers provide portable handoff boundaries. Tell the model that the supplied source and prior artifacts are the exclusive evidence base.

Decomposition should enumerate claims and constraints before rewrite. Rewrite should follow that inventory without importing facts. Verify should call out unsupported additions and omissions with direct references to the artifacts. Final should repair only verified issues and emit the document.

## Manual chat versus API

Thinking mode, context caching, prefix completion, and regional API endpoints are API choices and are not added to the prompts. An API integration may choose thinking for complex decomposition/verification, but reword-nerd remains model-call-free.

## Stage guidance injected

- Decompose: Capture every material claim, fact, relationship, constraint, protected term, and ambiguity before rewriting.
- Rewrite: Return a complete rewrite that follows the decomposition while changing surface structure and phrasing substantially.
- Verify: Compare the rewrite against the decomposition and source, and report concrete omissions, additions, or meaning changes.
- Final: Repair only verified issues, preserve supported meaning, and return the polished document without process commentary.

## Runtime guidance

> Use a clear task, named sections, explicit constraints, and a concrete output contract. Keep instructions direct and internally consistent.

## One-shot guidance injected

Inference from the first-party grounding, structure, and task-decomposition guidance above; Alibaba does not benchmark this exact rewrite workflow.

> Run the four stages as one grounded workflow, keep intermediate analysis internal, and return only the marked final document and compact fidelity audit.

## Evidence gaps

Alibaba documents general grounding and task-decomposition practices, not a Qwen3.7-Max-specific rewriting study. Structured output is listed as unsupported on the reviewed model page, reinforcing use of portable text markers.

## Change log

- **2026-08-11:** Added versioned One-shot guidance from the current first-party prompt guidance.
- **2026-08-11:** Initial Qwen3.7 Max review and runtime strategy.
