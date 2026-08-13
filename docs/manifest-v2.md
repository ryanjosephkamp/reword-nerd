# Manifest v2

> Historical contract. Current `0.7.0` packages use [manifest schema v6](manifest-v6.md).

Every package includes `manifest.json` at its archive root. Schema v2 extends
the historical [v1 contract](manifest-v1.md) with combined companion artifacts
and versioned prompt-strategy provenance.

## Root structure

```json
{
  "schemaVersion": 2,
  "package": {
    "name": "reword-nerd",
    "version": "0.2.0",
    "format": "manual-four-stage-prompt-package"
  },
  "archive": {},
  "workflow": {},
  "documents": []
}
```

`archive` records lexicographic code-unit entry ordering, the fixed
`1980-01-01T00:00:00.000Z` timestamp, `STORE` for original uploads, and
`DEFLATE-9` for generated entries. `workflow` records manual mode, the ordered
Decompose → Rewrite → Verify → Final stages, and the three exact response
markers that carry earlier outputs forward.

## Document record

Each `documents` record contains:

| Field | Meaning |
| --- | --- |
| `key` | Safe archive directory key derived from normalized display name and source digest. |
| `exportOrdinal` | Zero-based deterministic export position. |
| `originalDisplayName` | Untrusted display name shown to the user; never used directly as an archive path. |
| `format` | `text`, `markdown`, `docx`, or `pdf`. |
| `original` | Path, byte count, and SHA-256 of exact uploaded bytes. |
| `reviewedExtraction` | Path, Unicode-code-point count, SHA-256, and safe extraction warnings. |
| `settings` | Resolved tone, formality, length, output language, and normalized custom requirements. |
| `model` | Stable profile lineage, display metadata, context default, review date, and workflow note. |
| `model.promptStrategy` | Strategy ID, independent version, reference model, and review date. |
| `contextAssessment` | Conservative workflow estimate, limit, ratio, and oversize state. |
| `contextWarningAcknowledged` | Whether the current estimate warning was explicitly acknowledged. |
| `prompts` | Path and SHA-256 for each exact canonical rendered prompt. |
| `combined.markdown` | Path and SHA-256 for the self-contained Markdown companion. |
| `combined.html` | Path and SHA-256 for the standalone no-network HTML companion. |

The full guidance document path is intentionally maintained in repository
source rather than copied into the manifest. The stable strategy fields are
sufficient to resolve provenance against a tagged reword-nerd release.

## Archive paths

The root contains `README.md` and `manifest.json`. Each `<key>` directory has:

```text
documents/<key>/original.<extension>
documents/<key>/reviewed-extraction.md
documents/<key>/prompts/01-decompose.md
documents/<key>/prompts/02-rewrite.md
documents/<key>/prompts/03-verify.md
documents/<key>/prompts/04-final.md
documents/<key>/combined-prompts.md
documents/<key>/combined-prompts.html
```

The root `README.md` bytes are the exact prefix of every combined Markdown
artifact. The four prompt strings in each combined artifact are byte-for-byte
equal to the corresponding individual prompt entries. Markdown uses a minimum
four-backtick fence and grows it beyond the longest contained backtick run.
HTML escapes all untrusted text, includes only inline CSS/script, and copies
from each prompt block’s `textContent`.

## Hashes, snapshots, and reproducibility

All digests are lowercase SHA-256 hex. Original bytes, reviewed extraction,
four prompts, and two combined companions are hashed. Package creation uses an
immutable in-memory snapshot. A late result from an obsolete revision cannot
install a Blob or preview, and any content, review, profile, or settings change
invalidates the accepted package.

Equivalent valid inputs are ordered deterministically and retain the same
archive metadata and compression policy. The manifest is an inspection aid; it
does not certify a third-party model response or replace human review.
