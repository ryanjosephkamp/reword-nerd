# reword-nerd

`reword-nerd` is a local-first browser workbench for turning reviewed source
documents into portable rewriting workbooks. It extracts supported files in the
browser, keeps the source and prompts reviewable, and always generates both a
One-shot workflow and a four-stage Manual workflow for the model you choose.

The application does not rewrite documents or contact model providers. Build
creates a revision-bound ZIP and immutable workbook preview in memory; download
remains a separate, explicit action.

## Workflows

**One-shot** asks the model to perform Decompose, Rewrite, Verify, and Final in
one request, returning the finished document plus a compact fidelity audit. It
is the faster path and uses the smaller context estimate, but its intermediate
work is not exposed for review.

**Manual** exposes the four canonical stages separately:

1. **Decompose** — identify claims, structure, facts, and constraints.
2. **Rewrite** — produce a substantially different presentation that preserves meaning.
3. **Verify** — compare the candidate with the decomposition and record issues.
4. **Final** — resolve the issues and produce the finished document.

Manual takes more transfers and usually more context, but it is the transparent
fallback when One-shot exceeds a model's practical capability or when each
intermediate response needs review. Response fields hydrate downstream prompts.
If an upstream response changes after a downstream prompt was edited, the edit
is preserved and marked stale until **Reapply** or **Reset** is chosen.

## Use the workbench

On first visit, Quick start offers **REVIEW SETTINGS** as the primary action and
**ADD FILES** as the secondary action. Help can replay the guide. In an empty
Review panel, **ADD FILES** opens the same multi-file picker directly.

For each accepted document:

1. inspect and, if needed, edit the extracted text;
2. review extracted assets and OCR candidates;
3. confirm the extraction;
4. resolve any required Manual-context acknowledgement;
5. choose **BUILD PACKAGE**;
6. use the in-site One-shot or Manual preview, or explicitly **DOWNLOAD ZIP**.

Build does not auto-download. Any source, review, asset, processing, profile, or
rewrite-setting mutation invalidates the built Blob and workbooks together.
Switching Source/Assets/Package, workflows, or package documents does not.

**DOWNLOAD PROGRESS COPY** creates a separate standalone HTML file containing
the current prompt edits and model responses, including optional One-shot and
Stage 4 responses. Treat it as sensitive document material. Progress is held in
memory only until deliberately downloaded and is discarded with its build.

## Run locally

Requirements: Node.js 20.19 or later (or 22.12 or later), npm, and a current
Chromium installation for the Playwright suite.

```sh
npm install
npm run dev
```

For the production bundle and exact release browser path:

```sh
npm run build
npm run preview
PLAYWRIGHT_USE_PREVIEW=1 npm run e2e
```

Run all local release checks with:

```sh
npm run lint
npm run typecheck
npm test -- --run
npm run build
PLAYWRIGHT_USE_PREVIEW=1 npm run e2e
```

Use `npm run install:playwright` once if Chromium is not installed for Playwright.

## Accepted files and v0.4 processing defaults

The workbench accepts `.txt`, `.md`, `.markdown`, `.docx`, `.pdf`, `.tex`,
`.ltx`, and safe LaTeX project `.zip` files. It admits at most 20 files, 20 MiB
per file, and 100 MiB across the queue.

For a new v0.4 preference state, embedded-image extraction is on and likely
decorative images are excluded. PDF page capture, OCR, and OCR of extracted
images are off. These are saved global processing preferences; changing them
for an uploaded document reprocesses that document locally. Extraction remains
bounded, conservative, and review-first. See [extraction limitations](docs/extraction-limitations.md).

## Settings, preferences, and context

Choose a model-family profile and global tone, formality, length, output
language, custom requirements, context limit, and processing options. A file
may use session-only overrides. Profiles are prompt-generation strategies, not
provider integrations; their dated evidence is in the [model-guidance index](docs/model-guidance/README.md).

One-shot and Manual have separate conservative context estimates. One-shot
oversize is advisory; a Manual estimate over the selected limit requires an
explicit per-document acknowledgement.

One namespaced localStorage key saves only validated global model/context,
rewrite, processing, and tutorial preferences. Files, extracted text, assets,
OCR, reviews, per-file overrides, prompts, responses, progress, and packages
remain session-only. **Reset saved preferences** clears that key after
confirmation without deleting current uploaded documents. See [privacy](docs/privacy.md).

## Schema-v4 ZIP layout

`reword-nerd-prompt-package.zip` is deterministic and has no directory entries.
The root contains:

- `OPEN-ME.html` — local document and workflow entry points;
- `README.md` — the package runbook;
- `manifest.json` — schema `4`, hashes, provenance, paths, workflow, processing,
  context, asset/OCR, and optional LaTeX project records.

Every document is under `documents/<document-key>/` and includes:

- the original upload and `reviewed-extraction.md`;
- `prompts/00-one-shot.md` and canonical `01-decompose.md` through `04-final.md`;
- `one-shot-prompt.md/html` and `manual-prompts.md/html` workflow siblings;
- `combined-prompts.md/html`, providing both workflows in one workbook;
- `combined-prompts-full.html` when the encoded full-media form stays within
  the 150 MiB cap;
- asset catalog/placement files, included visual bytes, OCR provenance, and a
  safe LaTeX project tree when applicable.

Standalone HTML is escaped, keyboard accessible, responsive to 320px, free of
remote resources and automatic storage, and supports Clipboard API plus a
selection fallback. Lightweight HTML links only to packaged sibling assets;
the optional full companion embeds supported media as data URLs.

The current contract is [manifest v4](docs/manifest-v4.md). Historical contracts
remain available as [v3](docs/manifest-v3.md), [v2](docs/manifest-v2.md), and
[v1](docs/manifest-v1.md).

## Privacy and browser support

Validation, extraction, hashing, review, prompt rendering, preview, clipboard
handling, ZIP creation, and progress-copy creation occur locally. There is no
application backend, account system, provider call, telemetry, analytics, or
runtime external dependency. Deliberately downloaded ZIP and progress files are
then governed by the browser, operating system, and storage destination.

Automated coverage runs in current Chromium against the built production
preview, including desktop, tablet, 320/360/390/412px portrait, and standalone
`file://` workbooks. The app relies on current File, Web Crypto, TextDecoder,
Blob, object URL, Clipboard, and download APIs. Other current browsers may work,
but do not have equivalent automated release coverage.

## Project map

- [Architecture](docs/architecture.md)
- [Privacy](docs/privacy.md)
- [Extraction limitations](docs/extraction-limitations.md)
- [Manifest v4](docs/manifest-v4.md)
- [Directory structure](docs/directory-structure.md)
- [Design system](docs/design-system.md)
- [Model guidance](docs/model-guidance/README.md)
- [Contributing](CONTRIBUTING.md)

This repository provides a browser application; it does not include a Python
package, command-line interface, server API, or model execution service.

## License

MIT. See [LICENSE](LICENSE).
