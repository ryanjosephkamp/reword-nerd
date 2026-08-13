# reword-nerd v0.6 implementation plan

## Context

Implement the user-approved Source Viewer and Text Project Workspaces release on
`codex/v06-source-viewer-and-project-workspaces`. The deployed v0.5.1 Night
Terminal workbench, current mobile navigation, four canonical prompt stages,
local-only processing boundary, and deterministic package behavior are the
starting point.

## Global Constraints

- Release application/package version `0.6.0` and manifest schema version `6`.
- Keep package format `dual-mode-prompt-package` and progress payload schema `1`.
- Keep Decompose -> Rewrite -> Verify -> Final, canonical response markers, and
  existing individual/One-shot/Manual/combined artifacts.
- Browser-only: no backend, provider API, credentials, telemetry, document
  upload, account, code execution, compilation, or project test execution.
- Only validated preferences/tutorial state may persist under the existing
  `reword-nerd:preferences:v1` key. Uploaded content, project decisions,
  previews, prompt edits, responses, and packages remain memory-only.
- Uploaded HTML/Markdown/PDF/DOCX/project content must not execute, navigate,
  initiate network requests, or be injected through `dangerouslySetInnerHTML`,
  `iframe`, `object`, `embed`, or `srcdoc`.
- Preserve the current mobile Files/Review/Settings flow and v0.5.1 responsive
  geometry. The approved new desktop action pattern is Preview Footer Dock.
- Use test-driven development: each production behavior must be preceded by a
  focused failing test whose failure is observed and recorded.
- Preserve stale-operation/revision guards for intake, extraction, hashing,
  preview loading, building, copying, downloading, removal, and New Session.
- Never silently truncate prompt source. Over-limit projects stay inspectable
  but BUILD remains blocked until scope is reduced.
- Future Remotion re-recording, marketing video/music, blog/changelog, issue
  links, and launch article are out of scope for this release.

Implementation clarification: project intake never retains an illegal
over-limit prompt selection. It atomically marks entries beyond the 250-file or
5 MiB prompt cap with the visible `prompt-limit` reason, reports the reduced
scope in Project Review, and leaves the project review-required. BUILD remains
blocked until the user inspects and explicitly confirms that reduced scope;
excluded entries remain inspectable but cannot be restored beyond the cap.

## Task 1: Safe text and project domain

Create the source taxonomy, safe standalone-text admission, project tree
reader, settings, context assessment, and prompt-source contracts.

### Source taxonomy and standalone intake

- Generalize to a required discriminant:
  `WorkspaceItem = WorkspaceDocument | WorkspaceProject`. Both variants have
  required `kind`, ID/name/status/review/settings/context fields; the project
  variant additionally owns intake/root/tree/entries, selected entry, project
  operation generation, and project review revision. Rename workbench
  collections, selection, services, selectors, and actions from document-only
  terminology to item terminology, retaining compatibility aliases only at
  public boundaries that still consume one document.
- Extend source formats for HTML/XML, JSON/JSONL/NDJSON, CSV/TSV,
  YAML/TOML/INI/config, CSS/SQL, common programming/script languages, and a
  generic text fallback.
- Known extensions receive `languageId` and `previewKind`; an extensionless or
  unknown file is admitted as generic text when complete bounded bytes pass
  fatal UTF-8 decoding, BOM handling, NUL/control rejection, and nonblank
  checks. MIME is advisory only. Preserve exact original bytes/line endings.
- Continue rejecting unsupported binaries with a recoverable explanation.

### Project intake and safety

- Add folder and general ZIP project input models. One folder/ZIP is one
  workspace row with one review and workbook set.
- Folder entries use `webkitRelativePath`; ZIP uses a format-neutral extraction
  of the existing LaTeX archive protections. Folder drag-and-drop is out of
  scope; ADD FOLDER and ZIP are supported.
- Normalize project paths to NFC. Reject absolute/drive/backslash paths, `.` and
  `..` segments (ordinary dotfiles remain inspectable), empty/control-bearing
  segments, symlinks, encryption, normalized duplicates, and nested archives.
  Derive a portability key and reject Unicode/case-fold collisions, Windows
  device names, alternate-data-stream colons, trailing dot/space segments,
  segments over 255 UTF-8 bytes, and paths over 1,024 UTF-8 bytes. Revalidate
  every final joined archive path before emission.
- Limits: 500 entries; 20 MiB per folder file; 100 MiB per ZIP container checked before browser byte allocation; 25 MiB per archive entry;
  100 MiB project/session uncompressed; 100:1 archive ratio; 250 prompt-included
  text files; 5 MiB decoded prompt text.
- Derive immutable `originalTreeHash` from sorted safe path, original byte count,
  and original SHA-256 after sensitive entries have been dropped. Each text
  entry separately retains immutable original bytes/hash plus reviewed text,
  reviewed-text hash, and review revision. Inclusion/edit changes increment the
  project revision and invalidate review/package state. Prompt boundaries,
  context, manifests, and packages derive from one exact reviewed snapshot and
  its `reviewedTreeHash`, with operation/revision checks before acceptance.
