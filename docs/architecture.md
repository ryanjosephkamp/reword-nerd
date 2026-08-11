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
  -> four prompt renderings
  -> manifest + ZIP Blob
  -> browser download
```

### Admission and extraction

The workbench accepts the files selected in the browser and first enforces
format and queue limits. Text and Markdown are strictly decoded as UTF-8.
DOCX content is converted locally to reviewable Markdown, and PDFs are read
locally through the PDF parser's worker. The extraction layer computes
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
model-family profile is descriptive metadata for the manual workflow. The
context estimate uses the extracted source plus the expected four-stage
exchange; an oversized estimate requires a document-specific acknowledgement.

### Prompt rendering

`src/prompting/renderPromptSet.ts` imports the four root Markdown templates as
raw assets and adds the document, resolved settings, selected profile, and
prior-stage response markers. The templates remain the source of truth for the
manual Decompose, Rewrite, Verify, and Final workflow.

### Package generation

`src/export/` snapshots valid, reviewed inputs before asynchronous file reads.
It creates a document key from a normalized name and source digest, builds all
required per-document files, and records their SHA-256 hashes in schema v1.
The archive uses deterministic entry ordering, a fixed timestamp, and fixed
metadata so equivalent inputs create equivalent archive contents.

Original uploads are stored without compression; generated Markdown and JSON
entries use DEFLATE level 9. JSZip produces a browser `Blob`, and the download
helper uses an object URL only long enough to trigger the browser download.

## Main modules

| Location | Responsibility |
| --- | --- |
| `src/app/` | Application composition and workbench interaction state. |
| `src/app/workbench/` | Reducer, selectors, browser services, hooks, and UI components. |
| `src/domain/` | Format admission, extraction, SHA-256 hashing, profiles, settings, and context assessment. |
| `src/prompting/` | Prompt-template loading and per-document rendering. |
| `src/export/` | ZIP construction, manifest contract, safe archive paths, and browser download. |
| `prompts/` | Canonical four-stage Markdown prompt templates. |
| `tests/` | Unit, component, archive, and Playwright browser coverage. |

See [privacy](privacy.md), [extraction limitations](extraction-limitations.md),
and [manifest v1](manifest-v1.md) for the corresponding boundaries and data
contract.
