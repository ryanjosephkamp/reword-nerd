# Night Terminal Design System and UI Inventory

## Scope and authority

This document records the approved visual source of truth for the browser-only
Text workbench and its same-style Image companion. The original Text composition
is derived from:

- `docs/design/references/night-terminal-desktop.png` (1586 × 992)
- `docs/design/references/night-terminal-mobile.png` (853 × 1844)

Implementation must preserve the dual One-shot/Manual contract, the four-stage
Decompose → Rewrite → Verify → Final pipeline, and canonical root `prompts/`
files. The references govern
the initial workbench composition; unlisted product copy, decorative effects,
and major component families require explicit approval.

## Color tokens

| Token | Value | Intended use |
| --- | --- | --- |
| `--color-canvas` | `#090b10` | App background and terminal canvas |
| `--color-surface` | `#11151d` | Header, inspector, and raised regions |
| `--color-surface-raised` | `#171c25` | Selected file row and active tab surface |
| `--color-border` | `#303746` | Dividers, controls, editor edge, and rules |
| `--color-text` | `#d7dde8` | Primary text and icons |
| `--color-muted` | `#7f8a9d` | Secondary text, line numbers, and metadata |
| `--color-ready` | `#42e8b4` | Brand mark, selected state, readiness, progress, and primary action |
| `--color-review` | `#f2b84b` | Review warning and pending-review state |
| `--color-blocked` | `#ff667a` | Blocked/error state |
| `--image-action` | `#ff9f1c` | Image links, selection, actions, and ready state |
| `--image-review` | `#ffd166` | Image review and pending-attention state |

No CSS gradients, glows, or color substitutions are permitted in interface
chrome. Borders are crisp, low-contrast rules; emphasis comes from hierarchy
and the approved semantic colors rather than shadows. The supplied raster logo
is approved brand artwork rather than an interface-surface effect.

Text and static Updates links use `--color-ready` (`#42e8b4`) in both their
unvisited and visited states. Image links use orange `--image-action`
(`#ff9f1c`) and remain orange after visiting; browser-default blue or purple
link colors are not part of either portal. Image yellow `#ffd166` is reserved
for review/pending meaning so it is not confused with orange action/ready state.
Text stays teal and Image stays orange when the physical page changes; color is
always paired with labels, icons, borders, or status text. Light-background
offline Text workbook companions use the accessible darker teal `#007a5a` for
both states so the same semantic treatment retains AA contrast on white.

## Image companion composition

The physical Image page mirrors the Night Terminal hierarchy without replacing
the Text default. Its supplied orange pyramid artwork replaces the Text logo in
Image Quick Start/Info identity; the dark canvas, typography, borders, spacing,
and blocked/error color remain shared. The inline `TEXT / IMAGE` portal links
sit beside the brand: Text is teal and Image is orange, with the active portal
identified by more than color.

Desktop Image uses three columns: an image queue with thumbnails and distinct
bulk-selection/Include/Omit/Remove controls; a focused source preview with
metadata, warnings, OCR review, and built pair cards; and Settings with
`DEFAULTS` and `SELECTED [N]` scopes plus Build/Download. Mobile uses
`IMAGES / PREVIEW / SETTINGS`; the inactive Preview panel owns no package-card
object URLs. Focused navigation never implies bulk selection.

Built output uses responsive cards rather than a wide table. Every card shows
the snapshotted source, provenance, model profile, run card, exact prompt,
Copy Prompt/Image, and visible Open/Download/drag fallbacks. Orange identifies
Image action/ready controls; yellow identifies review or copy-fallback status.
Keyboard focus remains explicit, and no state is communicated by color alone.

## Typography and spacing

- Typeface: a system monospace stack (`ui-monospace`, `SFMono-Regular`,
  `Menlo`, `Monaco`, `Consolas`, monospace). It is used for both editorial
  content and interface chrome.
- Brand: lower-case `reword_nerd/`, bold, green, approximately 24–28 px on
  desktop and 28–32 px on mobile.
- Section/chrome labels: uppercase, 15–18 px, medium-to-semibold weight,
  compact letter spacing. Examples include `FILES [3]`, `EXTRACTED_TEXT`, and
  `PARAMETERS`.
- Body/editor text: 16–18 px desktop with a generous 1.6–1.75 line height;
  19–21 px mobile with a similar or slightly larger line height.
