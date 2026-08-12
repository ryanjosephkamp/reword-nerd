# Prompt package manifest v3

Manifest schema `3` is the historical `reword-nerd` `0.3.0` package contract. It
extends v2 without changing the canonical four-stage prompt order.

Each document retains v2 original, reviewed extraction, prompt, settings,
model-strategy, context, and combined-artifact provenance. V3 adds:

- `processing.pageCount` and the exact conservative extraction/OCR options;
- `visualAssets.index`, `visualAssets.placementMap`, and one byte/hash/provenance
  record per included asset;
- `ocr.path` plus engine, language, confidence, disposition, and raw/reviewed
  text hashes;
- optional LaTeX project metadata and the safe extracted `projectRoot`;
- `combined.fullHtml`, which explicitly records either a generated path/hash or
  `not-generated` with the encoded-size reason.

The archive remains deterministic: paths use lexicographic code-unit order,
timestamps are `1980-01-01T00:00:00.000Z`, originals and media use STORE, and
generated text uses DEFLATE level 9. All paths are relative and traversal-safe.
The root `README.md` is the runbook used as the exact prefix of every combined
Markdown companion.