- Classify ZIP as LaTeX when a clear root document exists; otherwise General
  text project. Expose an explicit classification choice for ambiguous ZIPs.
- Classify sensitivity before `.gitignore` or default-exclusion rules. A
  fail-closed `sensitive-blocked` file is dropped at intake before hashing,
  treeHash, indexing, prompt/package inclusion, or retention; it is never
  restorable and never exposes its original path/name/bytes/hash. Retain only
  aggregate safe-category counts and a warning. Honor root `.gitignore` for
  remaining entries. Classify VCS/dependency/vendor/cache/build/generated/
  minified/source-map/lock content as `safe-excluded`; retain its non-sensitive
  metadata and permit deliberate restoration. Preserve safe non-text assets as
  package-only when enabled.
- Non-sensitive project entries expose immutable path/original bytes/original
  hash, reviewed text/reviewed hash/revision, content kind, language,
  prompt/package inclusion, and safe exclusion reason. Sensitive-blocked files
  exist only as aggregate counts outside the entry list.
- Project review confirms only when every included text entry is valid.

### Settings, context, and prompts

- Add validated global `CodeRewriteOptions`: documentation/markup on;
  comments/docstrings on; user-facing strings on; narrative structured-data
  values off; honor root `.gitignore` on; exclude dependencies/build/generated
  on; preserve safe non-text assets on. Protected executable syntax is always
  on and not user-disableable.
- Add exact Settings help content for each new control.
- Generalize `PromptDocumentContext` to `PromptSourceContext`; add code/project
  fidelity instructions exactly once without changing canonical stage semantics
  or response markers.
- Prompts preserve syntax, control flow, identifiers, imports/signatures, paths,
  keys/types/numbers, placeholders/escapes, citations/licenses, markup
  structure, table shape/formulas, and excluded files. Return changed text
  files only in deterministic path-delimited blocks plus unchanged/excluded and
  risk manifests. Tool-enabled models may edit only a copied project and must
  report the same manifest. Never claim build/tests were run.
- Use a source-boundary token derived from the exact reviewed snapshot hash and
  extend it until it cannot collide with included content. Include each path,
  immutable original SHA-256, and current reviewed SHA-256.
- Estimate code/markup/structured text at 3 code points/token plus per-file
  framing. Show amber risk at 25 included files or One-shot ratio >=50%.
  Retain current context acknowledgement rules and add the persistent warning
  to inspect diffs and run normal tests/build afterward.

### Tests and completion

- Add focused RED/GREEN tests for classification, UTF-8/BOM/control/binary
  cases, safe folder/ZIP paths and limits, ignore/exclusion behavior, tree
  determinism, settings persistence, context risk, prompt fidelity/parity, and
  stale project operations.
- Run focused tests, lint, typecheck, full unit suite, and build. Commit this task
  independently and write its SDD report.

## Task 2: Safe ORIGINAL viewer and project review UI

Implement read-only ORIGINAL rendering and the interactive project review
surface using Task 1 contracts.

- Keep global `SOURCE | ASSETS | PACKAGE`. Add a nested accessible SOURCE
  tablist ordered `EXTRACTED TEXT | ORIGINAL`, with EXTRACTED TEXT selected by
  default. Opening ORIGINAL never changes revision, review, or package state.
- PDF: reuse in-memory PDF.js canvas rendering with eval/actions/forms/
  attachments/JavaScript layers absent; page navigation, fit-width/zoom, active
  and adjacent pages only, accessible page text, bounded canvas pixels, and
  complete render/document disposal.
- Markdown: dynamically loaded AST-to-React rich/raw views with raw HTML and
  active external resources disabled.
- HTML: parse through a bundled pure AST parser and explicit semantic allowlist;
  rich/raw views; scripts/styles/forms/frames/objects/event handlers/remote
  resources and active links disabled. URLs render as inert text with Copy.
- DOCX: safe semantic approximation from locally extracted content/assets,
  explicitly labeled as approximate; never inject Mammoth HTML.
- CSV/TSV: bounded table/raw view with sticky header and text-only cells.
- JSON/JSONL: bounded lazy tree/raw view safe for extreme depth and prototype
  keys.
- Code/config/text/LaTeX: exact read-only code view with line numbers, wrapping,
  and horizontal scrolling; no syntax-highlighter dependency required.
- Project: searchable/filterable file tree, entry status, selected-file raw
  review editor, include/exclude controls, immutable paths, project-level
  confirm, and safe raster/static asset inspection. Mobile uses a compact file
  selector/drawer inside SOURCE, not a new global tab.
- Preview sessions stay outside the reducer and bind completions to item ID,
  original/tree hash, and operation generation. Abort/dispose after switching,
  removal, New Session, or unmount. Lazily create and reference-count object
  URLs; revoke after the final subscriber.
- Add bundled local dependencies only when required (`react-markdown`,
  `remark-gfm`, `parse5`, and a bounded CSV parser are acceptable). No runtime
  CDN or network dependency.
