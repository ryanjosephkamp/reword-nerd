# Design QA

The selected target is the approved Option 3 reference: compact application
header, document identity and status, page/image/OCR metrics, Source/Assets
views, horizontal figure cards, a sticky review action, and a persistent
Files/Review/Settings bottom command bar.

The implementation preserves the terminal palette and desktop dashboard.
Current built-preview Chromium QA covers 1586 × 992 desktop, 1024 × 768 tablet,
and 320/360/390/412 CSS-pixel portrait widths. It asserts containment,
independent Settings scrolling, bottom-navigation clearance, keyboard focus,
empty Review, first-visit Quick start, Settings help, rich Runbook preview,
One-shot preview, Manual progress, the package filename/divider geometry, and
explicit downloads. Desktop coverage also verifies that Settings collapse is
view-only. Generated evidence is ignored under `output/playwright/`.

Release QA also opens the exported combined workbook from a real local
`file://` path, verifies README/One-shot/Manual keyboard tabs, rich README,
Clipboard and selection fallback, progress download, no storage, and no
external request. Release checks also validate same-origin demo media,
reduced-motion poster behavior, the media-size budget, modal dismissal/focus,
and the exact deliberate Info-link allowlist. Visual approval remains a human
inspection step; automated geometry assertions do not claim pixel identity.
