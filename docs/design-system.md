# Night Terminal Design System and UI Inventory

## Scope and authority

This document records the approved visual source of truth for the browser-only
workbench. It is derived only from:

- `docs/design/references/night-terminal-desktop.png` (1586 × 992)
- `docs/design/references/night-terminal-mobile.png` (853 × 1844)

Implementation must preserve the four-stage Decompose → Rewrite → Verify →
Final pipeline and the canonical root `prompts/` files. The references govern
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

No gradients, glows, or color substitutions are permitted. Borders are crisp,
low-contrast rules; emphasis comes from hierarchy and the approved semantic
colors rather than shadows.

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
  browser`; compact utility icon buttons at right.
- Main region: three columns. Files occupies about 24%, extracted-text preview
  about 50%, and parameters about 26%. Columns are separated with one-pixel
  `--color-border` rules.
- Files: an uppercase heading with a square add-file button, then a vertical
  list. The selected file has a green left rule and `--color-surface-raised`
  fill. Every item has a file-type icon, filename, status, and overflow menu.
- Preview: heading row, amber review warning, one file tab, a line-numbered
  text editor, and a bottom metrics/context-meter strip.
- Parameters: a per-file-override toggle, labelled selects, a labelled
  textarea, then the large primary export action and privacy reassurance.
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
| File queue item | icon, name, semantic status, overflow | represented by selected-file disclosure in Preview | default, selected, ready, review, blocked, keyboard focus |
| Add-file button | outlined square plus button | Files-tab action | default, hover, focus-visible, disabled |
| Mobile tab | not used | full-width tab-strip item | inactive, active, focus-visible |
| Extracted-text editor | line numbers, internal scroll, tab | line numbers, internal scroll | default, edited, review-warning, blocked/read-only, focus-visible |
| File tab/disclosure | file tab with close icon | selected-file disclosure with chevron | default, expanded, collapsed, focus-visible |
| Warning | amber outlined triangle plus text | same, above editor | visible, hidden when no review needed |
| Form control | full-width outlined select/textarea | same in Settings tab | default, hover, focus-visible, disabled, invalid |
| Toggle | green compact track with `--color-text` thumb | Settings-tab equivalent | on, off, focus-visible, disabled |
| Context meter | labelled percentage bar | stacked card-like meter | normal, warned, acknowledged |
| Primary action | outlined green full-width action | full-width action below meter | enabled, hover, focus-visible, disabled, busy, export failure |
| Status summary | desktop footer counts | compact inline footer | ready/review/blocked aggregate |

All interactive controls need visible keyboard focus, a programmatic label,
and semantic status text. Motion should be limited to short state transitions
and disabled under reduced-motion preferences.

## Icon inventory

Use one consistent thin, square-cornered outline icon family. Icons are
approximately 20–24 px inside 40 px desktop utility targets and align to the
text baseline in file rows.

| Icon | Meaning |
| --- | --- |
| outlined folder | file/open workspace utility |
| outlined gear | settings utility |
| circled question mark | help utility |
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
- `Package will be generated in-browser.`
- `No files leave your device.`
- `WORDS: 1250`, `CHARS: 8420`, `LINES: 220`
- `ESTIMATE: ~2,500 WORDS`, `50%`
- `3 files • 2 ready • 1 needs review`
- `ALL CHANGES SAVED`, `v1.0.0`

The version string in the visual reference is compositional sample copy. The
current implementation renders its package version (`v0.1.0`) in that footer
position while preserving the same hierarchy and session-only meaning.

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

- `FILES`, `PREVIEW`, `SETTINGS`
- `EXTRACTED_TEXT`
- `report.docx`, `READY`
- `Review extracted content before export`
- `ESTIMATE: ~2,500 WORDS`, `50%`
- `BUILD PACKAGE`
- `3 files • 2 ready • 1 review`

## Interaction model for later implementation

- Files are added through the add-file affordance or a drop zone; queue status
  changes are surfaced in the file item and status summary.
- Selecting a file updates the preview and the optional per-file settings.
- The extracted text is reviewable and editable before export; a warning remains
  visible until the review condition is resolved.
- The per-file override toggle reveals or enables the selected file's parameter
  controls without changing the global settings source of truth.
- The context meter warns when estimated context is oversized; acknowledgement,
  rather than a hard block, permits export.
- `BUILD PACKAGE` creates the in-browser archive. Failure retains in-memory
  state and displays a safe error; no files leave the device.
- Mobile tabs preserve the same session state while changing the visible pane.

## Implementation guardrails

- Use React components that mirror the inventory: shell, header, file queue,
  editor, settings inspector, context meter, primary action, and status
  summary. Keep `App` composition-focused.
- Use CSS variables for all listed tokens. Do not introduce a gradient, glow,
  external font, remote asset, telemetry call, or post-load external request.
- Respect the browser-only, session-memory-only boundary. No backend, account,
  persistence, service worker, or provider/model calls are part of this UI.
