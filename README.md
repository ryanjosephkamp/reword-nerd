# reword-nerd

`reword-nerd` is a browser workbench for preparing a reviewable, four-stage
rewriting package from long-form documents. It keeps the source, the reviewed
extraction, and the generated prompts together so a user can run a careful
manual workflow with the model they choose.

The application does not rewrite documents or contact model providers. It
builds a local package for the user to inspect in the site before optionally
downloading a ZIP for their chosen model.

## Workflow

For each accepted document, the workbench follows this sequence:

1. **Decompose** — identify the document's claims, structure, constraints, and
   other meaning that must be retained.
2. **Rewrite** — create a new version that preserves the source meaning while
   using a different presentation.
3. **Verify** — compare the candidate against the decomposition and record
   any issues.
4. **Final** — resolve recorded issues and prepare the finished version.

Before the package can be built, review the extracted text for every file and
confirm it in the workbench. You may edit an extraction before confirming it.
The generated prompts contain explicit response markers so each stage can be
carried into the next one.

## Run locally

Requirements: Node.js 20.19 or later (or 22.12 or later) and npm. The browser
suite is exercised in Chromium through Playwright.

```sh
npm install
npm run dev
```

Open the local Vite address printed by the development server. For a production
preview, build first and then serve the generated files:

```sh
npm run build
npm run preview
```

Run the checks with:

```sh
npm run lint
npm run typecheck
npm test -- --run
npm run build
npm run e2e
```

If Chromium is not already available to Playwright, run
`npm run install:playwright` once before the browser suite.

## Accepted files and limits

The workbench accepts `.txt`, `.md`, `.markdown`, `.docx`, `.pdf`, `.tex`,
`.ltx`, and safe `.zip` LaTeX projects.
It admits at most 20 files, 20 MiB per file, and 100 MiB across the current
queue. Plain text and Markdown must be valid UTF-8. PDF files must contain
selectable text by default. Optional English OCR, embedded-image extraction,
and PDF page captures are local, conservative, review-first features. See
[extraction limitations](docs/extraction-limitations.md) for format-specific
behavior.

## Settings and context estimate

Choose a model-family profile and writing settings for tone, formality, length,
output language, and custom requirements. Per-file settings can override the
global defaults. Custom requirements preserve internal spaces and blank lines.
The curated choices are Alibaba / Qwen, Anthropic / Claude, DeepSeek / V4 Pro,
Google / Gemini, Meta / Muse, MiniMax / M3, Mistral / Large 3, MoonshotAI /
Kimi, OpenAI / ChatGPT, xAI / Grok, and Z.AI / GLM. **Custom model** covers
local, self-hosted, fine-tuned, and unlisted models with an editable label and
context limit.

Profiles are prompt-generation strategies, not provider integrations. Every
strategy has a dated evidence record, stable ID, independent version, reference
model, and review date in the [model-guidance index](docs/model-guidance/README.md).
Provider-specific layout is applied only where supported by first-party guidance;
API-only controls are documented without being inserted into manual chat prompts.

The workbench estimates the size of the complete four-stage exchange. If that
estimate exceeds the selected context limit, the affected file requires an
explicit acknowledgement before package generation. Editing the extracted
text, changing the profile, or changing the limit resets that acknowledgement.

## Build, preview, and download

**BUILD PACKAGE** validates the current revision and creates the package in
browser memory. It does not download anything. A successful build opens the
Package view, where the runbook and all four prompts can be read and copied.
For multiple documents, use the artifact selector. **DOWNLOAD ZIP** then exports
that exact reviewed Blob. Any source, review, setting, or profile change
invalidates the preview and requires a new build.

## What the ZIP contains

`reword-nerd-prompt-package.zip` has deterministic ordering and one directory
per document. Each directory includes:

- the original uploaded file;
- `reviewed-extraction.md`;
- `prompts/01-decompose.md` through `prompts/04-final.md`;
- `combined-prompts.md`, containing the complete package runbook and all four
  exact prompts in safe four-or-more-backtick fences;
- `combined-prompts.html`, a standalone black-on-white, no-network companion
  with a Copy button for each exact prompt;
- `combined-prompts-full.html` when the data-URI version stays within the
  encoded 150 MiB cap;
- an `assets/` catalog, placement map, and included visual bytes;
- `ocr/candidates.json` with reviewed OCR provenance;
- for LaTeX project ZIPs, the safely extracted project tree under `project/`.

The archive root also contains `README.md`, a document-by-document runbook,
and `manifest.json`. The manifest records the selected profile, resolved
settings, strategy provenance, context assessment, warnings, archive paths,
and SHA-256 hashes. The current contract is [manifest v3](docs/manifest-v3.md);
[manifest v2](docs/manifest-v2.md) and [manifest v1](docs/manifest-v1.md) remain historical.

## Privacy and session behavior

All validation, extraction, prompt rendering, package preview, clipboard
operation, ZIP generation, and download preparation occur in the current
browser session. There is no application
backend, account system, provider request, analytics sender, or browser-storage
write. Refreshing or closing the page clears the workbench state. Once you
download a ZIP, its storage and handling are governed by your browser and
operating system. See [privacy](docs/privacy.md) for the boundary in detail.

## Browser support

The automated browser suite currently runs in Chromium. The workbench relies
on current browser APIs including File, Web Crypto, TextDecoder, Blob, and
object URLs. Use a current desktop browser; support outside the tested Chromium
environment has not yet received equivalent automated coverage.

## Publishing

The repository includes a GitHub Pages workflow that validates and builds the
site for its repository URL before deployment. A push to `main` runs lint,
typechecking, the unit suite, and the production build, then publishes `dist/`.
The workflow supplies `/reword-nerd/` as Vite's production base path while
local development and preview continue to use `/`.

## Project map

- [Architecture](docs/architecture.md)
- [Model guidance](docs/model-guidance/README.md)
- [Extraction limitations](docs/extraction-limitations.md)
- [Manifest v3](docs/manifest-v3.md)
- [Directory structure](docs/directory-structure.md)
- [Design system](docs/design-system.md)
- [Contributing](CONTRIBUTING.md)

This repository provides a browser application; it does not include a Python
package, command-line interface, server API, or model execution service.

## License

MIT. See [LICENSE](LICENSE).
