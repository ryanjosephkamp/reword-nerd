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
