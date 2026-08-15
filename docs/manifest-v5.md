# Prompt package manifest v5

> Historical contract. Current `0.8.0` packages use [manifest schema v6](manifest-v6.md).

Manifest schema `5` is the historical `reword-nerd` `0.5.1` contract. The package
format remains the literal `dual-mode-prompt-package`, with both One-shot and
Manual workflows and the canonical Manual stage order.

The application footer and Info dialog source `0.5.1` from package metadata via
`APP_VERSION`; the manifest's `package.version` is required to match that release.

## Root contract

```json
{
  "schemaVersion": 5,
  "package": {
    "name": "reword-nerd",
    "version": "0.5.1",
    "format": "dual-mode-prompt-package"
  },
  "archive": {
    "entryOrder": "lexicographic-code-unit-ascending",
    "timestamp": "1980-01-01T00:00:00.000Z",
    "originalCompression": "STORE",
    "generatedCompression": "DEFLATE-9"
  },
  "workflow": {
    "modes": ["one-shot", "manual"],
    "manualStages": ["decompose", "rewrite", "verify", "final"],
    "responseMarkers": {
      "stage1": "<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>",
      "stage2": "<<<INSERT_STAGE_2_REWRITE_RESPONSE>>>",
      "stage3": "<<<INSERT_STAGE_3_VERIFICATION_RESPONSE>>>"
    }
  },
  "rootArtifacts": {
    "readme": { "path": "README.md", "sha256": "..." },
    "openMe": { "path": "OPEN-ME.html", "sha256": "..." }
  },
  "documents": []
}
```

Root `OPEN-ME.html` is a standalone no-script index. Root `README.md` is
serialized from the immutable semantic runbook and is the exact prefix of each
One-shot, Manual, and combined Markdown workbook. Both root artifacts are
hashed.

## Schema-v5 document tree

Each document uses this exact nested tree; schema v5 removes the former
`documents/<key>/prompts/` directory:

```text
documents/<key>/
├── original.<ext>
├── reviewed-extraction.md
├── one-shot/
│   ├── 00-one-shot.md
│   ├── one-shot-prompt.md
│   └── one-shot-prompt.html
├── manual-prompts/
│   ├── 01-decompose.md
│   ├── 02-rewrite.md
│   ├── 03-verify.md
│   ├── 04-final.md
│   ├── manual-prompts.md
│   └── manual-prompts.html
├── combined-prompts/
│   ├── combined-prompts.md
│   ├── combined-prompts.html
│   └── combined-prompts-full.html  # only when generated
├── assets/
├── ocr/
└── project/                        # safe LaTeX project only
```

Each record otherwise retains v4 provenance: stable key and ordinal, original
and reviewed extraction hashes, resolved settings, model and prompt-strategy
metadata, context estimates, five canonical prompt hashes, processing options,
asset and OCR provenance, optional LaTeX metadata, and workbook hashes.
`combined.fullHtml` is either `{ "status": "generated", "path", "sha256" }`
or `{ "status": "not-generated", "reason": "encoded-size-limit" }`.

## Archive, runbook, and workbook rules

- Entries are traversal-safe, sorted by lexicographic code-unit order, use the
  fixed `1980-01-01T00:00:00.000Z` timestamp and UNIX `100644`, and never add
  directory entries.
- Original, included media, and safe LaTeX project bytes use STORE. Generated
  Markdown, HTML, and JSON use DEFLATE level 9.
- Equivalent reviewed inputs and settings produce byte-identical ZIPs.
- The immutable semantic runbook represents headings, paragraphs, tables,
  ordered/unordered lists, fenced code blocks, and inline text/code/links. It is
  serialized independently to Markdown and escaped HTML; archive-relative links
  are validated before serialization.
- Combined HTML has README, ONE-SHOT, and MANUAL tabs with README selected by
  default. Arrow keys plus Home and End use roving focus. Each single-workflow
  HTML companion includes the runbook and all content needed for that workflow.
- Full-HTML eligibility only moves from generated to not generated, and the
  package rerenders until manifest status, runbook text, and final bytes agree.
- HTML remains local-only: strict CSP, no external resources, no automatic
  storage, escaped content, and no application network requests.
- Downloaded progress copies retain validated progress schema `1` and remain
  separate sensitive files rather than archive entries or automatic saves.
- The application logo, favicons, posters, and Help videos are site assets and
  are never archive entries.

Schemas [v1](manifest-v1.md), [v2](manifest-v2.md), [v3](manifest-v3.md), and
[v4](manifest-v4.md) remain historical and unchanged.
