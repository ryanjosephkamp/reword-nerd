# reword-nerd

<p align="center">
  <img src="public/brand/reword-nerd-logo.webp" width="192" height="192" alt="reword-nerd logo">
</p>

`reword-nerd` is a local-first browser workbench with two isolated companion
portals. The root `/reword-nerd/` Text portal remains the default for turning
reviewed documents and safe text projects into portable rewriting workbooks.
The physical `/reword-nerd/image/` Image companion page prepares one ZIP for a
confirmed image set, with one source-image/prompt pair per included image. Both
portals keep source and prompts reviewable in the browser.

The application does not rewrite documents or contact model providers. Text
Build creates a schema-6 Text workbook ZIP and immutable workbook preview in
memory. Image Build creates a schema-1 Image package ZIP and built pair cards in
memory. Download remains a separate, explicit action in either portal.

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

## Use the Text workbench

On the Text portal's first visit, Quick start offers **REVIEW SETTINGS** as the primary action and
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

## Use the Image companion

Choose **IMAGE** in the shared header, or open `/reword-nerd/image/` directly.
It is a genuinely separate Vite page and sibling state domain; entering it does
not convert a Text session or broaden the Text package schema. If current work
exists, the portal switch offers a new tab or an explicit in-tab session clear.

The Image portal accepts direct PNG, JPEG, WebP, and AVIF files. It can also
recover supported visuals from PDF and DOCX containers, folders, and safe ZIPs.
PDF page capture is an explicit opt-in. For bounded local processing, PDF
annotation appearances are not rendered. Asynchronously expanded PDF content,
tiling patterns, Type3 glyph programs, and form groups (including transparency
groups) are rejected before their nested visual programs are evaluated. PDF
JPEG 2000 (JPX) and JBIG2 visuals are unsupported; ordinary PDF JPEG, Flate,
and bounded CCITT decoding remain available. The pinned PDF worker applies a
worker-lifetime, monotonic 128 MiB cap to `DecodeStream` buffer allocations and
a separate 160,000,000-byte cumulative allowance to expanded PDF image samples,
including base images and stream masks before sample-array work begins. These
targeted guards do not claim to cap every internal PDF.js allocation.
Filter-heavy or near-limit PDFs can therefore fail closed even when their final
visible page would otherwise fit the normal image limits.
Local English Image OCR is off by default, and only reviewed, accepted OCR text enters a prompt. Each retained
image has independent Include/Omit, selection, settings, warnings, and review
state; bulk settings replace only fields explicitly chosen for the selected
images.

After **CONFIRM IMAGE SET**, **BUILD PACKAGE** creates one ZIP for the confirmed image set with one pair per included image.
The deterministic schema-1 Image ZIP keeps exactly one source image and one prompt in every pair, plus one provider run card; the generated prompt text is preserved exactly.
The default goal is **Faithful rendition**:
request a newly generated rendition that stays as close to the attached source
as the selected model permits, applying only explicit requested changes. It
does not claim pixel identity, return the unchanged file, or call/contact a
model or provider. **DOWNLOAD ZIP** remains a separate deliberate action.

The initial Image prompt profiles are OpenAI GPT Image (the first-time default),
Google Nano Banana, xAI Grok Imagine, Black Forest Labs FLUX, Adobe Firefly,
Ideogram, Midjourney, Stability AI, and Other/Custom. These are dated prompting
strategies and run-card metadata, not API integrations. Midjourney is labelled
as a best-effort variation for faithful-rendition work; Other/Custom stays
provider-neutral rather than inventing controls.

See [Image extraction limits](docs/extraction-limitations.md), the
[Image schema-1 manifest](docs/image-package-manifest-v1.md), and
[privacy boundary](docs/privacy.md) before using source material that may
contain metadata or confidential content.

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

Public authored Updates posts and release media are site material, distinct from
uploaded session content, prompt packages, and downloaded progress copies. They
are reviewed source files and same-origin release assets; they are never added
to a user's package or inferred from a user's session.

```sh
npm run updates:new -- --slug road-to-v0-6 --title "Road to v0.6" --date 2026-08-13
npm run release:prepare -- --version 0.7.0 --title "reword-nerd v0.7" --date 2026-08-13
npm run updates:check
npm run updates:render
```

