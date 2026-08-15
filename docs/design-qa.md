# Design QA

The selected mobile target is the approved Option 3 reference: compact application
header, document identity and status, page/image/OCR metrics, Source/Assets
views, horizontal figure cards, a sticky review action, and a persistent
Files/Review/Settings bottom command bar.

The selected v0.6 desktop action target is **Preview Footer Dock**: Build and
Download sit together below the center Preview while the existing stacked
Parameters actions remain available. Both surfaces use one export state and one
accepted Blob.

The implementation preserves the terminal palette and desktop dashboard.
Built-preview Chromium QA covers 1586 × 992 desktop, 1024 × 768 tablet,
and 320/360/390/412 CSS-pixel portrait widths. It asserts containment,
independent Settings scrolling, bottom-navigation clearance, keyboard focus,
empty Review, first-visit Quick start, Settings help, rich Runbook preview,
One-shot preview, Manual progress, the package filename/divider geometry, and
explicit downloads. V0.6 adds safe standalone/code, unknown UTF-8, Add Folder,
generic project ZIP, project review, ORIGINAL preview, context-risk recovery,
and Preview Footer Dock coverage. Desktop also verifies Settings collapse is
view-only. Generated evidence is ignored under `output/playwright/`.

Release QA also opens the exported combined workbook from a real local
`file://` path, verifies README/One-shot/Manual keyboard tabs, rich README,
Clipboard and selection fallback, progress download, no storage, and no
external request. Release checks also validate same-origin demo media,
reduced-motion poster behavior, the media-size budget, modal dismissal/focus,
and the exact deliberate Info-link allowlist. Visual approval remains a human
inspection step; automated geometry assertions do not claim pixel identity.

## v0.6 fidelity ledger

| Reference or approved choice | Concrete comparison retained in v0.6 | Release evidence |
| --- | --- | --- |
| Night Terminal desktop, 1586 × 992 | Files remains the narrow left rail; Preview remains primary; open Parameters retains the right inspector and collapses without moving Files. | Desktop screenshot plus column-geometry and collapse browser assertions. |
| Approved Preview Footer Dock | BUILD PACKAGE and DOWNLOAD ZIP appear side-by-side below center Preview, never over the editor, and use the same busy/ready/failure state as Parameters. | Desktop dock screenshot, shared-export component/race tests, no-overlap assertion. |
| Night Terminal mobile, 853 × 1844 composition | Files/Review/Settings bottom navigation and Source/Assets/Package preview controls remain persistent while metrics and package-local controls scroll away. | 320/360/390/412 screenshots and fixed-control/content-scroll assertions. |
| Approved palette and typography | Canvas/surfaces/rules keep `#090b10`, `#11151d`, `#171c25`, and `#303746`; ready/review/blocked retain green/amber/red; system monospace remains universal. | Token tests and computed-style screenshot inspection; no gradient/glow. |
| Existing Source/Assets/Package hierarchy | `EXTRACTED TEXT | ORIGINAL` and project file review are nested inside Source rather than becoming a fourth global or mobile destination. | Keyboard tab semantics, focus, and responsive containment tests. |
| Existing Package reading priority | RUNBOOK remains the default after Build; prompt workspaces and exact-byte Copy remain separate; dock/status chrome does not reduce mobile reading space. | Package-flow tests and mobile screenshot inspection. |
| Approved local-session framing | Header, one live export status, explicit Download, and local-processing reassurance remain visible without implying provider execution. | Accessibility/live-region tests and privacy/network scan. |

## Image companion comparison ledger

This ledger records the sanitized Image implementation comparisons from local
built-preview review. Evidence is Chromium-only; it does not claim Safari,
Firefox, cross-browser, or pixel-identity verification.

| Approved Image reference or contract | Concrete comparison retained | Chromium-only evidence |
| --- | --- | --- |
| Inline `TEXT / IMAGE` portal switch | Text remains the default teal destination; Image is a physical companion destination with an orange active state rather than a mode toggle inside Text. | Direct root/Image navigation and reload assertions plus keyboard-focus color checks. |
| Supplied orange pyramid identity | Image Quick Start and portal identity use the orange pyramid while Text keeps its existing logo and teal identity. | Artwork-path, accessible-name, metadata, and portal-isolation assertions. |
| Orange action versus yellow review semantics | Image interaction and Ready use `#ff9f1c`; review or pending attention uses distinct `#ffd166`, with labels and icons carrying the state as well. | Computed-style, token, visited-link, focus, and state-label assertions. |
| Night Terminal desktop at 1586 × 992 | Queue, focused Preview, and Settings keep the approved three-column hierarchy; built pair cards remain in the center workflow. | Containment, region, settings-scroll, package-card, and rendered-DOM assertions. |
| Tablet at 1024 × 768 | Header rows remain separated and Settings stays reachable without clipping the brand, local-session notice, or utilities. | Header-spacing, containment, focus, and settings-reachability assertions. |
| Portrait widths 320 / 360 / 390 / 412 | `IMAGES / PREVIEW / SETTINGS` remains the mobile navigation; Quick Start opens at its title, and package cards/settings remain reachable without horizontal overflow. | Per-width geometry, roving-tab, modal-focus, package-card, and rendered-DOM assertions. |
| Focus versus bulk selection | A focused preview does not silently select an item; selected-count configuration applies only checked fields after the explicit Apply action. | Reducer and browser interaction assertions for focus, selection, field masks, and individual overrides. |
| Local confirmed-set package workflow | Build creates one in-memory ZIP for the confirmed set, Download is deliberate, and later mutation removes stale ZIP and preview cards together. | Real two-image build/download, deterministic archive inspection, stale-output suppression, and no-auto-download assertions. |
| Portable offline package cards | Root and per-pair cards keep Copy Prompt and progressive Copy Image, while Open Image, Download Image, and drag remain available under `file://`. | Extracted-package Chromium checks across mobile and desktop with external-request and storage observation. |
