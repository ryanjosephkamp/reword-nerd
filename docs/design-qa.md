# Mobile design QA

The selected target is the approved Option 3 reference: compact application
header, document identity and status, page/image/OCR metrics, Source/Assets
views, horizontal figure cards, a sticky review action, and a persistent
Files/Review/Settings bottom command bar.

The implementation preserves the existing terminal palette and desktop
dashboard. Mobile validation covers 320, 360, 390, and 412 CSS-pixel widths,
safe-area padding, keyboard focus, text zoom containment, real extracted-image
thumbnails, and the complete review/build/download path. Browser comparison is
performed in the user-selected Chromium environment against the approved
reference. The combined 390 × 844 comparison is generated at
`output/playwright/option3-comparison-390x844.png` during release QA. The result
matches the target hierarchy while intentionally using the current fixture
content and exposing Package as the third contextual view.
