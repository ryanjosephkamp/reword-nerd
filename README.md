# reword-nerd

<p align="center">
  <img src="public/brand/reword-nerd-logo.webp" width="192" height="192" alt="reword-nerd logo">
</p>

`reword-nerd` is a local-first browser workbench for turning reviewed documents
and safe text projects into portable rewriting workbooks. It extracts supported
files in the browser, keeps source and prompts reviewable, and always generates
both a One-shot workflow and a four-stage Manual workflow for the model you
choose.

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

For each accepted source:

1. inspect the extracted text and the inert **ORIGINAL** preview;
2. for a project, choose which safe files enter prompts and the package;
3. review editable text, extracted assets, and OCR candidates;
4. confirm the document or complete project workspace;
5. resolve any required context acknowledgement;
6. choose **BUILD PACKAGE** in Parameters or the desktop Preview Footer Dock;
7. read the rich **RUNBOOK**, then use the in-site One-shot or Manual
   workspace, or explicitly **DOWNLOAD ZIP**.

The Assets view opens in a focused one-at-a-time review and can switch to a
compact gallery for choosing any extracted figure directly. The selected asset
and Include/Omit decision remain inspectable when moving between those views.

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

For the production bundle and exact GitHub Pages browser path:

```sh
VITE_BASE_PATH=/reword-nerd/ npm run build
VITE_BASE_PATH=/reword-nerd/ npm run preview
PLAYWRIGHT_BASE_PATH=/reword-nerd/ PLAYWRIGHT_USE_PREVIEW=1 npm run e2e
```

If port 4173 is already serving another local project, set an isolated test
port, for example `PLAYWRIGHT_PORT=4187`.

Run all local release checks with:

```sh
npm run lint
npm run typecheck
npm test -- --run
VITE_BASE_PATH=/reword-nerd/ npm run build
PLAYWRIGHT_BASE_PATH=/reword-nerd/ PLAYWRIGHT_USE_PREVIEW=1 npm run e2e
```

Use `npm run install:playwright` once if Chromium is not installed for Playwright.

## Updates journal

The public Updates journal is generated from `content/updates/releases.json` and
reviewed safe Markdown. It stays static, same-origin, and readable without
client JavaScript.

```sh
npm run updates:new -- --slug road-to-v0-6 --title "Road to v0.6" --date 2026-08-13
npm run release:prepare -- --version 0.7.0 --title "reword-nerd v0.7" --date 2026-08-13
npm run updates:check
npm run updates:render
```

Release preparation reads local Git history for its review inventory, updates
central version contracts, and refuses to overwrite existing prose. It does not
call a model, network service, GitHub API, commit, push, or merge.

The first-visit Quick start includes a short, locally hosted overview video.
Help provides Settings, Review, and Package chapter videos with transcripts;
the controls never autoplay and reduced-motion users receive static posters.
These unchanged clips demonstrate the document workflow and predate the v0.6
project-workspace flow; current written guidance covers both.

## Accepted sources and v0.6 safety defaults

The workbench accepts `.txt`, Markdown, DOCX, PDF, LaTeX, HTML/XML, CSV/TSV,
JSON/JSONL/NDJSON, YAML/TOML/INI/config, CSS/SQL, and common programming and
script files. An extensionless or otherwise unknown file is accepted as generic
text only when all bounded bytes pass fatal UTF-8 decoding and binary/control
checks. Original standalone bytes and line endings remain exact.

**ADD FOLDER** admits one folder as a text project; a general `.zip` can be
added through the normal file picker. LaTeX projects are detected when a clear
root document exists, while an ambiguous project requires an explicit
classification. Project intake normalizes and checks every path, rejects links,
encryption, traversal, collisions, and nested archives, drops likely secrets
before retention, honors the configured root `.gitignore`, and conservatively
excludes dependencies, caches, builds, generated output, source maps, minified
files, and lockfiles. Excluded safe entries remain reviewable and restorable.

Projects are bounded to 500 entries, 20 MiB per folder file, 100 MiB per ZIP
container, 25 MiB per ZIP entry, 100 MiB uncompressed across projects and the session, and a 100:1 ZIP
ratio. At most 250 text files and 5 MiB of decoded reviewed text may enter a
prompt. Entries beyond that initial scope stay inspectable with a visible
`prompt-limit` exclusion, are absent from prompt source, and cannot be restored
beyond the cap. Users must review and confirm that visible scope before BUILD;
prompt source is never silently truncated.

