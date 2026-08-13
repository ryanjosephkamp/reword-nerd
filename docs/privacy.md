# Privacy and local-processing boundary

`reword-nerd` processes selected files, folders, and ZIP workspaces in the
browser. Validation, safe project classification, extraction, hashing, review
edits, inert ORIGINAL previews, prompt generation, package preview, clipboard
handling, ZIP creation, and progress-copy rendering are local operations.

## The one saved-preference key

The application may write exactly one namespaced localStorage key:
`reword-nerd:preferences:v1`. Its versioned value is decoded through a strict
allowlist and may contain only:

- selected global model profile, custom model label, and current context limit;
- global tone, formality, length, output language, and custom requirements;
- global embedded-image, decorative-image, PDF capture/page/quality, and OCR options;
- global code/structured-text selection, root-ignore, dependency/build exclusion, and safe
  non-text-asset options;
- the tutorial version used to decide whether Quick start appears.

Corrupt, unsupported, oversized, or unknown fields are ignored or replaced with
safe defaults. Reset saved preferences removes this one key after confirmation.
**NEW SESSION** does not remove or rewrite it: that command clears the current
in-memory work while keeping validated global preferences and the tutorial
record.

The key never contains source files, project paths or decisions, extracted or
reviewed text, assets, OCR text, ORIGINAL previews, tree hashes, review state,
per-file overrides, generated prompts, model responses, workbook progress, ZIP
bytes, or built packages. Those remain in memory and are cleared by reload or
session end.

The application does not use sessionStorage, IndexedDB, Cache Storage, cookies,
or a service worker for workbench state.

## Network and provider boundary

- There is no application backend or account system.
- Selected files are not uploaded to a model provider.
- There is no analytics, telemetry, remote font, remote library, or runtime
  request that sends document data off-device. Bundled PDF/OCR assets, the logo,
  Help posters, and Help videos may be requested from the same app origin when
  those local features are used.
- A model profile is descriptive prompt metadata only; it creates no connection.
- Uploaded HTML/Markdown cannot navigate or load active resources, and uploaded
  code is never run, compiled, dependency-resolved, or tested.

## Project-sensitive data boundary

Project intake applies a fail-closed classifier before `.gitignore` and normal
exclusion rules. Likely credential files, private keys, and clear credential
material are dropped before tree hashing, preview, indexing, prompt rendering,
or export. The session retains aggregate safe-category counts only; blocked
paths, names, bytes, and hashes are not retained or recoverable in the app.

Non-sensitive entries stay in browser memory with explicit prompt/package
inclusion state. Default-excluded dependencies, vendor/cache/build/generated,
minified, source-map, lock, and root-ignored files are not silently added to
prompts. A user may deliberately restore eligible safe exclusions during
review. Project packages contain a sanitized reviewed tree for AI context; they
are not source-control backups. ZIP-container metadata may be recorded for
provenance, but the original generic ZIP is not copied into the package.

The Info dialog offers one same-origin Updates route and exactly seven
deliberate external navigation destinations:

- `https://github.com/ryanjosephkamp/reword-nerd`
- `https://github.com/ryanjosephkamp/reword-nerd/issues/new?template=bug_report.yml`
- `https://github.com/ryanjosephkamp/reword-nerd/issues/new?template=feature_request.yml`
- `https://github.com/ryanjosephkamp/reword-nerd/security/advisories/new`
- `https://github.com/ryanjosephkamp/`
- `https://ryanjosephkamp.github.io`
- `https://github.com/sponsors/ryanjosephkamp`

The Updates route stays within `/reword-nerd/updates/`. External links open only
after user activation with `noopener noreferrer`. They are navigation choices,
not application requests, and no document content is attached to them. Share
uses only the clean canonical site URL and adds no tracker, counter, shortener,
query, hash, or uploaded-session state.

The static host receives ordinary requests for application files, not selected
documents. Browser extensions, device management, local development servers,
and network environments may have their own policies.

## Public Updates and release media

Public authored Updates posts and release media are site material, distinct from
uploaded session content, prompt packages, and downloaded progress copies. The
ledger, reviewed Markdown, and synthetic MP4/WebM/poster/transcript files are
checked into the application source and served as ordinary same-origin site
assets. They are not generated from selected files, do not include source
documents or package material, and are never copied into a user's ZIP or
progress file.

The optional Updates Share enhancement receives only a pre-rendered canonical
Updates URL. It has no document/session input, no storage, analytics, counter,
shortener, social SDK, or network request. Native Share or clipboard access is
performed only after a direct user action; manual copy displays that same
canonical URL locally.

## Deliberate downloads

**BUILD PACKAGE** creates a revision-bound ZIP Blob and workbooks in memory; it
does not download. **DOWNLOAD ZIP** explicitly hands that Blob to the browser.

**DOWNLOAD PROGRESS COPY** is a separate deliberate HTML download containing
current prompt edits and response fields. It can include the rewritten document,
intermediate model outputs, source-derived prompts, and an optional Stage 4
response. Treat both ZIPs and progress copies as sensitive document material.
After download, storage and retention are controlled by the browser, operating
system, backup tools, and destination chosen by the user.

Standalone HTML companions contain inline CSS, JSON, and a small inline script.
They make no external request and never save automatically. Lightweight files
refer only to packaged sibling assets; full files use bounded data URLs. Copy
uses the Clipboard API when available and otherwise selects the visible prompt
for browser/manual copy. Downloaded progress stays in that downloaded file only.

The branded logo, favicons, tutorial posters, and demo video files are
application assets. Package creation does not copy them into the ZIP or any
downloaded progress workbook.

Opening or pasting a workbook into a model, or applying its suggested changed
files to a project, is a separate user action governed
by that provider's terms, privacy settings, and account controls.
