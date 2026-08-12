# reword-nerd

<p align="center">
  <img src="public/brand/reword-nerd-logo.webp" width="192" height="192" alt="reword-nerd logo">
</p>

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
6. read the rich **RUNBOOK**, then use the in-site One-shot or Manual
   workspace, or explicitly **DOWNLOAD ZIP**.

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

The first-visit Quick start includes a short, locally hosted overview video.
Help provides Settings, Review, and Package chapter videos with transcripts;
the controls never autoplay and reduced-motion users receive static posters.

## Accepted files and v0.5 processing defaults

The workbench accepts `.txt`, `.md`, `.markdown`, `.docx`, `.pdf`, `.tex`,
`.ltx`, and safe LaTeX project `.zip` files. It admits at most 20 files, 20 MiB
per file, and 100 MiB across the queue.

For a new v0.5 preference state, embedded-image extraction is on and likely
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

Every Settings label has contextual help available by hover, focus, click, or
tap. On desktop, the gear collapses or expands Parameters without changing
settings or invalidating a package. One namespaced localStorage key saves only
validated global model/context, rewrite, processing, and tutorial preferences.
Files, extracted text, assets, OCR, reviews, per-file overrides, prompts,
responses, progress, and packages remain session-only.

**NEW SESSION** clears the current documents, review and workbook progress, and
built package after confirmation while retaining those saved global settings.
**Reset saved preferences** has the opposite scope: it clears the saved key
without deleting the current uploaded documents. See [privacy](docs/privacy.md).

## Schema-v5 ZIP layout

`reword-nerd-prompt-package.zip` is deterministic and has no directory entries.
The root contains:

- `OPEN-ME.html` — local document and workflow entry points;
- `README.md` — the package runbook;
- `manifest.json` — schema `5`, hashes, provenance, paths, workflow, processing,
  context, asset/OCR, and optional LaTeX project records.

Every document is under `documents/<document-key>/` and includes:

- the original upload and `reviewed-extraction.md`;
- `one-shot/00-one-shot.md` plus `one-shot-prompt.md/html`;
- `manual-prompts/01-decompose.md` through `04-final.md` plus
  `manual-prompts.md/html`;
- `combined-prompts/combined-prompts.md/html`, providing both workflows;
- `combined-prompts/combined-prompts-full.html` when the encoded full-media form stays within
  the 150 MiB cap;
- asset catalog/placement files, included visual bytes, OCR provenance, and a
  safe LaTeX project tree when applicable.

In-site Package preview opens on a semantic **RUNBOOK** tab; One-shot and Manual
tabs show only their editable prompts and response fields. Combined standalone
HTML opens on a rich **README** tab, followed by One-shot and Manual. The
single-workflow HTML companions retain their rich README so each is usable on
its own.

Standalone HTML is escaped, keyboard accessible, responsive to 320px, free of
remote resources and automatic storage, and supports Clipboard API plus a
selection fallback. Lightweight HTML links only to packaged sibling assets;
the optional full companion embeds supported media as data URLs.

The current contract is [manifest v5](docs/manifest-v5.md). Historical contracts
remain available as [v4](docs/manifest-v4.md), [v3](docs/manifest-v3.md),
[v2](docs/manifest-v2.md), and [v1](docs/manifest-v1.md).

## Privacy and browser support

Validation, extraction, hashing, review, prompt rendering, preview, clipboard
handling, ZIP creation, and progress-copy creation occur locally. There is no
application backend, account system, provider call, telemetry, analytics, or
runtime request that sends document data off-device. The bundled logo, posters,
and demo videos are same-origin site assets and are never placed in a user
package. Info offers
four deliberate navigation links—to the repository, creator GitHub, creator
website, and sponsorship page—but opening one requires the user to activate it.
Deliberately downloaded ZIP and progress files are then governed by the browser,
operating system, and storage destination.

Automated coverage runs in current Chromium against the built production
preview, including desktop, tablet, 320/360/390/412px portrait, and standalone
`file://` workbooks. The app relies on current File, Web Crypto, TextDecoder,
Blob, object URL, Clipboard, and download APIs. Other current browsers may work,
but do not have equivalent automated release coverage.

## Project map

- [Architecture](docs/architecture.md)
- [Privacy](docs/privacy.md)
- [Extraction limitations](docs/extraction-limitations.md)
- [Manifest v5](docs/manifest-v5.md)
- [Directory structure](docs/directory-structure.md)
- [Design system](docs/design-system.md)
- [Model guidance](docs/model-guidance/README.md)
- [Contributing](CONTRIBUTING.md)

This repository provides a browser application; it does not include a Python
package, command-line interface, server API, or model execution service.

Built by [Ryan Kamp](https://ryanjosephkamp.github.io). See the
[repository](https://github.com/ryanjosephkamp/reword-nerd),
[GitHub profile](https://github.com/ryanjosephkamp/), or
[sponsor page](https://github.com/sponsors/ryanjosephkamp).

## License

MIT. See [LICENSE](LICENSE).
