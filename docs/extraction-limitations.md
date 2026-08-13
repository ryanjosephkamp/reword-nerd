# Extraction limitations

Extraction and project admission prepare source material for human review and portable prompts. They
cannot guarantee visual layout, reading order, caption association, equation
semantics, complete media recovery, correct identification of every
user-facing/code narrative string, or that model-produced changes compile and
behave correctly. Confirm text, project inclusion, assets, and OCR before export.

## v0.6 processing defaults

For a new session with no valid v0.6 saved preference, **Extract embedded
images** is on and **Exclude likely decorative images** is on. PDF page capture,
OCR, and OCR of extracted raster images are off. Once saved, validated global
processing preferences take precedence over these new-state defaults.

Documentation/markup, comments/docstrings, and user-facing strings are included
by default. Narrative structured-data values are off. Root `.gitignore`, safe
dependency/build/generated exclusions, and preservation of safe non-text assets
are on. Executable syntax protection is always on.

Changing processing options for an uploaded document reprocesses it locally and
requires review again. Nothing is fetched remotely or executed.

## Accepted formats

| Format | Local handling | Important limitation |
| --- | --- | --- |
| `.txt` | Strict UTF-8 decode | Invalid UTF-8, NUL-containing, and empty content is rejected. |
| `.md`, `.markdown` | Strict UTF-8; optional inline raster data-image extraction | External URLs remain text and are never fetched. |
| `.docx` | OOXML validation and local Markdown conversion | Embedded-image and complex-layout recovery is best effort. |
| `.pdf` | Text layer; optional raster extraction, page capture, and OCR | Image operators, reading order, and reconstructed pages require review. |
| `.tex`, `.ltx` | Strict UTF-8 and non-executing analysis | No compilation, shell escape, macro execution, or dependency resolution. |
| HTML/XML | Strict UTF-8 plus inert rich/raw preview | Scripts, styles, forms, frames, event handlers, active links, and external resources do not run or load. |
| JSON/JSONL/NDJSON, YAML, TOML, INI/config | Strict UTF-8; bounded structured or raw preview | Deep/large structures are preview-bounded; keys, types, numbers, and shape are protected. |
| CSV/TSV | Strict UTF-8; bounded text-only table/raw preview | Rich preview is capped at 200 rows and 50 columns; formula-like cells stay inert text. |
| CSS, SQL, common code/scripts | Strict UTF-8; exact read-only line preview | Rewriting targets configured prose only; code is never executed, compiled, dependency-resolved, or tested. |
| Unknown/extensionless text | Full bounded fatal UTF-8 decode | Binary signatures, invalid UTF-8, NUL/control-bearing, or blank input is rejected. MIME alone cannot admit it. |
| Folder or `.zip` project | Safe bounded project tree and per-file review | Paths, inclusions, and exclusions require review; the sanitized package is AI context, not a source backup. |

## PDF, images, and OCR

PDF signatures are checked before parsing. Password-protected, invalid, and
corrupt files are blocked. A textless PDF is blocked while OCR is off. Embedded
figures may be masks, fragments, or composite operators; page capture is the
higher-fidelity opt-in fallback. Page selection accepts `all` or positive ranges
such as `1-3, 7`.

Bundled English OCR runs Tesseract.js locally. Recognition is
capped at 150 selected pages or extracted images and always produces editable
candidates. OCR is never merged automatically; every candidate must be accepted
or omitted before confirmation and export.

DOCX and LaTeX images are deduplicated and assigned stable asset IDs where
supported. Decorative classification is conservative and remains reviewable.
Review tables, equations, footnotes, tracked changes, captions, and placement.

## ORIGINAL preview limits

ORIGINAL is view-only and cannot change review/package revision. PDF renders
only active/adjacent bounded canvases and disposes them after switching. Markdown
uses a React AST with raw HTML disabled. HTML uses a local parser and semantic
allowlist. DOCX is explicitly an approximate semantic reconstruction. Rich
CSV/TSV is capped at 200 rows and 50 columns; JSON is capped at 2,000 nodes and
64 levels; very large structured/code text uses bounded or raw views. Uploaded
content is never placed in `iframe`, `object`, `embed`, `srcdoc`, or
`dangerouslySetInnerHTML`.

## Project safety and fidelity

Folder projects are limited to 20 MiB per file. ZIP projects are limited to a
100 MiB input container, 25 MiB per entry, and a 100:1 compression ratio. Both are limited to 500 retained
entries and 100 MiB uncompressed across projects and the session. Project paths
must be safe normalized relative paths: traversal, absolute/drive/backslash
paths, controls, portability/case collisions, Windows device names, alternate
data streams, long segments/paths, symlinks, encryption, and nested archives
are rejected.

Likely credentials/private keys are dropped before retention and represented
only by aggregate category counts. Root `.gitignore` and conservative
dependency/vendor/cache/build/generated/minified/source-map/lock exclusions run
after that sensitive check. Safe exclusions remain visible and may be restored;
sensitive-blocked content cannot.

At most 250 reviewed text files and 5 MiB of decoded text may enter project
prompts. The UI and package record inclusion decisions, immutable original and
reviewed hashes, and visible exclusion reasons. Entries beyond prompt scope stay
inspectable with a `prompt-limit` exclusion rather than being silently
truncated. They are absent from prompt source and cannot be restored beyond the
cap; users must review and confirm that visible scope before BUILD. Prompts protect executable
syntax, identifiers, control flow, imports/signatures, paths, placeholders,
structural tokens, keys/types/numbers, citations, and licenses, but a model can
still make mistakes. Apply output to a copy, inspect every diff, and run normal
tests/builds afterward. `reword-nerd` never claims that it ran them.

## Limits

- 20 standalone files and 20 MiB per standalone/folder file; projects do not
  consume standalone-file count, but all sources share the 100 MiB session byte budget;
- 500 entries, a 100 MiB ZIP-container cap before bytes are read, and 25 MiB per ZIP entry, with a 100:1 archive ratio;
- 250 prompt-included project text files and 5 MiB decoded prompt text;
- 200 visual assets and 100 MiB generated visual bytes per document;
- 300 MiB generated media per package;
- lightweight HTML inlines supported raster assets only through 128 KiB each;
- optional full HTML is omitted above an estimated or actual 150 MiB.

These limits preserve deterministic, bounded local behavior. They are not a
claim of fidelity for every document; explicit review remains required.
