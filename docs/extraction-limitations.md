# Extraction limitations

The workbench extracts source material for human review and a manual prompt
package. It cannot guarantee exact visual layout, reading order, caption
association, or semantic recovery. Confirm text, assets, and OCR before export.

## Accepted formats

| Format | Local handling | Important limitation |
| --- | --- | --- |
| `.txt` | Strict UTF-8 decode | Invalid UTF-8, NUL-containing, and empty content is rejected. |
| `.md`, `.markdown` | Strict UTF-8; optional inline raster data-image extraction | External URLs are never fetched. Data-image bytes stay excluded unless enabled. |
| `.docx` | OOXML validation and local DOCX-to-Markdown conversion | Optional embedded-image extraction is best effort. Complex Word layout can drift. |
| `.pdf` | Text layer; optional raster extraction, page capture, and OCR | PDF image operators and reading order are best effort. Review every asset and OCR candidate. |
| `.tex`, `.ltx` | Strict UTF-8 and non-executing LaTeX analysis | No compilation, shell escape, macro execution, or remote dependency resolution occurs. |
| `.zip` | Safe LaTeX project inspection and extraction | Only bounded, traversal-free, non-encrypted, non-link projects containing TeX are accepted. |

## PDF and OCR

The PDF signature is checked before parsing. Password-protected, invalid, and
corrupt files are blocked. Textless PDFs are blocked unless OCR is explicitly
enabled. Embedded-image extraction is best effort because figures may be masks,
fragments, or composited operators. Page capture is the higher-fidelity visual
fallback. Page selection accepts `all` or ranges such as `1-3, 7`.

OCR is off by default. Version 0.3.0 bundles English, runs Tesseract.js locally,
caps recognition at 150 pages or extracted images, and produces editable
candidates. OCR is never merged automatically: every candidate must be accepted
or omitted before confirmation and export.

## DOCX, Markdown, and LaTeX

DOCX conversion never fetches external files. Images are omitted by default;
when enabled, supported bytes are deduplicated and referenced by stable asset
IDs. Review tables, equations, footnotes, tracked changes, and complex layout.
Markdown external image URLs remain source text only; supported inline raster
data images may be extracted when enabled.

LaTeX sources are preserved. Project ZIPs are limited to 500 entries, 25 MiB
per entry, 100 MiB uncompressed total, and a 100:1 compression ratio. Traversal
paths, links, duplicate names, encrypted entries, and archives without TeX are
rejected. Main-file ambiguity, missing dependencies, and cycles remain visible.
The workbench never compiles or executes LaTeX.

## Limits

- 20 files, 20 MiB per file, and 100 MiB accepted input per session;
- 200 visual assets and 100 MiB generated visual bytes per document;
- 300 MiB generated media per exported package;
- lightweight HTML inlines supported raster assets only through 128 KiB each;
- the optional full HTML companion is omitted above an estimated 150 MiB.
