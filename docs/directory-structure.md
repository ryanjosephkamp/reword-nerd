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
│   ├── manifest-v1.md … manifest-v5.md
│   ├── model-guidance/              # dated strategy evidence and parity
│   ├── design-principles.md, design-system.md, design-qa.md
│   └── design/references/           # approved visual references
├── public/
│   ├── brand/                       # metadata-free logo and browser icons
│   └── media/demo/                  # local videos and static posters
├── video/remotion/                  # authoring-only deterministic demos
├── src/
│   ├── version.ts                   # package-metadata application version
│   ├── app/workbench/               # state, overlays, help, hooks, services, UI
│   ├── domain/                      # admission, extraction, media, profiles, context
│   ├── export/                      # runbook/workbooks, schema v5, ZIP/download
│   ├── prompting/                   # `PromptBundle` renderer
│   ├── styles/                      # Night Terminal and responsive rules
│   ├── types/                       # third-party declarations
│   └── main.tsx
└── tests/
    ├── domain/, export/, prompting/, workbench/, privacy/, styles/
    └── e2e/                         # real fixtures, built-preview and file:// QA
```

Source, deterministic fixtures, root prompts, authored demo compositions,
rendered site media, and manifest specifications are versioned. The public
logo/videos/posters are site assets only and are never added to a user ZIP.
`dist/`, dependency folders, coverage, Playwright reports, and
`output/playwright/` screenshots/download fixtures are generated and ignored;
see [.gitignore](../.gitignore).

## Exported schema-v5 package

```text
reword-nerd-prompt-package.zip
├── OPEN-ME.html
├── README.md
├── manifest.json
└── documents/<document-key>/
    ├── original.<ext>
    ├── reviewed-extraction.md
    ├── one-shot/
    │   ├── 00-one-shot.md
    │   ├── one-shot-prompt.md
    │   └── one-shot-prompt.html
    ├── manual-prompts/
    │   ├── 01-decompose.md
    │   ├── 02-rewrite.md
    │   ├── 03-verify.md
    │   ├── 04-final.md
    │   ├── manual-prompts.md
    │   └── manual-prompts.html
    ├── combined-prompts/
    │   ├── combined-prompts.md
    │   ├── combined-prompts.html
    │   └── combined-prompts-full.html  # only within the media cap
    ├── assets/index.md, placement-map.json, and included bytes
    ├── ocr/candidates.json
    └── project/                     # safe LaTeX tree when applicable
```

The ZIP contains file entries only; it does not emit directory entries. See
[manifest v5](manifest-v5.md) for hashing, compression, deterministic ordering,
and optional-artifact rules. Manifests v1–v4 remain historical contracts.