- Metadata: 12–14 px desktop and 14–16 px mobile, using `--color-muted`.
- Spacing cadence: 8 px base unit. Desktop uses 24 px panel padding and
  16–20 px control gaps; mobile uses 30–34 px page gutters and 20–28 px
  vertical stacking.
- Corners: controls and editor use a restrained 0–4 px radius; no pill-shaped
  surfaces except the compact toggle track.

## Layout and responsive rules

### Desktop workbench

- The desktop frame fills the viewport with a fixed header and footer.
- Header: brand at left; centered `LOCAL SESSION` and `Files stay in this
  browser`; compact New session, Settings, Help, and Info icon buttons at right.
- Main region: three columns. Files occupies about 24%, extracted-text preview
  about 50%, and parameters about 26%. Columns are separated with one-pixel
  `--color-border` rules.
- Files: an uppercase heading with add-file and Add Folder actions, then a
  vertical list. The selected file or project has a green left rule and
  `--color-surface-raised` fill. Every item has an icon, name, status, and
  overflow menu.
- Preview: heading row, amber review warning, global Source/Assets/Package
  navigation, nested Extracted Text/Original source tabs, a document editor or
  project file-review surface, and a metrics/context strip.
- Parameters: a per-file-override toggle, labelled selects, a labelled
  textarea, document/code processing, contextual help disclosures, then the large
  primary export action and privacy reassurance. The desktop gear may collapse
  this panel; Preview fills the freed width while Files retains its width.
- Preview Footer Dock: when at least one source exists, the center column ends
  with compact side-by-side Build Package and Download ZIP actions plus concise
  local-processing or blocker copy. It shares export state with Parameters and
  never covers the editor.
- Footer: file-status summary at left; saved state and version at right.

### Mobile workbench

- Mobile removes the desktop session copy, utility buttons, desktop columns,
  and footer version/status chrome. The brand and overflow menu remain.
- A full-width three-tab strip is the primary navigation: `FILES`, `PREVIEW`,
  `SETTINGS`. The active tab uses primary text and a 3–4 px green underline.
- The Preview tab shows the compact `EXTRACTED_TEXT` heading, one selected-file
  disclosure control, amber review warning, editor, context meter, primary
  action, and compact status summary in that order.
- Mobile editor stays readable with a single line-number column and an internal
  scroll area. The selected filename/status row is never visually split from
  its disclosure affordance.
- At narrow widths use a one-column tabbed layout; do not squeeze the desktop
  three-pane layout. Intermediate/tablet layout may collapse the file or
  parameters pane, but must retain the same hierarchy and tokens.

## Component inventory and states

| Component | Desktop treatment | Mobile treatment | Required states |
| --- | --- | --- | --- |
| App shell | viewport terminal frame | stacked terminal frame | default, reduced motion |
| Brand header | brand, session statement, utility icons | brand and overflow icon | default, utility focus |
| Utility icon button | 40 px square, outlined | hidden except overflow | default, hover, focus-visible, disabled |
| Section heading | uppercase chrome label | uppercase chrome label | default |
| Workspace queue item | file/project icon, name, semantic status, overflow | represented by selected-source disclosure in Preview | default, selected, ready, review, blocked, keyboard focus |
| Add-file button | outlined square plus button | Files-tab action | default, hover, focus-visible, disabled |
| Mobile tab | not used | full-width tab-strip item | inactive, active, focus-visible |
| Extracted-text editor | line numbers, internal scroll, tab | line numbers, internal scroll | default, edited, review-warning, blocked/read-only, focus-visible |
| ORIGINAL preview | nested Source tab with inert rich/raw rendering | same inside Preview | loading, rich, raw, approximate, bounded/truncated, error, disposed |
| Project review | searchable safe file list, inclusion controls, editor | compact file selector plus editor | included, package-only, excluded, invalid, sensitive aggregate warning, confirmed |
| File tab/disclosure | file tab with close icon | selected-file disclosure with chevron | default, expanded, collapsed, focus-visible |
| Warning | amber outlined triangle plus text | same, above editor | visible, hidden when no review needed |
| Form control | full-width outlined select/textarea | same in Settings tab | default, hover, focus-visible, disabled, invalid |
| Toggle | green compact track with `--color-text` thumb | Settings-tab equivalent | on, off, focus-visible, disabled |
| Context meter | labelled percentage bar | stacked card-like meter | normal, warned, acknowledged |
| Primary action | outlined green full-width action | full-width action above persistent navigation | enabled, hover, focus-visible, disabled, busy, export failure |
| Preview Footer Dock | side-by-side shared Build/Download below Preview | omitted; existing mobile actions remain | ready, blocked, building, downloadable, failed/retry |
| Text Quick start | focus-trapped first-visit dialog, local overview video, Review settings primary | contained modal with poster/transcript fallback and Add files secondary | first visit, replay, dismiss, reduced motion |
| Text Help | scrollable chapter guide with lazy local Settings/Review/Package videos | scrollable modal above navigation | open, close, chapter switch, replay |
| Info | branded version/product/creator dialog | opened from mobile utility disclosure | open, close, deliberate external navigation |
| Settings help | question-mark hover/focus preview that pins on click | question-mark tap disclosure | preview, pinned, outside/Escape/X dismissal |
| New session | header restart action and confirmation | mobile utility action and confirmation | open, cancel, confirm, busy invalidation |
| Document processing | permanent Settings fieldset | independently scrollable Settings fieldset | defaults, reprocess, reset |
| Package preview | RUNBOOK/ONE-SHOT/MANUAL tabs, document selector, copy/progress controls | contextual Package view with compact non-occluding controls | Runbook default, One-shot, Manual, stale, progress |
| Status summary | desktop footer counts | compact inline footer | ready/review/blocked aggregate |

