# Directory structure

```text
reword-nerd/
├── README.md, CONTRIBUTING.md, LICENSE, CODE_OF_CONDUCT.md
├── package.json, package-lock.json
├── index.html, vite.config.ts, vitest.config.ts, playwright.config.ts
├── prompts/
│   ├── 00_one_shot.md              # canonical single-request workflow
│   ├── 01_decompose.md             # canonical Manual stages
│   ├── 02_rewrite.md
│   ├── 03_verify.md
│   └── 04_final.md
├── examples/                        # synthetic local examples
├── docs/
│   ├── architecture.md, privacy.md, extraction-limitations.md
│   ├── manifest-v1.md … manifest-v4.md
│   ├── model-guidance/              # dated strategy evidence and parity
│   ├── design-principles.md, design-system.md, design-qa.md
│   └── design/references/           # approved visual references
├── src/
│   ├── app/workbench/               # state, preferences, hooks, services, UI
│   ├── domain/                      # admission, extraction, media, profiles, context
│   ├── export/                      # workbooks/progress, schema v4, ZIP/download
│   ├── prompting/                   # `PromptBundle` renderer
│   ├── styles/                      # Night Terminal and responsive rules
│   ├── types/                       # third-party declarations
│   └── main.tsx
└── tests/
    ├── domain/, export/, prompting/, workbench/, privacy/, styles/
    └── e2e/                         # real fixtures, built-preview and file:// QA
```

Source, deterministic fixtures, root prompts, and manifest specifications are
versioned. `dist/`, dependency folders, coverage, Playwright reports, and
`output/playwright/` screenshots/download fixtures are generated and ignored;
see [.gitignore](../.gitignore).

## Exported schema-v4 package

```text
reword-nerd-prompt-package.zip
├── OPEN-ME.html
├── README.md
├── manifest.json
└── documents/<document-key>/
    ├── original.<ext>
    ├── reviewed-extraction.md
    ├── prompts/00-one-shot.md … 04-final.md
    ├── one-shot-prompt.md / .html
    ├── manual-prompts.md / .html
    ├── combined-prompts.md / .html [/ -full.html]
    ├── assets/index.md, placement-map.json, and included bytes
    ├── ocr/candidates.json
    └── project/                     # safe LaTeX tree when applicable
```

The ZIP contains file entries only; it does not emit directory entries.
