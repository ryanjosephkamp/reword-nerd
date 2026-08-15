# Contributing to reword-nerd

Thank you for helping improve this browser workbench for professional Text
rewriting and reference-image prompting workflows.

## Development setup

Use Node.js 20.19 or later (or 22.12 or later) and npm.

```sh
git clone https://github.com/ryanjosephkamp/reword-nerd.git
cd reword-nerd
npm install
```

Start the local application with `npm run dev`. Use `npm run build` followed by
`npm run preview` when checking the production bundle. The primary checks are:

```sh
npm run lint
npm run typecheck
npm test -- --run
npm run build
PLAYWRIGHT_USE_PREVIEW=1 npm run e2e
```

Run `npm run install:playwright` if Playwright does not yet have Chromium.

## Contributions that fit the project

- Improve the canonical One-shot or four Manual prompt templates.
- Improve safe standalone-text/project intake, ORIGINAL previews, review,
  package generation, and accessibility.
- Improve the isolated `/image/` intake, review, prompt-profile, schema-1
  package, offline HTML, or accessibility contracts without broadening Text.
- Improve the model-profile and writing-settings experience.
- Add focused tests, synthetic fixtures, examples, or documentation.
- Report reproducible defects or suggest a well-scoped enhancement.

The application remains a browser-only prompt-package workbench with separate
Text and Image domains.
Changes that add a hosted service, account system, persistence layer, model
execution, or unrelated interface should be discussed before implementation.

## Updates and release media

Public authored Updates posts and release media are site material, distinct from
uploaded session content, prompt packages, and downloaded progress copies. Keep
release prose and synthetic media under the reviewed `content/updates/` and
`public/media/updates/` source paths; never derive them from a user file or put
them in a package. Follow [the release workflow](docs/release-workflow.md) for
the local authoring, review, and video checks. Its local commands do not grant
authority to commit, push, open a pull request, publish, or deploy.

## Working agreement

- Use TypeScript and React patterns already present in `src/`.
- Keep the root `prompts/` files authoritative; load them rather than copying
  prompt bodies into components.
- Preserve the One-shot final-document/audit contract and the explicit Manual
  Decompose → Rewrite → Verify → Final sequence.
- Keep the source extraction visible, editable, and explicitly reviewable
  before export.
- Keep uploaded HTML/Markdown and code inert. Do not add `iframe`, `object`,
  `embed`, `srcdoc`, active links/resources, `dangerouslySetInnerHTML`, code
  execution, compilation, or project test execution.
- Preserve project path normalization, portability-collision checks,
  sensitive-entry fail-closed removal, bounded intake, immutable tree lineage,
  and explicit prompt/package inclusion. Sensitive test fixtures must contain
  synthetic markers only and must never include real credentials.
- Keep executable syntax protected. Project prompts return changed text files
  and risk manifests; the exported tree is AI context, not a source backup.
- Keep document processing in the current browser session. Do not add provider
  calls, telemetry, remote assets, or service workers. The validated adapter in
  `src/app/workbench/preferences.ts` owns the Text key, while
  `src/image/preferences.ts` owns the isolated Image key. Neither allowlist may
  add dedicated source-byte, filename/path, selection, OCR, prompt, response,
  preview, or package fields. Image requested-changes and must-preserve defaults
  are intentionally persisted bounded free-form text, so repository and public
  documentation must disclose that user-entered sensitive text in those
  defaults will be saved.
- Keep the Image portal on its public intake/export facades. Preserve magic and
  MIME validation, safe folder/ZIP paths, bounded local PDF/DOCX extraction,
  opt-in reviewed OCR, one image/one prompt pairing, exact source bytes,
  deterministic schema-1 ZIP metadata, and original-container exclusion.
- Preserve offline Image HTML fallbacks, cooperative cancellation, stale-build
  suppression, and bounded/revoked object URLs. Image profiles are prompt
  strategies only and must never become provider calls or credential fields.
- Maintain the Night Terminal tokens and responsive behavior recorded in
  [the design system](docs/design-system.md).
- Use clear, neutral, professional language in code, comments, prompts,
  examples, and documentation.

## Tests and fixtures

Write and run a failing focused test before fixing or adding behavior.
Unit and component tests live under `tests/`; browser coverage lives in
`tests/e2e/`. Keep test fixtures synthetic, minimal, deterministic, and free
of personal, confidential, secret-bearing, or copyrighted source material. A
fixture that
exercises DOCX or PDF extraction must use genuine format bytes, not a parser
mock alone. Folder/ZIP fixtures must also exercise normalized paths, exclusions,
tree hashes, and sanitized schema-v6 export without relying only on parser mocks.
Image fixtures must use genuine tiny PNG/JPEG/WebP/AVIF, PDF, DOCX, or ZIP bytes
as applicable and cover signature/MIME mismatch, path safety, limits, source-byte
parity, schema-1 hashes, offline `file://` behavior, and cleanup without using
private or copyrighted material.

Run the relevant focused tests while iterating, then run the checks listed
above against the built preview before proposing a change. Inspect generated
screenshots and downloaded archive/progress bytes rather than relying on test
status alone. Update documentation whenever an accepted
format, project rule, limit, archive field, setting, privacy boundary, or
visible workflow changes.

## Prompt changes

When changing a root prompt template:

- preserve both workflow modes, the four-stage flow, and response-marker handoff;
- preserve explicit source and prior-stage artifact boundaries;
- keep instructions suitable for academic, technical, and professional writing;
- update prompt-rendering tests and any affected package documentation.

## Community standards

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

For suspected vulnerabilities, do not open a public Issue. Follow the private, synthetic-evidence-only process in the [Security policy](SECURITY.md).