All interactive controls need visible keyboard focus, a programmatic label,
and semantic status text. Motion should be limited to short state transitions
and disabled under reduced-motion preferences.

## v0.7 Updates and release-media surfaces

Updates is a static, same-origin builder's journal rather than a new workbench
mode. It uses the Night Terminal canvas, monospace type, crisp borders, muted
metadata, and mint links/actions without importing an external font, player, or
social SDK. Archive and post Share controls are optional enhancements: the
canonical URL, reading flow, feedback links, and transcript remain present
without JavaScript. Native Share success, clipboard fallback, and selectable
manual-copy fallback announce or focus the outcome accessibly.

For required release videos, native controls are muted, inline, non-autoplaying
and `preload="none"`; reduced-motion presentation replaces moving video with the
same poster plus transcript/fallback links. Public authored Updates posts and
release media are site material, distinct from uploaded session content, prompt
packages, and downloaded progress copies. They may demonstrate only synthetic
data and never appear in a user ZIP.

## Icon inventory

Use one consistent thin, square-cornered outline icon family. Icons are
approximately 20–24 px inside 40 px desktop utility targets and align to the
text baseline in file rows.

| Icon | Meaning |
| --- | --- |
| outlined folder | file/open workspace utility |
| outlined gear | settings utility |
| circled question mark | help utility |
| circled i | product and creator information |
| counterclockwise arrow | confirmed new-session action |
| plus | add files |
| document/page | DOCX or general document |
| markdown document | Markdown file |
| PDF document | PDF file |
| vertical ellipsis | per-file/overflow menu |
| x | close desktop file tab |
| triangle warning | extracted-content review warning |
| chevron down | disclosure/select affordance |
| info circle | context-estimate explanation |
| wireframe cube | build-package action |

Semantic status dots are small filled circles: green ready, amber review,
red blocked. They supplement status words; they never stand alone.

## Approved visible-copy inventory

The following strings are permitted because they appear in the approved
references. Canonical pipeline prompts remain in the root `prompts/` files and
are not replaced by this inventory.

### Shared and desktop

- `reword_nerd/`
- `LOCAL SESSION`
- `Files stay in this browser`
- `FILES [3]`
- `EXTRACTED_TEXT`
- `PARAMETERS`
- `report.docx`, `notes.md`, `appendix.pdf`
- `READY`, `REVIEW`, `BLOCKED`
- `Review extracted content before export`
- `PER-FILE OVERRIDE`
- `Model profile`, `General Purpose (GPT-4.1)`
- `Tone`, `Professional`
- `Formality`, `Formal`
- `Length`, `Long`
- `Output language`, `English`
- `Custom requirements`
- `Focus on clarity and actionable insights. Preserve key data points and structure.`
- `BUILD PACKAGE`
- `DOWNLOAD ZIP`
- `SOURCE`, `PACKAGE`
- `PACKAGE PREVIEW`
- `Package will be generated in-browser.`
- `No files leave your device.`
- `WORDS: 1250`, `CHARS: 8420`, `LINES: 220`
- `ESTIMATE: ~2,500 WORDS`, `50%`
- `3 files • 2 ready • 1 needs review`
- `ALL CHANGES SAVED`, `v1.0.0`

