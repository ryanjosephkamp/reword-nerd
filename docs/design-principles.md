# Design Principles — reword-nerd

## 1. Fidelity First
Text work preserves meaning while changing structure and phrasing. Image work
requests a faithful new rendition while applying only explicit changes. Neither
workflow promises identity that an external model cannot guarantee.

## 2. Explicit Decomposition
The package makes the decomposition stage explicit and gives the user a clear
place to inspect its result before it is carried into later stages.

## 3. Genuine Structural Difference
The rewrite should not be a shallow synonym substitution. Sentence structure, paragraph organization, and phrasing should change meaningfully.

## 4. Inspectability
Users should be able to examine reviewed source extraction, settings, prompts,
run cards, decomposition, and verification artifacts before following a
package. Hidden multi-step behavior is avoided.

## 5. Model-Agnostic
The core value lives in the prompt pipeline and process design. The browser
workbench creates a manual package for a user to run with a model they choose;
it does not execute that model itself.

## 6. Two Portals, One Custody Boundary
Text remains the default root workbench and Image remains a separate companion
page and sibling state domain. Both process source material locally in the browser
and transfer it only through a deliberate download, clipboard copy, drag/open, or user-directed navigation action.
Preferences are isolated, and Image never broadens Text contracts.

## 7. One Source, One Prompt
Each included Image pair contains one source image and one prompt. Bulk settings
may prepare many independent pairs, but the product never asks a provider to
generate a batch or silently combines references.

## 8. Neutral Professional Framing
This project supports high-quality rewriting, paraphrasing, and reference-image
prompt preparation for academic, professional, technical, and creative work.
Documentation and prompts use precise, non-promotional language.
