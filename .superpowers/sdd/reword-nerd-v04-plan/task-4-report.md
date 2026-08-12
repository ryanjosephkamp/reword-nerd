# Task 4 report — In-site dual-mode package preview and integration

Date: 2026-08-12 (America/New_York)

Status: complete

## Outcome

The in-site Package preview now consumes Task 2's public immutable `DocumentWorkbook` array directly. A successful build enters Package preview with `one-shot` selected, while source/assets/package preview mode, package workflow, and package document selection remain separate reducer state.

The React preview renders workbook data as React nodes only. It does not mount, execute, parse into the DOM, or use `dangerouslySetInnerHTML` with any generated workbook HTML. All editable prompt and response transitions delegate to Task 2's public pure progress functions, and the standalone progress download uses Task 2's exact `renderWorkbookProgressHtml` output.

No ZIP archive generation, ordering, timestamp, compression, path, hashing, or manifest behavior changed. No GitHub state was changed.

## Files

Production:

- `src/app/workbench/components/PackagePreview.tsx` — controlled One-shot/Manual tabs; multi-document selector; exact prompt Copy; editable prompts and responses; prerequisite locks; hydration; stale edit warning; Reapply/Reset; One-shot/Stage 4 response capture; progress-copy rendering.
- `src/app/workbench/contracts.ts` — distinct package workflow/document state plus injectable progress-copy download service.
- `src/app/workbench/reducer.ts` — controlled package workflow/document actions, One-shot build default, and shared Blob/workbook invalidation state.
- `src/app/workbench/Workbench.tsx` — public `workbooks` integration and build-revision keyed preview lifecycle.
- `src/export/download.ts`, `src/app/workbench/services.ts` — isolated local HTML download adapter while retaining ZIP download behavior.
- `src/styles/workbench.css` — existing Preview-panel styling extended for tabs, prompt/response fields, sticky controls, stale state, and 320px-safe stacked mobile controls.

Tests:

- `tests/workbench/PackagePreview.test.tsx` — new component, accessibility, hydration, stale state, document isolation, exact renderer, copy feedback/focus, and keyboard-tab coverage.
- `tests/workbench/Workbench.test.tsx` — build default, workbook integration, response disposal on invalidation/rebuild, focus, multi-document/workflow separation, and explicit ZIP download regression.
- `tests/workbench/reducer.test.ts` — independent state dimensions, tutorial non-invalidation, shared Blob/workbook invalidation, and stale download completion rejection.
- `tests/workbench/useExportPackage.test.tsx` — obsolete workbook exposure regression alongside the existing operation/revision guards.
- `tests/export/download.test.ts` — isolated progress HTML adapter plus unchanged ZIP adapter behavior.
- Preference test fixtures were updated only for the public service/state shape; the persistence whitelist remains unchanged.

## State and data flow

1. `useExportPackage` retains the existing operation ID and revision snapshot guards and dispatches a successful `PromptPackageResult` only for the current build.
2. The reducer installs the same result object, selects Package preview, sets `previewWorkflow: "one-shot"`, and selects `builtPackage.workbooks[0]` through `previewDocumentKey`.
3. `Workbench` passes `builtPackage.workbooks` to `PackagePreview`; it no longer reads the deprecated `artifacts` result alias.
4. `PackagePreview` creates one Task 2 `WorkbookProgress` value per workbook. Document switching changes only `previewDocumentKey`; workflow switching changes only `previewWorkflow`; source document selection remains independent.
5. Prompt edits, responses, hydration, prerequisite Copy state, stale preservation, Reapply, and Reset use only:
   - `createWorkbookProgress`
   - `editWorkbookPrompt`
   - `updateWorkbookResponse`
   - `reapplyWorkbookPrompt`
   - `resetWorkbookPrompt`
6. Progress download calls `renderWorkbookProgressHtml(workbook, progress)` and passes the exact returned string plus `<documentKey>-progress.html` to `downloadProgressCopy`. The default adapter creates a local `text/html;charset=utf-8` Blob; it does not call the ZIP download service.
7. The preview is keyed by the built revision. Content-package invalidation unmounts it, clears the Blob/workbooks through the shared export state, returns preview mode to source, and discards response/edit state with the old build. A rebuilt package starts from fresh progress.

No prompt, response, document, workbook, or package state is written to localStorage or sessionStorage. Task 3's preference snapshot remains the only persistence path and whitelist.

## Accessibility and focus

- Package workflow uses a named `tablist`, two `tab` controls, controlled `tabpanel` visibility, roving `tabIndex`, and ArrowLeft/ArrowRight/Home/End behavior.
- Every prompt/response textarea has a visible programmatic label. Downstream stage Copy controls and the top current-manual Copy control expose real disabled states until prerequisites exist.
- Copy and progress-download feedback is visible and announced through an atomic polite status region. Successful Copy reports the exact workflow/stage; failed Copy gives an honest manual-selection instruction.
- Build completion retains the existing focus move to the Package preview heading.
- Mouse or keyboard workflow changes keep focus on the selected workflow tab. Document changes keep focus on the document selector.
- Copy returns focus to its initiating button. Progress-copy and ZIP downloads retain their initiating button focus.
- Package invalidation from a still-visible Settings control keeps focus on that control while returning the Preview panel to Source. Existing source/document removal focus behavior is unchanged.
- Responsive controls stack inside the existing Preview panel at mobile widths; no new navigation surface or broad redesign was introduced.

