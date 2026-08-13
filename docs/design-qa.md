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