The version string in the visual reference is compositional sample copy. The
current implementation renders its package version (`v0.7.0`) in that footer
position while preserving the same hierarchy and session-only meaning.

## v0.6 source and project additions

- Global SOURCE navigation contains an accessible `EXTRACTED TEXT | ORIGINAL`
  tablist. ORIGINAL rendering is inert and view-only; opening it cannot change
  review or package revision.
- Folder and ZIP projects remain one workspace row. Project review adds a
  searchable safe-file list, immutable path/status metadata, prompt/package
  inclusion controls, a text editor, and one project-level confirmation.
- Code & Structured Text is a permanent Settings fieldset. Its contextual help
  covers documentation/markup, comments/docstrings, user-facing strings,
  narrative structured data, root `.gitignore`, safe exclusions/assets, and
  the always-on executable-syntax protection.
- Desktop uses the approved Preview Footer Dock. The center action pair mirrors
  Parameters without creating a second export path or live announcement.
- Context presentation adds project file count/risk reasons and keeps the
  inspect-diffs/run-tests warning visible without changing Night Terminal
  semantic colors.
- Existing Text demo video bytes and tutorial version remain unchanged. Text Quick Start
  and Text Help label those clips as document-workflow demonstrations that predate
  project-workspace support.
- Image Quick Start uses its own silent, same-origin orange video walkthrough,
  poster, and transcript. It does not reuse or recolor the Text tutorial.

## v0.5.1 polish

- Info separates the product repository from a boxed creator region, with
  high-contrast local-theme link controls and explicit GitHub-profile wording.
- Assets offers DETAIL and GALLERY views. Gallery cards show selected and
  included states without hiding the full-size review path.
- On mobile, Preview mode navigation and export actions remain fixed workspace
  controls; document metrics and Package-local controls belong to the single
  scrolling content surface.
- One-shot provides the same contextual, exact-byte Copy action as each Manual
  stage.

## v0.5 interaction additions

- Text first visit opens a focus-trapped Quick start with a non-autoplaying local
  overview. Text Help provides Settings, Review, and Package chapters, local videos,
  transcripts, and replay. Reduced motion replaces playback with static posters.
- Quick start, Help, Info, Settings drawer, Reset saved preferences, and New
  session share one modal overlay contract. X, Escape, and direct backdrop
  activation dismiss; internal controls do not. Focus stays contained and
  returns to the initiating control.
- Every visible and conditional Settings control has a reusable question-mark
  disclosure. Hover/focus previews guidance; click or tap pins one surface per
  inspector until X, Escape, or outside activation dismisses it.
- Empty Review explains why no editor is present and exposes **ADD FILES** through
  the existing hidden multi-file input.
- Document Processing is always visible. At 320, 360, 390, and 412px, Settings
  owns an independent dynamic-viewport scroll area with bottom padding above the
  fixed navigation, so its last controls remain reachable.
- Package preview keeps Source/Assets/Package separate from
  Runbook/One-shot/Manual and
  document selection. Narrow portrait uses stacked/compact top actions that do
  not cover the prompt being edited; Build then Download remains the export order.
- Runbook is selected after build and renders semantic package guidance. Prompt
  tabs contain only editable prompt/response work. The sticky document-name row
  sits below the toolbar with its divider separated from the filename.
- Desktop Settings is visible by default and collapses without invalidating a
  package or losing progress. Tablet keeps its drawer and mobile keeps its
  Settings destination.
- New session warns before clearing documents, extraction/review state, workbook
  progress, and the package; confirmed reset preserves global saved Settings and
  returns focus to Add files. Reset saved preferences retains its opposite scope.

### Settings-help copy contract