## Race and invalidation proof

- `changed(...)` continues to be the single content mutation boundary. It increments the revision, clears the complete export object (Blob and workbook array together), returns `previewMode` to `source`, and clears package workflow/document selection.
- Document content/review, asset inclusion, LaTeX main file, OCR review, profile/context, rewrite settings, extraction options, add/remove, and preference reset content mutations all pass through that boundary.
- Tutorial open/dismiss state and Help/drawer/preview navigation do not use that boundary. A reducer regression proves tutorial dismissal preserves the installed package, workflow, and package document.
- The existing duplicate-build activation, late-build completion, overlapping rebuild, and download retry tests remain green.
- The late-build regression now also asserts an obsolete workbook never becomes visible, while the current rebuild does.
- A stale download completion dispatched after revision invalidation is ignored, cannot restore the package, and cannot advance `lastExportedRevision` or mark the session clean.
- The ZIP download adapter retains explicit activation, temporary-anchor cleanup, delayed URL revocation, and failure cleanup. Progress HTML uses a separate adapter and filename.

## Strict TDD evidence

### Initial required RED

Command:

```sh
npm test -- --run tests/workbench/PackagePreview.test.tsx tests/workbench/Workbench.test.tsx tests/workbench/reducer.test.ts tests/workbench/useExportPackage.test.tsx
```

Observed before implementation:

```text
Test Files  3 failed | 1 passed (4)
Tests       9 failed | 51 passed (60)
```

The expected failures were the absent dual-mode tablist/editor/download UI, absent independent package workflow/document reducer fields, and legacy Workbench assertions still seeing the manual-only preview. Existing race tests remained green.

### Additional adapter RED

Command:

```sh
npm test -- --run tests/export/download.test.ts -t "downloads progress HTML"
```

Observed expected RED:

```text
Test Files  1 failed (1)
Tests       1 failed | 2 skipped (3)
TypeError: initiateWorkbookProgressDownload is not a function
```

### Self-review copy-feedback RED

Command:

```sh
npm test -- --run tests/workbench/PackagePreview.test.tsx -t "honest manual-copy"
```

Observed expected RED: the component claimed a prompt remained selected after focus returned to the Copy button. The feedback was corrected to instruct explicit manual selection while preserving the focus requirement.

### Focused GREEN

Command:

```sh
npm test -- --run tests/export/download.test.ts tests/workbench/PackagePreview.test.tsx tests/workbench/Workbench.test.tsx tests/workbench/reducer.test.ts tests/workbench/useExportPackage.test.tsx
```

Result:

```text
Test Files  5 passed (5)
Tests       64 passed (64)
```

## Full gates

Consolidated command:

```sh
npm run lint && npm run typecheck && npm test -- --run && npm run build && git diff --check
```

Results:

- ESLint: PASS.
- TypeScript project build/typecheck: PASS.
- Vitest: 26 files, 195 tests, all PASS.
- Vite production build: PASS.
- `git diff --check`: PASS.

Vite continues to report the existing advisory for chunks above 500 kB. Vitest workers continue to print the environment's existing `--localstorage-file` warning. Neither originates in Task 4 or fails a gate.

Per the task boundary, browser E2E fixtures and full browser/mobile QA were not expanded or run here; Task 5 owns that verification.

## Self-review

- Confirmed the app consumer no longer imports or reads `CombinedPromptArtifact`, `artifacts`, `previewArtifactKey`, or `preview/artifact-selected`.
- Confirmed no `dangerouslySetInnerHTML`, HTML execution, or generated-HTML DOM insertion exists in the in-site preview.
- Confirmed exact current editable prompt text is copied, including local edits and hydrated responses.
- Confirmed nonblank Stage 1/2/3 responses hydrate downstream canonical prompts through Task 2 only.
- Confirmed an edited downstream prompt remains unchanged and stale after upstream response changes until explicit Reapply or Reset.
- Confirmed Stage 4 is optional, editable/saveable, and round-trips alongside the One-shot response through the exact safe progress renderer.
- Confirmed per-document progress is isolated and retained while switching documents within one valid build.
- Confirmed invalidation/rebuild discards old response/edit state.
- Confirmed source/assets/package mode, One-shot/Manual workflow, source document, and package document are not conflated.
- Confirmed progress-copy download does not call ZIP download or alter `lastExportedRevision`/dirty state.
- Confirmed ZIP operation/revision behavior remains explicit and current-only.
- Confirmed tutorial state alone leaves content package state installed.
- Confirmed the preference persistence whitelist has no new package, prompt, response, document, or workbook fields.
- Confirmed 320px behavior uses the existing Preview/mobile tab structure with stacked, full-width controls and wrap-safe fields.

## Concerns and deferred items

