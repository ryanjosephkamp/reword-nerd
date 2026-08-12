# Anthropic / Claude guidance

- Runtime strategy ID: `anthropic-claude-v1`
- Runtime strategy version: `2026-08-11-v1`
- One-shot guidance version: `2026-08-11-v1`
- Reference model: Claude Opus 5
- Default context: 1,000,000 tokens
- Reviewed: 2026-08-11
- Runtime layout: `source-first-task-last`
- Runtime delimiters: `xml`
- Evidence confidence: High

## First-party evidence

- [Prompting Claude Opus 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5) — 1M context, explicit scope and deliverable-length controls, and advice to remove redundant self-verification instructions. Accessed 2026-08-11.
- [What’s new in Claude Opus 5](https://platform.claude.com/docs/en/about-claude/models/whats-new-opus-5) — 1M default/maximum context and 128K maximum output. Accessed 2026-08-11.

## Recommendations for this workflow

Use descriptive XML containers for source, decomposition, draft, and preferences. In long-document stages, put the source/prior response before the final task and output contract so the immediate instruction is close to generation. Give the full specification up front, constrain scope, and calibrate output length explicitly.

Claude Opus 5 is documented as self-correcting readily. reword-nerd therefore retains its canonical Verify stage—an essential user-visible stage—but does not add extra generic instructions to “double-check” or invent further verification loops. Decompose and Verify should be complete and concrete; Rewrite and Final should return the requested artifact without padded commentary.

## Manual chat versus API

Thinking effort, prompt caching, and platform-specific features remain outside paste-in prompts. The source-first/XML organization works in both manual and API interfaces. API users can tune effort on representative documents; the provider notes that lower effort can remain strong, while `xhigh` is for especially demanding work.

## Stage guidance injected

- Decompose: Capture every material claim, fact, relationship, constraint, protected term, and ambiguity before rewriting.
- Rewrite: Return a complete rewrite that follows the decomposition while changing surface structure and phrasing substantially.
- Verify: Compare the rewrite against the decomposition and source, and report concrete omissions, additions, or meaning changes.
- Final: Repair only verified issues, preserve supported meaning, and return the polished document without process commentary.

## Runtime guidance

> Use descriptive XML tags to separate inputs. For long documents, place source material before the task. State the required deliverable and length explicitly, without redundant self-verification instructions.

## One-shot guidance injected

Inference from Anthropic's first-party long-context, output-format, and non-redundancy guidance above; Anthropic does not benchmark this exact rewrite workflow.

> Keep the source before the one-shot task, use the named output markers exactly, perform the staged checks internally, and keep the visible audit concise.

## Evidence gaps

The provider’s source-first recommendation is broader Claude guidance rather than a controlled benchmark on this exact workflow. Claude product plans can expose different feature and usage limits even though the API model window is 1M.

## Change log

- **2026-08-11:** Added versioned One-shot guidance from the current first-party prompt guidance.
- **2026-08-11:** Initial Claude Opus 5 review; selected XML and source-first/task-last layout.
