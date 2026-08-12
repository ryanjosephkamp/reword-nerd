# Architecture

`reword-nerd` is a static React application. Document work happens in browser
memory; there is no application server, account service, model request,
telemetry sender, or document persistence layer.

## Processing and state path

```text
File API / drop event
  -> admission and signature checks
  -> bounded format-specific extraction
  -> editable review + asset/OCR decisions
  -> settings + separate One-shot/Manual context estimates
  -> PromptBundle (One-shot + canonical Manual stages)
  -> immutable semantic RunbookDocument + DocumentWorkbook[]
  -> schema-v5 manifest + deterministic ZIP Blob
  -> revision-bound rich Runbook/One-shot/Manual preview
  -> explicit ZIP or progress-copy download
```

Admission enforces format and queue limits before extraction. Text and Markdown
are strict UTF-8; DOCX converts locally; PDF uses the bundled parser worker;
LaTeX and safe project ZIPs are analyzed without execution. Optional visuals,
page capture, and English OCR are local, bounded, and review-first. Batch IDs
prevent late extraction results from restoring removed or stale documents.

The reducer holds original `File` objects, extracted text and hashes, warnings,
review state, assets/OCR, selection, global settings, and per-file overrides in
memory. A confirmed extraction becomes review-required again after editing.

## Prompt and context contracts

`src/prompting/renderPromptBundle.ts` imports all root Markdown templates as raw
assets. `PromptBundle` contains `oneShot` plus the unchanged Manual `decompose`,
`rewrite`, `verify`, and `final` prompt set. Provider strategy metadata controls
portable layout guidance without changing canonical stage meaning or response
markers.

`assessContext` returns separate conservative `oneShotWorkflowTokens` and
`manualWorkflowTokens`, ratios, and oversize states. One-shot oversize is an
advisory. Manual oversize retains the required document-specific acknowledgement
boundary and compatibility aliases for older internal consumers.

## Schema-v5 runbook and workbook engine

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

`src/export/package.ts` snapshots reviewed inputs, assigns safe deterministic
document keys, hashes every declared artifact, and emits schema `5` with package
format `dual-mode-prompt-package`. Entries are sorted by code-unit path order,
use a fixed 1980 timestamp and permissions, STORE immutable binaries, and
DEFLATE-9 generated text. Root `OPEN-ME.html` links to each document's workflow
siblings. Canonical prompts live under each document's `one-shot/` and
`manual-prompts/` directories; combined workbooks live under
`combined-prompts/`. Full-HTML eligibility uses a monotonic final-render pass so
manifest status, runbook text, hashes, and archived bytes agree at the cap.

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
contains only global model/context, rewrite, processing, and tutorial-version
preferences. Workbench documents and workbook progress are never included.

`src/version.ts` exposes `APP_VERSION` from package metadata. The footer and
Info dialog render `0.5.0` from that source, while schema-v5 contracts and tests
require the manifest package version to match the release.

## Overlay, guidance, and layout boundary

Quick start, Help, Info, Settings drawer, Reset saved preferences, and New
session share one mutually exclusive modal-overlay state. The shared shell owns
focus containment and restoration, Escape/X/direct-backdrop dismissal, and
confirmation cancellation. Settings question-mark disclosures are local
non-modal help surfaces with hover/focus previews and pinned click/tap behavior.

The overview and three Help chapters are pre-rendered, same-origin video assets
with posters and transcripts. Remotion remains authoring-only under
`video/remotion/`; no Remotion runtime ships with the app. Videos and the brand
logo are site assets only and never enter user ZIPs.

Desktop Parameters visibility is session-only view state. The gear collapses
the third column and allows Preview to fill the freed width; it does not alter
settings, revision identity, or workbook progress. Tablet retains a modal
Settings drawer, and mobile retains the Settings destination.

## Main modules

| Location | Responsibility |
| --- | --- |
| `src/app/workbench/` | Reducer, selectors, validated preferences, browser services, hooks, and UI. |
| `src/domain/` | Admission, extraction, hashing, media/OCR/LaTeX, profiles, settings, and context. |
| `src/prompting/` | Canonical template loading and `PromptBundle` rendering. |
| `src/export/` | Semantic runbook, immutable workbook/progress engine, schema-v5 manifest, ZIP, safe paths, downloads. |
| `prompts/` | Canonical One-shot and four Manual Markdown templates. |
| `public/brand/`, `public/media/demo/` | Same-origin logo/icon and pre-rendered Help media; never exported with document packages. |
| `video/remotion/` | Authoring-only deterministic demo compositions. |
| `tests/e2e/` | Built-preview Chromium, real fixtures, downloads, `file://`, network, and visual QA. |

See [manifest v5](manifest-v5.md), [privacy](privacy.md), [model guidance](model-guidance/README.md),
and [extraction limitations](extraction-limitations.md).
