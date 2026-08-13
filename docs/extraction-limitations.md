# Extraction limitations

Extraction prepares source material for human review and portable prompts. It
cannot guarantee visual layout, reading order, caption association, equation
semantics, or complete media recovery. Confirm text, assets, and OCR before
export.

## v0.5 processing defaults

For a new session with no valid v0.5 saved preference, **Extract embedded
images** is on and **Exclude likely decorative images** is on. PDF page capture,
OCR, and OCR of extracted raster images are off. Once saved, validated global
processing preferences take precedence over these new-state defaults.

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
| `.zip` | Safe LaTeX project inspection | Only bounded, traversal-free, non-encrypted, non-link projects containing TeX. |

## PDF, images, and OCR

PDF signatures are checked before parsing. Password-protected, invalid, and
corrupt files are blocked. A textless PDF is blocked while OCR is off. Embedded
figures may be masks, fragments, or composite operators; page capture is the
higher-fidelity opt-in fallback. Page selection accepts `all` or positive ranges
such as `1-3, 7`.

Version 0.5.1 bundles English OCR and runs Tesseract.js locally. Recognition is
capped at 150 selected pages or extracted images and always produces editable
candidates. OCR is never merged automatically; every candidate must be accepted
or omitted before confirmation and export.

DOCX and LaTeX images are deduplicated and assigned stable asset IDs where
supported. Decorative classification is conservative and remains reviewable.
Review tables, equations, footnotes, tracked changes, captions, and placement.

LaTeX project ZIPs are limited to 500 entries, 25 MiB per entry, 100 MiB
uncompressed total, and a 100:1 compression ratio. Traversal paths, links,
duplicate names, encrypted entries, and archives without TeX are rejected.
Main-file ambiguity, missing dependencies, and cycles remain visible.

## Limits

- 20 files, 20 MiB per file, and 100 MiB accepted input per session;
- 200 visual assets and 100 MiB generated visual bytes per document;
- 300 MiB generated media per package;
- lightweight HTML inlines supported raster assets only through 128 KiB each;
- optional full HTML is omitted above an estimated or actual 150 MiB.

These limits preserve deterministic, bounded local behavior. They are not a
claim of fidelity for every document; explicit review remains required.