- Task 5 still owns real-browser desktop/tablet/320–412px QA, standalone `file://` fallback QA, the complete mixed-format workflow, and broader documentation/release/deployment work.
- The existing Vite large-chunk advisory and test-runner localStorage warning remain nonblocking and unchanged.
- No push, PR, merge, deployment, or other GitHub mutation was performed.

## Review fix round 1/5 — progress lifecycle and asynchronous Copy identity

Date: 2026-08-12 (America/New_York)

### Resolution and state flow

- `Workbench` now retains the revision-keyed `PackagePreview` instance for the full lifetime of an installed `builtPackage`. Source and Assets navigation sets the package article's native `hidden` attribute, so it is absent from the accessibility tree and layout while its in-memory per-document progress remains mounted.
- Content invalidation still clears `builtPackage`, so the old preview unmounts and its prompt edits/responses are discarded. The next successful build creates a fresh preview keyed by its new built revision. The existing invalidation/rebuild test proves the One-shot response is empty after rebuilding; the new navigation test proves Manual response and local prompt edits survive Package → Source → Assets → Package.
- No reducer export state, persistence field, ZIP action, or archive path changed in this round. The build/revision lifecycle remains the sole lifetime boundary for workbook progress.

### Clipboard operation and focus guard

- Prompt Copy accepts an injectable async adapter for deterministic deferred-completion tests while production defaults to the existing `copyText` adapter.
- Each Copy records a monotonically increasing operation token plus the initiating workbook key, workflow, and stage. Completion is ignored when superseded, unmounted, hidden, or no longer equal to the current document/workflow/stage identity.
- Ignored completion does not update the live status region and does not call focus on the old button. Tests hold Copy unresolved, switch document, workflow, or active Manual stage, then resolve it and prove the new control retains focus with no stale announcement.
- The Minor per-document active-stage/status redesign is deferred: it is not required for the two Important findings, and the identity guard prevents delayed async status/focus from crossing documents. Existing completed status and active-stage selection otherwise retain the established package-wide behavior.

### Focused RED evidence

Command:

```sh
npm test -- --run tests/workbench/PackagePreview.test.tsx tests/workbench/Workbench.test.tsx
```

Observed before production changes:

```text
Test Files  2 failed (2)
Tests       3 failed | 39 passed (42)
```

The failures proved that Source/Assets navigation remounted empty progress and that delayed Copy completion stole focus after document/workflow switches.

Additional stage-identity RED command:

```sh
npm test -- --run tests/workbench/PackagePreview.test.tsx
```

Observed before the stage guard:

```text
Test Files  1 failed (1)
Tests       1 failed | 8 passed (9)
```

The delayed Decompose Copy incorrectly announced after focus moved to the Rewrite stage.

### Focused GREEN and full gates

Focused command:

```sh
npm test -- --run tests/workbench/PackagePreview.test.tsx tests/workbench/Workbench.test.tsx
```

Result:

```text
Test Files  2 passed (2)
Tests       43 passed (43)
```

Final consolidated command:

```sh
npm run lint && npm run typecheck && npm test -- --run && npm run build && git diff --check
```

Results:

- ESLint: PASS.
- TypeScript project typecheck: PASS.
- Vitest: 26 files, 199 tests, all PASS.
- Vite production build: PASS.
- `git diff --check`: PASS.

The existing Vitest `--localstorage-file` warnings and Vite chunk-size advisory remain nonblocking and unchanged.

## Review fix round 2/5 — asynchronous Copy round trips

Date: 2026-08-12 (America/New_York)

### Resolution

- A separate monotonically increasing view generation now advances on every document, workflow, active-stage, or hidden-state transition, including transitions that later return to the same identity.
- Every Copy operation captures both its own operation token and the current view generation. Completion requires both to remain current, so A → B → A cannot make a stale operation current again.
- Unmount advances both guards. New Copy still supersedes old Copy. The existing direct identity checks remain defense in depth.
- Deferred tests cover document one → two → one, One-shot → Manual → One-shot, Decompose → Rewrite → Decompose, and Package visible → hidden → visible. Each proves no stale status announcement and no focus theft.

### RED evidence

Command:

```sh
npm test -- --run tests/workbench/PackagePreview.test.tsx -t "round trip"
```

Observed before the generation guard:

```text
Test Files  1 failed (1)
Tests       4 failed | 9 skipped (13)
```

All four failures exposed a stale Copy announcement after returning to the initiating identity.

### GREEN and gates

Focused commands and results:

```sh
npm test -- --run tests/workbench/PackagePreview.test.tsx -t "round trip"
# 1 file passed; 4 passed, 9 skipped

npm test -- --run tests/workbench/PackagePreview.test.tsx tests/workbench/Workbench.test.tsx
# 2 files passed; 47 tests passed
```

Final command:

```sh
npm run lint && npm run typecheck && npm test -- --run && npm run build && git diff --check
```

Results:

- ESLint: PASS.
- TypeScript project typecheck: PASS.
- Vitest: 26 files, 203 tests, all PASS.
- Vite production build: PASS.
- `git diff --check`: PASS.

The unchanged Vitest localStorage warning and Vite chunk-size advisory remain nonblocking.
