# Manifest schema v6

Manifest schema `6` remains the `reword-nerd` `0.7.0` package contract. It preserves
the v5 dual-mode workbook paths and adds an explicit `source.kind` discriminator
for standalone files and reviewed text projects.

## Stable package rules

- `package.format` remains `dual-mode-prompt-package`.
- Workbook progress remains schema `1`.
- The archive filename remains `reword-nerd-prompt-package.zip`.
- Entries are sorted by JavaScript code-unit order, use the fixed
  `1980-01-01T00:00:00.000Z` timestamp and mode `100644`, and contain no explicit
  directory entries.
- Original file bytes and packaged binary assets use `STORE`; generated text,
  prompts, indexes, and workbooks use `DEFLATE-9`.
- The four canonical Manual prompts, One-shot prompt, companion workbooks,
  response markers, CSP, and `file://` behavior remain unchanged.

## File source

A standalone source has `source.kind: "file"`. `source.original` records the
stable `original.<ext>` path, byte count, and SHA-256. The historical top-level
`original` record is retained for v5 consumers and contains the same values.

## Project source

A project has `source.kind: "project"` and records:

- folder or ZIP intake, the safe root display name, classification, and optional
  LaTeX root;
- original and reviewed tree hashes plus the accepted review revision;
- the exact protected code-rewrite selection used by the generated prompts;
- `project/index.md` and `project/index.json` paths/hashes;
- each retained non-sensitive entry's normalized path, original size/hash,
  reviewed hash/revision, content kind, language, inclusion decisions, safe
  exclusion reason, and packaged path/hash when present;
- aggregate sensitive-file counts only.

ZIP projects additionally record the immutable original container display name,
byte count, and SHA-256. The original ZIP is **not** copied into the package.
Container provenance is captured and hashed synchronously at intake; because the
unsanitized container bytes are deliberately not retained, export verifies the
frozen name/size/hash contract but cannot rehash the original container.
Folder projects have no container record. Empty directories, symlinks,
permissions, and mtimes are not represented.

```text
documents/<key>/
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

Only `packageIncluded` entries appear under `project/files/`. Text entries use
the exact accepted reviewed text; safe binary assets retain their exact bytes.
Bytes from entries that are not package-included are absent from
`project/files/`. Retained non-sensitive exclusions remain inspectable through
their metadata and may be named in the manifest, project indexes, prompt risk/
exclusion manifests, or runbook counts. Sensitive-blocked content is different:
its paths, names, bytes, and hashes never enter the manifest, indexes, prompts,
HTML, runbook, or archive; only aggregate safe-category counts remain.

## Changed-files workflow and safety

Project prompts request deterministic changed-text-file blocks and unchanged,
excluded, and risk manifests. The runbook explains that the sanitized tree is
AI context, not a source-control backup. Users must apply changes to a copy,
inspect every diff, and run the project's normal tests/build. `reword-nerd`
does not execute, compile, or test uploaded code.

Every project path, original byte hash, reviewed-text hash, original tree hash,
reviewed tree hash, context assessment, and prompt bundle is independently
revalidated from a deep immutable snapshot before archive generation. Any
mismatch rejects the build.

Export repeats the fail-closed sensitive-content scan over both original and
reviewed bytes. Intake rejects ZIP containers over 100 MiB before browser bytes
are read or parsed. Export also re-enforces canonical path order, at most 500 retained
entries, the source-kind per-entry cap (20 MiB folder, 25 MiB ZIP), at most 100
MiB across all projects in one build, at most 250 prompt text files, and at most
5 MiB of decoded prompt text. LaTeX roots must be normalized included `.tex` or
`.ltx` files; General text projects cannot have a root document.

Schemas [v1](manifest-v1.md), [v2](manifest-v2.md), [v3](manifest-v3.md),
[v4](manifest-v4.md), and [v5](manifest-v5.md) remain historical and unchanged.
