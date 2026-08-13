# Manifest v1

> Historical contract. Current `0.7.0` packages use [manifest schema v6](manifest-v6.md).

Every package includes `manifest.json` at its archive root. It records the
package contents and the document-specific choices used to render the four
prompts. The manifest is formatted as JSON with `schemaVersion: 1`.

## Root structure

```json
{
  "schemaVersion": 1,
  "package": {
    "name": "reword-nerd",
    "version": "0.1.0",
    "format": "manual-four-stage-prompt-package"
  },
  "archive": {},
  "workflow": {},
  "documents": []
}
```

`archive` records the deterministic archive policy: lexicographic code-unit
entry ordering, the fixed `1980-01-01T00:00:00.000Z` timestamp, `STORE` for
original uploads, and `DEFLATE-9` for generated entries. It describes the
archive rather than a promise that every ZIP implementation will preserve
byte-for-byte output after it is modified.

`workflow` records manual mode, the ordered `decompose`, `rewrite`, `verify`,
and `final` stages, plus the response markers used to carry previous outputs
between prompts.

## Document record

Each entry in `documents` has these fields:

| Field | Meaning |
| --- | --- |
| `key` | Stable archive directory key based on a normalized file name and source digest. |
| `exportOrdinal` | Zero-based position after deterministic package ordering. |
| `originalDisplayName` | The file name shown in the workbench. |
| `format` | `text`, `markdown`, `docx`, or `pdf`. |
| `original` | Archive path, byte count, and SHA-256 for the original uploaded bytes. |
| `reviewedExtraction` | Archive path, Unicode code-point count, SHA-256, and extraction warnings for the reviewed text. |
| `settings` | Resolved tone, formality, length, output language, and custom requirements. |
| `model` | Selected profile id, family, label, editable context limit, review date, and manual-workflow note. |
| `contextAssessment` | Source and workflow token estimates, selected limit, ratio, and oversized/acknowledgement state. |
| `contextWarningAcknowledged` | Whether this document's required context warning was acknowledged. |
| `prompts` | Archive path and SHA-256 for each of the four rendered prompt files. |

## Archive paths

The archive root contains `README.md` and `manifest.json`. For each document
key `<key>`, the archive contains:

```text
documents/<key>/original.<extension>
documents/<key>/reviewed-extraction.md
documents/<key>/prompts/01-decompose.md
documents/<key>/prompts/02-rewrite.md
documents/<key>/prompts/03-verify.md
documents/<key>/prompts/04-final.md
```

`<extension>` is `txt`, `md`, `docx`, or `pdf`, matching the admitted document
format. Archive paths are relative, do not include traversal segments, and are
validated before the ZIP is generated.

## Hashes and reproducibility

The manifest uses lowercase SHA-256 hex digests. Original bytes, reviewed
extraction, and all four generated prompts are hashed. The workbench takes an
in-memory snapshot before asynchronous reads, so a later edit cannot alter an
already started package operation. Equivalent valid inputs and settings are
ordered deterministically; source files remain byte-identical inside the ZIP.

The manifest is an inspection aid. It does not certify the reliability of a
third-party model response or replace review of the prompt inputs and outputs.