- Test hostile HTML/Markdown, PDF actions, DOCX external relationships, CSV
  formula-like strings, extreme JSON, preview races/disposal, project review,
  keyboard tabs/focus, 320/360/390/412 containment, and zero unexpected
  requests. Run focused and full gates, commit, and report.

## Task 3: Preview Footer Dock and settings-first desktop flow

Implement the user-selected desktop action layout while preserving mobile.

- Add a compact Preview Footer Dock below the desktop center panel when at
  least one workspace item exists. It contains side-by-side BUILD PACKAGE and
  DOWNLOAD ZIP plus concise local-processing/status/blocker guidance.
- Reuse the exact `useExportPackage` state, accepted Blob, revision/operation
  tokens, retry behavior, and mutation invalidation used by Settings. Do not
  create another build/download path.
- Settings keeps the existing stacked mirror controls. Only the central dock
  owns the live status region; the mirror does not double-announce.
- Build success opens PACKAGE -> RUNBOOK; Download uses the accepted immutable
  Blob. Blocked dock copy must identify the next action.
- Desktop Settings is expanded on every initialization/hard refresh. First-run
  tutorial dismissal reveals it. New Session re-expands Settings, clears the
  session through existing guards, and focuses the Parameters heading. Desktop
  collapse stays session-only. Tablet drawer and mobile Settings behavior are
  unchanged.
- Preserve the approved Night Terminal tokens, typography, icon family,
  container model, and mobile geometry. The footer dock must never cover the
  editor or cause horizontal overflow.
- Add RED/GREEN reducer/component/race tests and built-browser geometry at
  desktop plus mobile regressions. Run focused and full gates, commit, and
  report.

## Task 4: Manifest schema 6 and deterministic project packages

Migrate the archive and runbook/workbook provenance after Tasks 1-3 stabilize.

- Bump application/package version to `0.6.0` and manifest literal to `6`.
  Preserve `dual-mode-prompt-package`, progress schema `1`, fixed timestamp and
  permissions, lexicographic entries, compression rules, no directory entries,
  and stable ZIP filename.
- Keep all v5 single-document paths stable. Add project paths:

  ```text
  documents/<document-key>/
  |-- reviewed-extraction.md
  |-- project/
  |   |-- index.md
  |   |-- index.json
  |   `-- files/<safe-relative-path>
  |-- one-shot/
  |-- manual-prompts/
  |-- combined-prompts/
  |-- assets/
  `-- ocr/
  ```

- Schema 6 adds discriminated `file` and `project` sources. Project provenance
  records intake kind, root name, original/reviewed tree hashes and revision,
  original container name/size/hash without copying a generic original ZIP,
  index paths/hashes, and every retained non-sensitive entry's path, original
  bytes/hash, reviewed hash/revision, kind, language, inclusion, and safe
  exclusion reason. Sensitive-blocked files contribute only aggregate counts;
  their paths and hashes never enter the manifest.
- Folder intake has no fictitious original archive. The sanitized project tree
  is authoritative; permissions, symlinks, empty directories, and mtimes are
  not represented. Excluded/sensitive bytes must be absent from all ZIP entries,
  prompts, workbooks, and generated HTML.
- Runbooks/workbooks explain the changed-files workflow, risk boundary, project
  asset attachment, and that the package is AI context rather than a source
  control backup. Preserve prompt byte parity and standalone HTML CSP/file://
  behavior.
- Add exact schema/tree/hash/determinism/compression/multi-project/LaTeX/
  hostile-path/full-HTML-boundary tests. Preserve manifest v1-v5 docs and add
  `docs/manifest-v6.md`. Run gates, commit, and report.

## Task 5: Integrated QA, documentation, review, and release

- Update README, Help/Quick Start copy, architecture, privacy, design system,
  directory structure, extraction limitations, manifest index, and contributor
  guidance for safe UTF-8 text/code/project support, original previews,
  Preview Footer Dock, risks, and limits.
- Keep existing Remotion media/tutorial version unchanged; documentation may
  state the clips predate project-workspace support.
- Add full browser flows for standalone text/code, unknown UTF-8, Add Folder,
  generic ZIP, project review, ORIGINAL previews, build/runbook/download, New
  Session, and context-risk recovery. Test true `/reword-nerd/` base path and
  zero external requests.
- Capture and inspect desktop/tablet and 320/360/390/412 screenshots. Compare
  against the approved Night Terminal references and Preview Footer Dock
  selection. Record a fidelity ledger with at least five concrete comparisons.
- Run lint, typecheck, all unit tests, production build, built-preview Chromium
  suite, ZIP/hash inspection, privacy scan, and `git diff --check`.
- Perform independent whole-branch Critical/Important review and fix/re-review
  once as required by SDD.
- Scan candidate files for secrets, local paths, internal SDD reports, source
  attachments, and unexpected binaries. Commit only intended product/docs/tests.
- Push the branch, create a ready PR, wait for CI, merge into `main`, monitor the
  existing Pages workflow, and verify a cache-busted live site and assets at
  `https://ryanjosephkamp.github.io/reword-nerd/`.