Standalone intake remains bounded to 20 files and 20 MiB per file. Documents
and projects share the 100 MiB session byte budget; a folder or ZIP is one
workspace row rather than hundreds of document rows.

For a new v0.6 preference state, embedded-image extraction is on and likely
decorative images are excluded. PDF page capture, OCR, and OCR of extracted
images are off. These are saved global processing preferences; changing them
for an uploaded document reprocesses that document locally. Extraction remains
bounded, conservative, and review-first. See [extraction limitations](docs/extraction-limitations.md).

## Settings, preferences, and context

Choose a model-family profile and global tone, formality, length, output
language, custom requirements, context limit, processing options, and Code &
Structured Text options. A standalone file may use session-only rewrite overrides. Profiles
are prompt-generation strategies, not provider integrations; their dated
evidence is in the [model-guidance index](docs/model-guidance/README.md).

Code/project defaults include documentation and markup, comments/docstrings,
and user-facing strings; narrative structured-data values are opt-in. Root
`.gitignore`, safe dependency/build exclusions, and preservation of safe
non-text assets are on. Executable syntax, control flow, identifiers, imports,
signatures, paths, structural tokens, and data types are always protected and
cannot be disabled. `reword-nerd` does not run, compile, or test code: apply
changes to a copy, inspect every diff, and run the project's normal checks.

One-shot and Manual have separate conservative context estimates. One-shot
oversize is advisory; a Manual estimate over the selected limit requires an
explicit source acknowledgement. Projects also show an amber risk at 25
included files or when One-shot reaches at least half the selected context.

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

## Schema-v6 ZIP layout

`reword-nerd-prompt-package.zip` is deterministic and has no directory entries.
The root contains:

- `OPEN-ME.html` — local document and workflow entry points;
- `README.md` — the package runbook;
- `manifest.json` — schema `6`, discriminated file/project provenance, paths,
  hashes, workflow, processing, context, code-selection, asset, and OCR records.

Every standalone file is under `documents/<document-key>/` and keeps its stable
v5 paths:

- the original upload and `reviewed-extraction.md`;
- `one-shot/00-one-shot.md` plus `one-shot-prompt.md/html`;
- `manual-prompts/01-decompose.md` through `04-final.md` plus
  `manual-prompts.md/html`;
- `combined-prompts/combined-prompts.md/html`, providing both workflows;
- `combined-prompts/combined-prompts-full.html` when the encoded full-media form stays within
  the 150 MiB cap;
- asset catalog/placement files, included visual bytes, and OCR provenance.

A folder or ZIP workspace uses the same One-shot, Manual, combined, asset, and
OCR directories, plus `reviewed-extraction.md` and a sanitized project tree:

```text
documents/<project-key>/project/
├── index.md
├── index.json
└── files/<safe-relative-path>
```

Only package-included non-sensitive entries appear under `project/files/`.
Schema 6 records reviewed/original tree lineage and every retained safe entry;
likely secrets contribute aggregate counts only. A ZIP's original container
hash is provenance, not a copied archive. A folder has no fictitious original
container. This package is AI context and a changed-files workflow—not a source
control backup.

In-site Package preview opens on a semantic **RUNBOOK** tab; One-shot and Manual
tabs show only their editable prompts and response fields. Combined standalone
HTML opens on a rich **README** tab, followed by One-shot and Manual. The
single-workflow HTML companions retain their rich README so each is usable on
its own.

On mobile, Source/Assets/Package navigation and Build/Download remain reachable
while document metrics and package-local controls scroll away with the content,
leaving the prompt or runbook as the primary reading surface.

Standalone HTML is escaped, keyboard accessible, responsive to 320px, free of
remote resources and automatic storage, and supports Clipboard API plus a
selection fallback. Lightweight HTML links only to packaged sibling assets;
the optional full companion embeds supported media as data URLs.

The current contract is [manifest v6](docs/manifest-v6.md). Historical contracts
remain available as [v5](docs/manifest-v5.md), [v4](docs/manifest-v4.md),
[v3](docs/manifest-v3.md), [v2](docs/manifest-v2.md), and
[v1](docs/manifest-v1.md).

## Privacy and browser support

Validation, project classification, extraction, hashing, review, inert ORIGINAL
rendering, prompt rendering, preview, clipboard handling, ZIP creation, and
progress-copy creation occur locally. There is no
application backend, account system, provider call, telemetry, analytics, or
runtime request that sends source data off-device. Uploaded code is never
executed, compiled, or tested. The bundled logo, posters,
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
- [Manifest v6](docs/manifest-v6.md)
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
