# DeepSeek / V4 Pro guidance

- Runtime strategy ID: `deepseek-v4-pro-v1`
- Runtime strategy version: `2026-08-11-v1`
- Reference model: DeepSeek V4 Pro
- Default context: 1,000,000 tokens
- Reviewed: 2026-08-11
- Runtime layout: `task-first`
- Runtime delimiters: `markdown`
- Evidence confidence: Medium

## First-party evidence

- [DeepSeek V4 Preview release](https://api-docs.deepseek.com/news/news260424/) — V4 Pro is the capability-oriented V4 model; official services use a 1M context window and expose thinking/non-thinking modes through OpenAI- and Anthropic-compatible APIs. Accessed 2026-08-11.
- [DeepSeek API change log](https://api-docs.deepseek.com/updates) — confirms V4 Pro availability and supported API interfaces. Accessed 2026-08-11.

## Recommendations for this workflow

The provider publishes capability and API material but limited model-specific prompt-engineering evidence. reword-nerd therefore uses cautious, broadly supported controls: name the role and current stage, delimit source and prior-stage material, state semantic-fidelity constraints, and define the response contract. Do not rely on implicit awareness of the four-stage workflow.

For long source material, keep headings stable and make the evidence boundary explicit. Decompose and Verify benefit from the model’s reasoning capability, but the prompt should ask for observable artifacts rather than hidden chain of thought. Rewrite and Final should return complete documents.

## Manual chat versus API

Thinking/non-thinking mode is an API or product selection, not a prompt instruction. The generated package contains no provider endpoint, authentication, sampling, or mode setting. API users can evaluate thinking mode for the comparison-heavy stages.

## Stage guidance injected

- Decompose: Capture every material claim, fact, relationship, constraint, protected term, and ambiguity before rewriting.
- Rewrite: Return a complete rewrite that follows the decomposition while changing surface structure and phrasing substantially.
- Verify: Compare the rewrite against the decomposition and source, and report concrete omissions, additions, or meaning changes.
- Final: Repair only verified issues, preserve supported meaning, and return the polished document without process commentary.

## Runtime guidance

> Define the role, current stage, source boundaries, constraints, and required output explicitly. Keep the staged workflow unambiguous.

## Evidence gaps

No reviewed first-party DeepSeek V4 Pro prompt guide directly recommends a particular delimiter or task position. The Markdown task-first layout is a conservative inference, not a provider claim.

## Change log

- **2026-08-11:** Initial DeepSeek V4 Pro review; marked prompt-tactic confidence medium.
