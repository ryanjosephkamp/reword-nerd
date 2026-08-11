# Extraction limitations

The workbench extracts text so that it can be reviewed and used in the manual
prompt package. Extraction is not a guarantee that a document's visual layout,
embedded media, annotations, or every semantic feature is represented exactly.
Review the extracted text before confirming it.

## Accepted formats

| Format | Local handling | Important limitation |
| --- | --- | --- |
| `.txt` | Strict UTF-8 decode | Invalid UTF-8, NUL-containing, and empty content is rejected. |
| `.md`, `.markdown` | Strict UTF-8 decode | The source is preserved as text; review any Markdown syntax that matters. |
| `.docx` | OOXML validation, then local DOCX-to-HTML-to-Markdown conversion | Embedded images are omitted and produce a warning. Complex layouts and Word-specific features may not convert cleanly. |
| `.pdf` | Text-layer extraction through the local PDF parser | Scanned or image-only PDFs cannot be reviewed because OCR is not provided. |

## PDF behavior

The PDF signature is checked before parsing. Password-protected, invalid,
corrupt, parser-failed, and textless PDFs receive a safe blocked state. A
textless PDF is not treated as a usable extraction even if it has visible page
images. Remove the blocked file or replace it with a selectable-text version
to continue exporting other documents.

## DOCX behavior

DOCX files must be valid OOXML packages containing the expected Word parts.
The converter does not fetch external files. Embedded images are deliberately
omitted from the extracted Markdown and recorded as a warning. Check headings,
lists, tables, tracked changes, footnotes, citations, equations, hyperlinks,
and formatting that carry meaning before confirmation.

## File and queue limits

- 20 files in a workbench session;
- 20 MiB for an individual file;
- 100 MiB across the accepted queue.

The workbench rejects unsupported, empty, unreadable, or over-limit files
without sending them elsewhere. A rejection or blocked extraction for one file
does not invalidate already reviewed files.
