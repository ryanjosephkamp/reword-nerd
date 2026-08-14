# Historical reword-nerd v1 implementation plan

> Historical record only. This plan describes the original v0.1 foundation,
> not the current v0.7 Text capability, completed Image companion, or release
> status. See the repository README, architecture, design system, manifest-v6,
> and Image package manifest-v1 specifications for current behavior.

## Current companion integration note

The companion implementation is outside this historical plan. For current
behavior, see the [README](../README.md), [architecture](architecture.md),
[privacy boundary](privacy.md), [extraction limitations](extraction-limitations.md),
[design system](design-system.md), and [Image manifest](image-package-manifest-v1.md).
Those current references are not a version bump, Updates entry, deployment
instruction, or authorization to publish.

## Global constraints

- Browser-only React + TypeScript + Vite application; no backend, accounts, telemetry, persistence, service worker, model calls, or post-load external requests.
- Preserve the four-stage Decompose → Rewrite → Verify → Final pipeline and canonical root `prompts/` files.
- Support up to 20 files, 20 MiB each, and 100 MiB total: UTF-8 text/Markdown, DOCX, and text-layer PDF. No OCR.
- Session-memory only. Always include originals in the exported ZIP.
- Global writing settings with per-file overrides; curated model-family profiles plus custom profile.
- Oversized context is warned and acknowledged, not blocked.
- Desktop uses the approved three-column Night Terminal workbench; mobile uses Files, Preview, and Settings tabs.
- Palette: `#090b10`, `#11151d`, `#171c25`, `#303746`, `#d7dde8`, `#7f8a9d`, `#42e8b4`, `#f2b84b`, `#ff667a`. No gradients or glows.
- Test-driven implementation: each behavior test must fail for the intended missing behavior before production code is added.
- No Git commits, pushes, remote changes, deployment, OCR, chunking, or live model-provider calls.

## Task 1: Web scaffolding, governance, and design system

- Replace the Python scaffold with React, TypeScript, and Vite configuration.
- Add lint, typecheck, unit, E2E, and build scripts and required dependencies.
- Record the approved desktop/mobile concepts, exact design tokens, component inventory, allowed visible copy, responsive rules, typography, icons, and interaction states.
- Update ignore rules and remove obsolete bootstrap-only/Python files.
- Keep the canonical prompt and governance files in place.

## Task 2: Domain model, settings, profiles, sizing, and prompt rendering

- Define typed document state, settings, profiles, prompt-set, and manifest inputs.
- Implement global settings plus per-file override resolution.
- Implement curated family profiles and editable custom context.
- Implement conservative context estimation and acknowledgment state.
- Import root prompt Markdown as raw text and render the four self-contained prompt files with only the intended response placeholders.

## Task 3: File validation and extraction

- Validate count, per-file size, aggregate size, extensions, signatures, UTF-8 text, and safe errors.
- Preserve text/Markdown decoded content.
- Convert DOCX to reviewable GFM Markdown and retain conversion warnings.
- Extract PDFs page-by-page, handle corrupt/encrypted/textless documents safely, and never invoke OCR.
- Hash originals and extracted text, identify duplicates, and expose editable review state.

## Task 4: Manifest and ZIP export

- Implement collision-safe deterministic slugs and Web Crypto hashes.
- Build schema-version-1 manifest and model-tailored runbook.
- Always include originals, reviewed extraction, and all four prompts per document.
- Store original binaries without recompression and compress generated text.
- Preserve in-memory state on export failure.

## Task 5: React workbench and responsive Night Terminal UI

- Build the file queue, upload/drop zone, extracted-text editor, review controls, settings inspector, per-file override controls, warning/blocked states, context meter, and export action.
- Implement desktop three-pane, tablet collapse, and mobile tab layouts.
- Add keyboard navigation, focus management, live announcements, reduced motion, and unload warning.
- Keep `App` composition-focused and use a reducer plus focused hooks.

## Task 6: Integration, E2E, documentation, and final QA

- Add mixed-format fixtures and end-to-end ZIP inspection.
- Test refresh clearing, per-file recovery, no unexpected outbound requests, and desktop/mobile behavior.
- Update README, contribution guidance, architecture, privacy, extraction limitations, and manifest specification.
- Run lint, typecheck, unit tests, E2E tests, production build, browser QA, screenshot comparison, and repository wording audit.
