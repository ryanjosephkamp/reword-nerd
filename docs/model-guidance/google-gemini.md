# Google / Gemini guidance

- Runtime strategy ID: `google-gemini-v1`
- Runtime strategy version: `2026-08-11-v1`
- One-shot guidance version: `2026-08-11-v1`
- Reference model: Gemini 3.1 Pro Preview
- Default context: 1,048,576 tokens
- Reviewed: 2026-08-11
- Runtime layout: `source-first-task-last`
- Runtime delimiters: `xml`
- Evidence confidence: High

## First-party evidence

- [Gemini 3.1 Pro Preview model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview) — 1,048,576 input tokens, 65,536 output tokens, structured outputs, thinking, PDF input, and preview status. Accessed 2026-08-11.
- [Gemini prompt design strategies](https://ai.google.dev/gemini-api/docs/prompting-strategies) — consistent sections, explicit formats, and context-first ordering for large inputs. Accessed 2026-08-11.
- [Gemini long context](https://ai.google.dev/gemini-api/docs/long-context) — supply relevant information directly and put the query at the end for long context. Accessed 2026-08-11.

## Recommendations for this workflow

Place the reviewed source and prior-stage output first, separated by stable descriptive tags, then put the current canonical task, constraints, and response marker at the end. Define any ambiguous requirement and explicitly state desired verbosity and output structure. Keep section names consistent across all four stages.

The source-first/task-last layout is particularly suitable for Decompose and Rewrite because the stage instruction stays nearest to the response boundary. Verify should ground every issue in the supplied source/decomposition rather than outside knowledge. Final should return only the repaired document.

## Manual chat versus API

The prompts do not request Gemini API structured-output schemas, thinking budgets, caching, file upload, or grounding tools. Those are API/product controls. XML-like tags here are plain text delimiters and remain pasteable in a chat UI.

## Stage guidance injected

- Decompose: Capture every material claim, fact, relationship, constraint, protected term, and ambiguity before rewriting.
- Rewrite: Return a complete rewrite that follows the decomposition while changing surface structure and phrasing substantially.
- Verify: Compare the rewrite against the decomposition and source, and report concrete omissions, additions, or meaning changes.
- Final: Repair only verified issues, preserve supported meaning, and return the polished document without process commentary.

## Runtime guidance

> Use consistent structured sections, define ambiguous terms and output verbosity, and place the specific task after long source context.

## One-shot guidance injected

Inference from Google's first-party structured-prompt and long-context ordering guidance above; Google does not benchmark this exact rewrite workflow.

> Place long source context before the one-shot task, complete all stages internally, and return the final document plus a compact marked audit.

## Evidence gaps

Gemini 3.1 Pro is a preview model and may change or be replaced. The 1,048,576-token figure is an API limit, not a promise for every consumer product or account.

## Change log

- **2026-08-11:** Added versioned One-shot guidance from the current first-party prompt guidance.
- **2026-08-11:** Initial Gemini 3.1 Pro Preview review; selected source-first XML layout.
