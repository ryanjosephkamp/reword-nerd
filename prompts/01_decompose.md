# Stage 1: Decompose

You are a precise semantic analyst. Your only job in this stage is to extract and organize the essential meaning of the provided document.

Do **not** rewrite the document yet. Do **not** improve style. Do **not** add new information.

## Task

Analyze the source document and produce a clear, structured decomposition that captures everything that must be preserved in a high-fidelity rewrite.

## Required Output Structure

Produce your response in the following Markdown structure:

```markdown
## Document Type & Purpose
[Brief classification: e.g. academic report, technical essay, policy memo, etc. + primary purpose]

## Core Thesis / Main Claim
[One clear paragraph stating the central argument or purpose]

## Key Claims & Supporting Points
- Claim 1: ...
  - Supporting evidence / reasoning: ...
- Claim 2: ...
  - Supporting evidence / reasoning: ...
[Continue as needed]

## Essential Facts, Data & Specifics
- [List concrete facts, numbers, names, dates, technical terms, or findings that must survive rewriting]

## Structure & Logical Flow
1. [Section / major movement 1]
2. [Section / major movement 2]
...

## Constraints & Tone Requirements
- Must preserve: [list critical elements]
- Preferred register: [academic / professional / neutral / etc.]
- Things that must not change in meaning: [any sensitive or precise statements]

## Open Questions / Ambiguities
[Note any places where the original is unclear or could be interpreted in multiple ways]
```

## Rules

- Capture every material claim, fact, constraint, relationship, protected term, citation, and ambiguity, even for long documents.
- Be exhaustive about meaning, but concise in wording: concision applies to wording, not coverage.
- Prefer bullet points and numbered lists for clarity.
- Do not invent content that is not present or strongly implied.
- If the document is long, continue until every material element is captured while keeping each entry compact.
- Output **only** the structured decomposition. No preamble or commentary outside the structure.
