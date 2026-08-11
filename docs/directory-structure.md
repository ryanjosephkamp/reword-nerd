# Directory structure

```text
reword-nerd/
├── LICENSE
├── README.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── .gitignore
├── package.json                    # npm scripts and browser dependencies
├── package-lock.json               # locked dependency graph
├── index.html                      # Vite document entry point
├── prompts/                        # canonical four-stage templates
│   ├── 01_decompose.md
│   ├── 02_rewrite.md
│   ├── 03_verify.md
│   └── 04_final.md
├── examples/                       # synthetic sample source material
├── docs/
│   ├── architecture.md
│   ├── privacy.md
│   ├── extraction-limitations.md
│   ├── manifest-v1.md
│   ├── manifest-v2.md
│   ├── model-guidance/             # dated provider research + runtime parity
│   ├── design-principles.md
│   ├── design-system.md
│   └── design/references/          # approved visual references
├── src/
│   ├── app/
│   │   ├── App.tsx                 # composition root
│   │   └── workbench/              # state, hooks, services, components
│   ├── domain/                     # admission, extraction, settings, profiles
│   ├── export/                     # combined artifacts, manifest, ZIP, download
│   ├── prompting/                  # template renderer
│   ├── styles/                     # terminal tokens and responsive workbench CSS
│   ├── types/                      # third-party type declarations
│   └── main.tsx                    # React entry point
├── tests/
│   ├── domain/                     # domain unit tests
│   ├── export/                     # archive and download tests
│   ├── prompting/                  # prompt-loading and rendering tests
│   ├── workbench/                  # reducer and component tests
│   └── e2e/                        # Playwright browser flows and fixtures
├── playwright.config.ts
├── vite.config.ts
├── vitest.config.ts
└── tsconfig*.json
```

Source code, test fixtures, and root prompts are versioned. Build output,
Playwright reports, coverage, dependency directories, environment files, and
project-local automation notes are ignored; see [.gitignore](../.gitignore).
