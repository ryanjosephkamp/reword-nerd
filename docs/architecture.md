# Architecture

`reword-nerd` is a static React application. Source work happens in browser
memory; there is no application server, account service, model request,
telemetry sender, code runner, or source persistence layer.

## Processing and state path

```text
File API / drop event / folder FileList
  -> bounded file or safe-project admission
  -> bounded format-specific extraction
  -> inert ORIGINAL preview + editable review + inclusion/asset/OCR decisions
  -> settings + separate One-shot/Manual context estimates
  -> PromptBundle (One-shot + canonical Manual stages)
  -> immutable semantic RunbookDocument + DocumentWorkbook[]
  -> schema-v6 file/project manifest + deterministic ZIP Blob
  -> revision-bound rich Runbook/One-shot/Manual preview
  -> explicit ZIP or progress-copy download
```

Standalone admission recognizes documents, markup, structured data, tables,
config, and common source-code/script extensions. Unknown or extensionless
input is admitted as generic text only after complete bounded bytes pass fatal
UTF-8, signature, NUL/control, and nonblank checks. Original standalone bytes
and line endings remain unchanged. DOCX converts locally; PDF uses the bundled
parser worker; LaTeX is never compiled. Optional visuals, page capture, and
English OCR are local, bounded, and review-first.

Folder and ZIP intake creates a `WorkspaceProject`. Paths are normalized and
checked for traversal, links, encryption, normalized/portable collisions,
device names, nested archives, and byte limits. Sensitive classification runs
before ignore rules and drops likely credentials/private keys without retaining
their path, bytes, or hash. Safe exclusions remain inspectable. Immutable
original and reviewed tree hashes bind every prompt and export to one accepted
snapshot. Projects never run, compile, resolve dependencies, or execute tests.

The reducer holds `WorkspaceItem` file/project variants, original bytes,
reviewed text and hashes, warnings, project inclusion decisions, review state,
assets/OCR, selection, global settings, and per-file overrides in memory. A
confirmed source becomes review-required again after a content or inclusion
mutation. Monotonic intake, project-mutation, review, and session generations
prevent late asynchronous completions from restoring stale work.
Asset detail/gallery navigation and per-document asset selection are view-only;
changing Include/Omit remains a review mutation and invalidates the built package.

SOURCE has nested `EXTRACTED TEXT | ORIGINAL` navigation. PDF uses bounded
PDF.js canvas pages; Markdown renders a safe React AST with raw HTML disabled;
HTML uses a local parser and semantic allowlist; DOCX is labeled as an
approximation; CSV/TSV and JSON use bounded structured views; code/config/text
uses an exact read-only line view. Uploaded content is never injected as HTML or
loaded through a frame, object, embed, or active resource/link surface.

## Prompt and context contracts

`src/prompting/renderPromptSet.ts` imports all root Markdown templates as raw
assets. `PromptBundle` contains `oneShot` plus the unchanged Manual `decompose`,
`rewrite`, `verify`, and `final` prompt set. Provider strategy metadata controls
portable layout guidance without changing canonical stage meaning or response
markers.

`assessContext` returns separate conservative `oneShotWorkflowTokens` and
`manualWorkflowTokens`, ratios, and oversize states. One-shot oversize is an
advisory. Manual oversize retains the required document-specific acknowledgement
boundary and compatibility aliases for older internal consumers.

Project context uses a conservative three-code-points-per-token estimate for
code/markup/structured text plus per-file framing. It reports an amber risk at
25 included files or a One-shot ratio of at least 50%, preserves the Manual
acknowledgement boundary, and always tells users to inspect diffs and run their
normal tests/build after applying output. Project source blocks include safe
paths and immutable original/reviewed hashes and use a collision-free boundary.
Generated instructions protect syntax/control flow and request deterministic
changed-text-file, unchanged/excluded, and risk manifests.

Initial project scope includes at most 250 reviewed text files and 5 MiB of
decoded prompt text. Later entries remain visible with `prompt-limit` exclusion,
are absent from prompt source, and cannot be restored beyond the cap. Users must
review and confirm that explicit scope before BUILD; no prompt text is silently
truncated.

## Schema-v6 runbook and workbook engine

`src/export/runbook.ts` creates an immutable semantic `RunbookDocument` from
headings, paragraphs, tables, ordered or unordered lists, fenced code blocks,
and inline text, code, or safe archive-relative links. That one model is
serialized to the exact root `README.md`, rendered as React elements in-site,
and serialized to escaped semantic HTML for standalone workbooks. No arbitrary
HTML is parsed, and generated HTML is never executed inside the app.

`src/export/artifacts.ts` builds one immutable `DocumentWorkbook` per document.
The model is the source for separate One-shot, Manual, combined, and optional
full HTML/Markdown bytes and for the React package preview. Combined HTML uses
README/ONE-SHOT/MANUAL tabs with README selected; the in-site preview uses the
parallel RUNBOOK/ONE-SHOT/MANUAL contract with RUNBOOK selected after build.

The pure progress API creates revision-local response/prompt state, hydrates
downstream prompts, preserves edited stale prompts, and applies explicit Reset
or Reapply. `renderWorkbookProgressHtml` serializes the same safe standalone
workbook model; `parseWorkbookProgressHtml` validates its embedded schema.
Neither path automatically uses storage.

`src/export/package.ts` deep-snapshots reviewed inputs before its first async
boundary, independently revalidates file/project lineage and sensitive
classification, assigns safe deterministic keys, hashes every declared artifact,
and emits schema `6` with package format `dual-mode-prompt-package`. Entries are sorted by code-unit path order,
use a fixed 1980 timestamp and permissions, STORE immutable binaries, and
DEFLATE-9 generated text. Root `OPEN-ME.html` links to each document's workflow
siblings. Canonical prompts live under each document's `one-shot/` and
`manual-prompts/` directories; combined workbooks live under
`combined-prompts/`. Full-HTML eligibility uses a monotonic final-render pass so
manifest status, runbook text, hashes, and archived bytes agree at the cap.

