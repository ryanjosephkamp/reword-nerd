# Architecture

`reword-nerd` is a static React application. Its work happens in browser
memory: it has no application server, account service, model request, or
persistence layer.

## Processing path

```text
File API / drop event
  -> admission checks
  -> format-specific extraction
  -> editable, explicit review
  -> settings and context assessment
  -> provider-guided four-prompt rendering
  -> manifest + combined Markdown/HTML + ZIP Blob
  -> in-site package preview
  -> optional browser download
```

### Admission and extraction

The workbench accepts the files selected in the browser and first enforces
format and queue limits. Text and Markdown are strictly decoded as UTF-8.
DOCX content is converted locally to reviewable Markdown, PDFs are read through
the local parser worker, and TeX/project ZIP sources are analyzed without
execution. Optional visual extraction, page capture, and English OCR are
explicit, bounded, local, and review-first. The extraction layer computes
SHA-256 digests with Web Crypto, records safe warnings, and rejects files that
cannot provide reviewable content.

The queue is concurrent only where it is safe to be. Reducer actions retain a
batch identity so a late extraction result cannot restore a removed or stale
file. A failure blocks only that document; another ready document remains
available for review and export.

### Review and settings

The workbench state holds the original `File`, extracted text, source and text
digests, warnings, review state, and a transient selected-file identity.
Editing extracted text requires another explicit review confirmation before a
package is enabled.

Global writing settings resolve to a per-document setting object. A file may
enable a local override without changing the global defaults. The selected
model-family profile is descriptive metadata plus a versioned prompt-layout
strategy for the manual workflow; it never connects to a provider. The
context estimate uses the extracted source plus the expected four-stage
exchange; an oversized estimate requires a document-specific acknowledgement.

### Prompt rendering

`src/prompting/renderPromptSet.ts` imports the four root Markdown templates as
raw assets and adds the document, resolved settings, selected profile strategy,
and prior-stage response markers. The templates remain the source of truth for
the manual Decompose, Rewrite, Verify, and Final workflow. Strategy metadata can
select task-first or source-first/task-last ordering and Markdown or XML
delimiters without changing canonical stage semantics or markers.

### Package generation

`src/export/` snapshots valid, reviewed inputs before asynchronous file reads.
It creates a document key from a normalized name and source digest, builds all
required per-document files, builds both combined companions from one immutable
structured artifact, and records their SHA-256 hashes and strategy provenance
in schema v3, including visual placement, OCR, and LaTeX project provenance.
The archive uses deterministic entry ordering, a fixed timestamp, and fixed
metadata so equivalent inputs create equivalent archive contents.

Original uploads and media are stored without compression; generated Markdown,
HTML, and JSON entries use DEFLATE level 9. zip.js produces a browser `Blob`. The accepted
Blob and structured artifacts remain revision-bound in memory for preview. An
explicit download uses an object URL only long enough to trigger the browser
download; any content, review, profile, or settings mutation invalidates it.

## Main modules

| Location | Responsibility |
| --- | --- |
| `src/app/` | Application composition and workbench interaction state. |
| `src/app/workbench/` | Reducer, selectors, browser services, hooks, and UI components. |
| `src/domain/` | Format admission, extraction, SHA-256 hashing, profiles, settings, and context assessment. |
| `src/prompting/` | Prompt-template loading and per-document rendering. |
| `src/export/` | Combined artifacts, ZIP construction, manifest contract, safe archive paths, and browser download. |
| `prompts/` | Canonical four-stage Markdown prompt templates. |
| `tests/` | Unit, component, archive, and Playwright browser coverage. |

See [privacy](privacy.md), [model guidance](model-guidance/README.md),
[extraction limitations](extraction-limitations.md), and [manifest v3](manifest-v3.md)
for the corresponding boundaries and current data contract.
