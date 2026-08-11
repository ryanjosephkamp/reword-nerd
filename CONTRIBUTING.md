# Contributing to reword-nerd

Thank you for helping improve this browser workbench for professional document
rewriting workflows.

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
npm run e2e
```

Run `npm run install:playwright` if Playwright does not yet have Chromium.

## Contributions that fit the project

- Improve the four canonical prompt templates.
- Improve extraction, review, package generation, and accessibility.
- Improve the model-profile and writing-settings experience.
- Add focused tests, synthetic fixtures, examples, or documentation.
- Report reproducible defects or suggest a well-scoped enhancement.

The first release remains a browser-only, manual prompt-package workbench.
Changes that add a hosted service, account system, persistence layer, model
execution, or unrelated interface should be discussed before implementation.

## Working agreement

- Use TypeScript and React patterns already present in `src/`.
- Keep the root `prompts/` files authoritative; load them rather than copying
  prompt bodies into components.
- Preserve the explicit Decompose → Rewrite → Verify → Final sequence.
- Keep the source extraction visible, editable, and explicitly reviewable
  before export.
- Keep processing in the current browser session. Do not add provider calls,
  telemetry, remote assets, service workers, or browser-storage writes.
- Maintain the Night Terminal tokens and responsive behavior recorded in
  [the design system](docs/design-system.md).
- Use clear, neutral, professional language in code, comments, prompts,
  examples, and documentation.

## Tests and fixtures

Write a failing focused test before fixing or adding behavior when practical.
Unit and component tests live under `tests/`; browser coverage lives in
`tests/e2e/`. Keep test fixtures synthetic, minimal, deterministic, and free
of personal, confidential, or copyrighted source material. A fixture that
exercises DOCX or PDF extraction must use genuine format bytes, not a parser
mock alone.

Run the relevant focused tests while iterating, then run the checks listed
above before proposing a change. Update documentation whenever an accepted
format, limit, archive field, setting, privacy boundary, or visible workflow
changes.

## Prompt changes

When changing a root prompt template:

- preserve the four-stage flow and the response-marker handoff;
- preserve explicit source and prior-stage artifact boundaries;
- keep instructions suitable for academic, technical, and professional writing;
- update prompt-rendering tests and any affected package documentation.

## Community standards

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
