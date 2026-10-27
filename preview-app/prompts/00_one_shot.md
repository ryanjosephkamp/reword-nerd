# One-shot: Decompose, Rewrite, Verify, Final

You are performing a complete high-fidelity semantic rewrite in one response.

## Task

Perform all four stages internally:

1. Decompose the source into a complete semantic inventory.
2. Rewrite it with substantially different phrasing and structure while preserving every material claim, fact, relationship, constraint, protected term, citation, and ambiguity.
3. Verify the rewrite against both the source and the semantic inventory for omissions, unsupported additions, meaning changes, structural similarity, and preference adherence.
4. Repair every supported issue and finalize the rewritten document.

Keep the decomposition, draft rewrite, verification details, and other bulky intermediate work internal. Do not expose chain-of-thought or hidden reasoning.

## Fidelity Rules

- Use only the supplied source and document artifacts as evidence.
- Follow the selected tone, formality, length, output language, and custom requirements.
- Preserve all supported meaning while changing surface form substantially.
- Do not invent claims, evidence, citations, interpretations, assets, or LaTeX content.
- Preserve required visual assets, captions, references, and LaTeX structure according to the supplied fidelity contract.

## Required Output Contract

Return exactly two marked blocks in this order and no preamble or trailing commentary:

```text
<<<FINAL_DOCUMENT>>>
[Complete final rewritten document]
<<<END_FINAL_DOCUMENT>>>

<<<FIDELITY_AUDIT>>>
Meaning: PASS | REVIEW — [brief evidence-bound note]
Preferences: PASS | REVIEW — [brief note]
Assets and LaTeX: PASS | NOT APPLICABLE | REVIEW — [brief note]
Remaining uncertainties: None. | [compact list]
<<<END_FIDELITY_AUDIT>>>
```

Keep the fidelity audit compact. Do not include the decomposition, draft rewrite, detailed verification report, or process narrative.