Release preparation reads local Git history for its review inventory, updates
central version contracts, and refuses to overwrite existing prose. It does not
call a model, network service, GitHub API, commit, push, or merge.

See the [release workflow](docs/release-workflow.md) for the required local
authoring/review/video checks and the separately authorized owner publication
steps.

The Text first-visit Quick start includes a short, locally hosted overview video.
Text Help provides Settings, Review, and Package chapter videos with transcripts;
the controls never autoplay and reduced-motion users receive static posters.
These unchanged clips demonstrate the document workflow and predate the v0.6
project-workspace flow; current written guidance covers both. The Image Quick Start now includes a distinct orange, same-origin video walkthrough with a poster and transcript; it remains silent, synthetic, and local to the deployed site.

## Text accepted sources and v0.6 safety defaults

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

Every Text Settings label has contextual help available by hover, focus, click, or
tap. On desktop, the gear collapses or expands Parameters without changing
settings or invalidating a package. One namespaced localStorage key saves only
validated global model/context, rewrite, processing, and tutorial preferences.
Files, extracted text, assets, OCR, reviews, per-file overrides, prompts,
responses, progress, and packages remain session-only.

Image uses a separate validated `reword-nerd:image-preferences:v1` key for
Image defaults and its tutorial marker. It has no dedicated source-byte,
filename, or path field and does not serialize selected Image files, selections,
OCR, prompts, previews, or packages. Requested-changes and must-preserve defaults
are saved free-form text exactly as entered within their bounds, so do not put
sensitive names, paths, or instructions in saved defaults. The Text preference
key and Text behavior remain isolated from Image defaults.

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

## Image schema-1 ZIP layout

`reword-nerd-image-prompt-package.zip` uses the independent
`image-reference-prompt-package` schema `1`. It contains root README/HTML and
manifest files plus one ordered `pairs/<pair-key>/` directory per confirmed,
included image. Each pair holds exact `source.<ext>` bytes, `prompt.txt`,
`run-card.md`, `metadata.json`, and `OPEN-ME.html`.

Root and per-pair HTML use responsive image cards and sibling paths after ZIP
extraction. `OPEN-ME-FULL.html` is generated only when its final encoded size is
at most 32 MiB. Copy Prompt falls back to selecting the exact prompt; Copy Image
falls back to Open Image, Download Image, and dragging, including under
`file://`. The HTML makes no network request and uses no tracking or storage.

Direct-image and recoverable DOCX-media bytes are preserved exactly and may
retain EXIF or location metadata. PDF visuals and opt-in page captures are
locally rasterized to PNG, so those bytes are recovery output rather than the
original PDF image streams. Original PDF, DOCX, and ZIP containers are
provenance only and are not exported. See [Image manifest schema v1](docs/image-package-manifest-v1.md).

## Privacy and browser support

Validation, project classification, Text and Image extraction, hashing, review,
local OCR, inert ORIGINAL rendering, prompt rendering, preview, clipboard
handling, ZIP creation, and progress-copy creation occur locally. There is no
application backend, account system, provider call, telemetry, analytics, or
runtime request that sends source data off-device. Uploaded code is never
executed, compiled, or tested. The bundled logos, Text tutorial posters,
and Text demo videos are same-origin site assets and are never placed in a user
package. Info offers deliberate same-origin and external navigation destinations
for Updates, community reporting, repository, creator, and sponsorship; opening
one requires the user to activate it.
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
- [Image manifest v1](docs/image-package-manifest-v1.md)
- [Directory structure](docs/directory-structure.md)
- [Design system](docs/design-system.md)
- [Model guidance](docs/model-guidance/README.md)
- [Release workflow](docs/release-workflow.md)
- [Contributing](CONTRIBUTING.md)

This repository provides a browser application; it does not include a Python
package, command-line interface, server API, or model execution service.

Built by [Ryan Kamp](https://ryanjosephkamp.github.io). See the
[repository](https://github.com/ryanjosephkamp/reword-nerd),
[GitHub profile](https://github.com/ryanjosephkamp/), or
[sponsor page](https://github.com/sponsors/ryanjosephkamp).

## License

MIT. See [LICENSE](LICENSE).