| Setting | Guidance scope |
| --- | --- |
| Per-file override | Replaces global rewrite values for the selected document; model profile and context limit remain global. |
| Model profile | Applies dated family-specific prompt structure without contacting a provider. |
| Model label | Names a local, self-hosted, fine-tuned, or unlisted Custom model in metadata. |
| Context limit | Drives separate One-shot and Manual size estimates and warnings. |
| Tone | Preserve source, academic, professional, technical, or plain. |
| Formality | Preserve source, standard, or formal register. |
| Length | Preserve source length, make it more concise, or expand it. |
| Output language | Requests a final language or preserves the source language. |
| Custom requirements | Adds up to 2,000 code points of extra constraints verbatim to prompts. |
| Document processing | Controls local extraction and reprocesses an uploaded document when changed. |
| Extract embedded images | Recovers supported figures/media for review and optional packaging. |
| Capture PDF page visuals | Renders selected pages when separate layout/media recovery is insufficient. |
| PDF pages | Limits page extraction, capture, and OCR to all pages or selected ranges. |
| Page visual quality | Standard favors size/speed; High favors sharpness. |
| OCR | Off, textless selected PDF pages, or all selected pages; bundled English OCR requires review. |
| OCR extracted raster images | Also recognizes recovered raster assets when image extraction is enabled. |
| Exclude likely decorative images | Uses conservative size/type heuristics; Assets remains the review authority. |
| Documentation and markup | Includes prose while protecting tags, attributes, links, and structure. |
| Comments and docstrings | Includes comments/docstrings while protecting surrounding executable syntax. |
| User-facing strings | Includes visible interface text while protecting identifiers, protocol values, and placeholders. |
| Narrative structured-data values | Optionally includes prose-like values while preserving keys, types, numbers, and shape. |
| Honor root .gitignore | Applies root ignore patterns locally during initial project inclusion. |
| Exclude dependencies/build/generated | Excludes common dependency, vendor, cache, build, generated, minified, source-map, and lock content by default. |
| Preserve safe non-text assets | Keeps eligible assets in the sanitized package without putting their bytes in prompts. |
| Preserve executable syntax | Always on; protects control flow, identifiers, imports, signatures, paths, and structural tokens. |

### Editor sample content

- `Executive Summary`
- `This report provides an analysis of current market conditions, key trends, and strategic opportunities for Q2 2024.`
- `Market Overview`
- `The global market continues to evolve, driven by technological advancements, shifting consumer behaviors, and macroeconomic factors. Key highlights include:`
- `- Increased demand for digital solutions across industries.`
- `- Supply chain normalization with regional variations.`
- `- Inflation stabilizing yet remaining above target in major economies.`
- `Key Findings`
- `1. Digital Transformation Accelerating`
- `Organizations are prioritizing cloud adoption, automation, and data-driven decision-making.`
- `2. Customer Expectations Rising`
- `Consumers expect seamless, personalized experiences`

### Mobile-specific

- `FILES`, `REVIEW`, `SETTINGS` in a persistent safe-area bottom command bar
- selected-document identity, path, status, page/image/OCR counts
- `SOURCE`, `ASSETS`, `PACKAGE`
- `report.docx`, `NEEDS REVIEW`
- `Review extracted content before export`
- `ESTIMATE: ~2,500 WORDS`, `50%`
- `BUILD PACKAGE`
- `3 files • 2 ready • 1 review`

## Implemented interaction model

- Files are added through the add-file affordance or a drop zone; folder
  workspaces use Add Folder and project ZIPs use the file affordance. Queue status
  changes are surfaced in the file item and status summary.
- Selecting a file or project updates Preview; standalone files retain optional
  per-file rewrite settings.
- The extracted text is reviewable and editable before export; a warning remains
  visible until the review condition is resolved.
- The per-file override toggle reveals or enables the selected file's parameter
  controls without changing the global settings source of truth.
- The context meter warns when estimated context is oversized; acknowledgement,
  rather than a hard block, permits export.
- `BUILD PACKAGE` creates the revision-bound archive and structured preview in
  memory, switches Preview to Package, and moves focus to its heading. It never
  downloads automatically.
- Desktop Preview Footer Dock and Parameters invoke that same build/download
  state; dock failures name the safe retry action and are announced once.
- `SOURCE`, `ASSETS`, and `PACKAGE` switch the Preview pane without adding a top-level
  mobile tab. Each package prompt has an accessible Copy control.
- `DOWNLOAD ZIP` exports the accepted Blob explicitly. A download failure keeps
  that Blob available for retry; a content or settings mutation invalidates it.
- Mobile tabs preserve the same session state while changing the visible pane.
- Mobile uses a task-first app layout: compact header, bounded scrollable work
  surface, sticky contextual review action, and bottom navigation. Desktop
  retains the approved three-column dashboard.

## Implementation guardrails

- Use React components that mirror the inventory: shell, header, file queue,
  editor, settings inspector, context meter, primary action, and status
  summary. Keep `App` composition-focused.
- Use CSS variables for all listed tokens. Do not introduce a gradient, glow,
  external font, remote asset, telemetry call, or post-load external request.
- Respect the browser-only, session-memory-only boundary. No backend, account,
  persistence, service worker, or provider/model calls are part of this UI.
