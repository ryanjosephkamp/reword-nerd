# Prompt package manifest v4

> Historical contract. Current `0.6.0` packages use [manifest schema v6](manifest-v6.md).

Manifest schema `4` is the historical `reword-nerd` `0.4.0` contract. Its package
format is the literal `dual-mode-prompt-package`. It always declares both
One-shot and Manual workflows and retains the canonical Manual stage order.

## Root contract

```json
{
  "schemaVersion": 4,
  "package": {
    "name": "reword-nerd",
    "version": "0.4.0",
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

Root `OPEN-ME.html` is a standalone, no-script index linking to each document's
combined, One-shot, and Manual workbook. Root `README.md` is the package runbook
and exact prefix of combined Markdown workbooks. Both root artifacts are hashed.

## Per-document record

Each record includes:

- stable `key`, `exportOrdinal`, original display name and format;
- original path/byte count/hash and reviewed-extraction path/code-point
  count/hash/warnings;
- resolved rewrite settings;
- selected model metadata plus prompt-strategy ID, version, reference model,
  and review date;
- separate One-shot and Manual context token estimates, ratios, oversize states,
  One-shot advisory state, selected limit, and Manual acknowledgement state;
- all five canonical prompt paths/hashes;
- processing page count and exact extraction/OCR options;
- visual asset catalog/placement hashes and complete included/omitted records;
- OCR path/hash and candidate provenance/hashes;
- optional safe LaTeX project metadata and `projectRoot`;
- One-shot, Manual, combined, and optional full workbook records.

Workbook paths are:

```text
documents/<key>/one-shot-prompt.md
documents/<key>/one-shot-prompt.html
documents/<key>/manual-prompts.md
documents/<key>/manual-prompts.html
documents/<key>/combined-prompts.md
documents/<key>/combined-prompts.html
documents/<key>/combined-prompts-full.html  # only when generated
```

`combined.fullHtml` is either `{ "status": "generated", "path", "sha256" }`
or `{ "status": "not-generated", "reason": "encoded-size-limit" }`.

## Archive and integrity rules

- Every document, including a single document, lives below `documents/<key>/`.
- Entry paths are traversal-safe and emitted in lexicographic code-unit order.
- The ZIP has no directory entries. All entries use timestamp
  `1980-01-01T00:00:00.000Z`, empty comments, UNIX `100644`, and deterministic
  compression policy.
- Original uploads, included media, and safe LaTeX project bytes use STORE.
  Generated Markdown, HTML, and JSON use DEFLATE level 9.
- Every generated artifact declared by the manifest has a SHA-256 digest.
  Original and reviewed-extraction records are also hashed.
- Equivalent reviewed inputs and settings produce byte-identical ZIPs.

## Standalone workbook and progress contract

All HTML is escaped, self-contained, keyboard accessible, and responsive to
320px. Content Security Policy denies external connections. Lightweight files
refer only to packaged sibling assets; full companions may use bounded data
URLs. No standalone workbook uses browser storage.

Combined HTML provides accessible One-shot/Manual tabs, top Copy controls,
editable prompts and response fields, prerequisite-disabled Copy, downstream
hydration, stale edit preservation, explicit Reapply/Reset, optional Stage 4
response capture, and Download Progress Copy. A progress copy embeds validated
progress schema `1` for the same document and can be round-tripped by the public
workbook parser. It is a separate sensitive HTML download, not an archive entry
or automatic save.

Schemas [v1](manifest-v1.md), [v2](manifest-v2.md), and [v3](manifest-v3.md)
remain historical and unchanged.
