# Privacy and local-processing boundary

`reword-nerd` processes selected files, folders, and ZIP workspaces in the
browser. Validation, safe project classification, Text and Image extraction,
hashing, review edits, local OCR, inert ORIGINAL previews, prompt generation,
package preview, clipboard handling, ZIP creation, and progress-copy rendering
are local operations.

## Exactly two saved-preference localStorage keys

### Text preferences

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
safe defaults. Reset saved preferences removes this Text key after confirmation.
**NEW SESSION** does not remove or rewrite it: that command clears the current
in-memory work while keeping validated global preferences and the tutorial
record.

The key never contains source files, project paths or decisions, extracted or
reviewed text, assets, OCR text, ORIGINAL previews, tree hashes, review state,
per-file overrides, generated prompts, model responses, workbook progress, ZIP
bytes, or built packages. Those remain in memory and are cleared by reload or
session end.

### Image preferences

The Image companion uses only `reword-nerd:image-preferences:v1`. Its strict
version-1 envelope may contain validated defaults for model family, aspect
ratio, size intent, visible-text preservation, background/transparency behavior,
requested changes, must-preserve notes, and the Image tutorial marker.

There is no dedicated image-byte, filename, or path field in Image preferences,
and the app does not serialize source images, provenance, inclusion/bulk
selection, focused item, OCR state, warnings, review/build generations, prompts,
run cards, manifests, previews, object URLs, or package bytes. Free-form
requested changes and must-preserve defaults are persisted as bounded user-entered text, however, and may contain sensitive names, paths, or instructions a user types.
Changing Text preferences does not rewrite Image defaults, and changing Image
defaults does not rewrite Text preferences or existing Image items.

Beyond exactly these two validated localStorage keys, the application does not
use sessionStorage, IndexedDB, Cache Storage, cookies, or a service worker for
workbench state.

## Network and provider boundary

- There is no application backend or account system.
- Selected files are not uploaded to a model provider.
- There is no analytics, telemetry, remote font, remote library, or runtime
  request that sends document data off-device. Bundled PDF/OCR assets, the logo,
  Text Help posters and Text Help videos may be requested from the same app origin when
  those local features are used.
- A model profile is descriptive prompt metadata only; it creates no connection.
- The Image portal never calls or requests a model, never asks for provider
  credentials, and never uploads a source image.
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

## Image source and lifetime boundary

Direct PNG/JPEG/WebP/AVIF and locally recovered PDF/DOCX/folder/ZIP visuals are
owned as in-memory Blobs after bounded validation. Exact direct-image and DOCX
media bytes may retain EXIF or location metadata; the UI and package README
warn about that custody. PDF visuals and page captures are locally rasterized
to PNG and therefore are not byte-identical to embedded PDF streams. Original PDF and DOCX containers are never included or exported in an Image package;
original ZIP containers are also excluded. Only retained image bytes, bounded provenance, settings, hashes,
prompts, and run cards enter the explicit schema-1 output.

Image OCR is off by default, local, and review-gated. Detected text remains in
memory; only accepted OCR is quoted into a prompt. Purpose-scoped URLs back
bounded thumbnails, one focused preview, and lazy built cards. An occurrence object URL is revoked when that occurrence is removed or leaves its bounded lease window. A built-card object URL is revoked when package output is invalidated or replaced. All remaining image-byte object URLs are revoked on reset, portal navigation, or unmount. The pinned local PDF parser uses one page-lifetime Blob URL for its application worker code; it contains no user image or document bytes and is not a storage record.

Confirmation snapshots source bytes and configuration before asynchronous work.
Any later source, OCR, inclusion, or setting mutation invalidates both the built
ZIP and preview cards. Cancellation and generation tokens prevent late work from
repopulating the current session.

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

On the Image page, **BUILD PACKAGE** likewise creates the deterministic
`reword-nerd-image-prompt-package.zip` only in memory; **DOWNLOAD ZIP** is a
separate deliberate action. Image root/per-pair HTML references packaged sibling
images, while the optional bounded full HTML uses data URLs. Under `file://` or
without Clipboard access, Copy Prompt selects visible text and Copy Image keeps
Open Image, Download Image, and drag fallbacks. These files make no network
request, tracking write, automatic upload, or model call.

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
