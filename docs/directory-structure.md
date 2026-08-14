# Directory structure

```text
reword-nerd/
├── README.md, CONTRIBUTING.md, LICENSE, CODE_OF_CONDUCT.md, SECURITY.md
├── package.json, package-lock.json
├── index.html, image/index.html, vite.config.ts, vitest.config.ts, playwright.config.ts
├── prompts/
│   ├── 00_one_shot.md              # canonical single-request workflow
│   ├── 01_decompose.md             # canonical Manual stages
│   ├── 02_rewrite.md
│   ├── 03_verify.md
│   └── 04_final.md
├── examples/                        # synthetic local examples
├── docs/
│   ├── architecture.md, privacy.md, extraction-limitations.md, release-workflow.md
│   ├── manifest-v1.md … manifest-v6.md, image-package-manifest-v1.md
│   ├── model-guidance/              # dated strategy evidence and parity
│   ├── design-principles.md, design-system.md, design-qa.md
│   └── design/references/           # approved visual references
├── public/
│   ├── brand/                       # metadata-free logo and browser icons
│   ├── image/orange-pyramid.webp    # Image identity and favicon artwork
│   └── media/
│       ├── demo/                    # local videos and static posters
│       └── updates/<release>/       # final synthetic release media and transcript
├── content/updates/                  # release ledger, review inventory, safe authored Markdown
├── scripts/updates/                  # offline ledger/render/video commands
├── video/remotion/                  # authoring-only deterministic demos and release clips
├── src/
│   ├── version.ts                   # package-metadata application version
│   ├── app/workbench/               # item state, safe previews, project review, hooks/UI
│   ├── domain/                      # file/project admission, safety, extraction, context
│   ├── export/                      # runbook/workbooks, schema v6, ZIP/download
│   ├── image/                       # isolated intake/OCR/profiles/reducer/workbench/schema 1
│   ├── prompting/                   # `PromptBundle` renderer
│   ├── styles/                      # Night Terminal and responsive rules
│   ├── types/                       # third-party declarations
│   └── main.tsx
└── tests/
    ├── image/                       # tests/image/ isolated domain, intake, UI, and export contracts
    ├── domain/, export/, portal/, prompting/, workbench/, privacy/, styles/
    └── e2e/                         # real fixtures, built-preview and file:// QA
```

The Image identity asset is tracked at `public/image/orange-pyramid.webp`, and
Image tests remain nested under `tests/image/`.

Source, deterministic fixtures, root prompts, authored demo compositions,
rendered site media, and manifest specifications are versioned. The public
logo/videos/posters are site assets only and are never added to a user ZIP.
Public authored Updates posts and release media are site material, distinct from
uploaded session content, prompt packages, and downloaded progress copies.
`content/updates/` and `public/media/updates/` contain reviewed release source;
they never contain selected files and never become package entries.
`dist/`, dependency folders, coverage, Playwright reports, and
`output/playwright/` screenshots/download fixtures are generated and ignored;
see [.gitignore](../.gitignore).

## Exported schema-v6 package

Standalone files preserve every v5 archive path:

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
    └── ocr/candidates.json
```

Folder and ZIP workspaces use the same workflow/asset/OCR siblings and replace
the standalone `original.<ext>` with reviewed project provenance:

```text
reword-nerd-prompt-package.zip
├── OPEN-ME.html
├── README.md
├── manifest.json
└── documents/<project-key>/
    ├── reviewed-extraction.md
    ├── project/
    │   ├── index.md
    │   ├── index.json
    │   └── files/<safe-relative-path>
    ├── one-shot/
    ├── manual-prompts/
    ├── combined-prompts/
    ├── assets/
    └── ocr/
```

The ZIP contains file entries only; it does not emit directory entries. See
[manifest v6](manifest-v6.md) for project provenance, hashing, compression,
deterministic ordering, and optional-artifact rules. Manifests v1–v5 remain
historical contracts.

## Exported Image schema-1 package

The physical `image/index.html` entry loads `src/image/main.tsx` without routing
through the Text root. Image packages use a separate filename, format, schema,
and pair tree:

```text
reword-nerd-image-prompt-package.zip
├── README.md
├── OPEN-ME.html
├── OPEN-ME-FULL.html                 # only when final HTML is at most 32 MiB
├── manifest.json
└── pairs/<pair-key>/
    ├── source.<ext>
    ├── prompt.txt
    ├── run-card.md
    ├── metadata.json
    └── OPEN-ME.html
```

There is one `pairs/<pair-key>/` directory for each confirmed included image in
queue order. Direct-image and recoverable DOCX-media bytes remain exact; PDF
visuals and page captures are locally rasterized to PNG. Original PDF, DOCX,
and ZIP containers are not entries. See [Image manifest v1](image-package-manifest-v1.md).