Schema 6 preserves every v5 standalone-file path and adds discriminated project
provenance. A project exports reviewed `project/files/` entries plus Markdown
and JSON indexes; excluded/sensitive bytes do not enter any package artifact.
ZIP container metadata is provenance only and the original ZIP is not copied.
Folder projects correctly omit container provenance. The runbook presents the
sanitized tree as AI context and a changed-files workflow, not a backup.

## Preview, races, and lifetime

The accepted ZIP Blob and immutable workbooks share one export object and built
revision. A successful current build opens Package/RUNBOOK. Package preview
stays mounted but natively hidden during Source or Assets navigation, preserving
revision-local progress. Any content, review, asset, processing, profile, or
rewrite-setting mutation advances the revision, clears Blob and workbooks
together, returns Source, and unmounts old progress.

Build and download hooks bind async completion to operation IDs and revision
snapshots. Duplicate activation, late build completion, and stale download
completion cannot expose obsolete workbooks or mark a changed session clean.
Prompt Copy separately binds completion to its operation token and monotonically
advancing view generation so document/workflow/stage/hidden round trips cannot
announce or steal focus after the initiating view changed.

File intake, extraction, review hashing, OCR, build, and download completions
also carry generation or revision identity. Confirming **NEW SESSION** advances
those guards before clearing session data, so late work cannot repopulate the
new session. Global saved preferences and the tutorial record are retained.

## Preference boundary

`src/app/workbench/preferences.ts` is the only production browser-storage
boundary. It owns one namespaced key, validates a version-1 envelope and a
fixed allowlist, and fails safely when storage is missing or corrupt. The key
contains only global model/context, rewrite, processing, code-rewrite, and
tutorial-version preferences. Workbench sources, project decisions, previews,
and workbook progress are never included.

`src/version.ts` exposes `APP_VERSION` from package metadata. The footer and
Info dialog render `0.7.0` from that source, while schema-v6 contracts and tests
require the manifest package version to match the release.

## Updates publication boundary

`content/updates/releases.json` and its reviewed Markdown are the
JSON-authoritative static journal inputs. `scripts/updates/` validates those
inputs before the Vite build and deterministically emits the archive, posts,
feed, sitemap, stylesheet, and optional same-origin Share enhancement. Public
authored Updates posts and release media are site material, distinct from
uploaded session content, prompt packages, and downloaded progress copies. The
workbench never reads a session file into these authored sources, and export
never copies the authored sources or `public/media/updates/` bytes into a user
package.

Release-video source lives under `video/remotion/release/`; its renderer is an
authoring tool, not a runtime dependency. Final synthetic MP4, WebM, poster,
and transcript assets live in `public/media/updates/<release>/` only after
local validation. The release workflow remains offline until an authorized
owner separately chooses the remote review and publication steps.

## Overlay, guidance, and layout boundary

Quick start, Help, Info, Settings drawer, Reset saved preferences, and New
session share one mutually exclusive modal-overlay state. The shared shell owns
focus containment and restoration, Escape/X/direct-backdrop dismissal, and
confirmation cancellation. Settings question-mark disclosures are local
non-modal help surfaces with hover/focus previews and pinned click/tap behavior.

The overview and three Help chapters are pre-rendered, same-origin video assets
with posters and transcripts. Remotion remains authoring-only under
`video/remotion/`; no Remotion runtime ships with the app. Videos and the brand
logo are site assets only and never enter user ZIPs. The unchanged v0.5 clips
predate project-workspace support; current written Help covers that workflow.

Desktop Parameters visibility is session-only view state. The gear collapses
the third column and allows Preview to fill the freed width; it does not alter
settings, revision identity, or workbook progress. Tablet retains a modal
Settings drawer, and mobile retains the Settings destination.
When a workspace item exists, the desktop center column ends with the Preview
Footer Dock. Its shared BUILD/DOWNLOAD controls reuse the same export state and
accepted Blob as Parameters; only the dock owns the live status announcement.
Mobile Preview uses one content scroller: its mode navigation and export actions
remain outside that scroller, while metrics and Package-local controls move with
the runbook or prompt content.

## Main modules

| Location | Responsibility |
| --- | --- |
| `src/app/workbench/` | Reducer, selectors, validated preferences, browser services, hooks, and UI. |
| `src/domain/` | File/project admission, safe source classification, extraction, tree hashing, media/OCR/LaTeX, profiles, settings, and context. |
| `src/prompting/` | Canonical template loading and `PromptBundle` rendering. |
| `src/export/` | Semantic runbook, immutable workbook/progress engine, schema-v6 manifest, ZIP, safe paths, downloads. |
| `prompts/` | Canonical One-shot and four Manual Markdown templates. |
| `public/brand/`, `public/media/demo/` | Same-origin logo/icon and pre-rendered Help media; never exported with document packages. |
| `content/updates/`, `scripts/updates/` | JSON-authoritative authored Updates ledger/posts and offline validation/rendering commands. |
| `public/media/updates/` | Reviewed, synthetic, same-origin release media; distinct from session content and never exported with packages. |
| `video/remotion/` | Authoring-only deterministic demo and release compositions. |
| `tests/e2e/` | Built-preview Chromium, real fixtures, downloads, `file://`, network, and visual QA. |

See [manifest v6](manifest-v6.md), [privacy](privacy.md), [model guidance](model-guidance/README.md),
and [extraction limitations](extraction-limitations.md).
