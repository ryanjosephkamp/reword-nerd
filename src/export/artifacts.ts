import type { PromptBundle, VisualAsset } from "../domain";
import { MAX_FULL_HTML_BYTES } from "../domain";
import type {
  CombinedPromptBlock,
  DocumentWorkbook,
  RunbookDocument,
  PromptPackageManifest,
  WorkbookProgress,
  WorkbookPromptState,
  WorkbookResponseStage,
} from "./contracts";
import { PROJECT_ONE_SHOT_RESPONSE_LABEL } from "./contracts";
import { renderRunbookHtml, serializeRunbookMarkdown } from "./runbook";
import { isSafeArchivePath } from "./paths";

const textEncoder = new TextEncoder();

const manualStages = ["decompose", "rewrite", "verify", "final"] as const;
type ManualStage = typeof manualStages[number];

const stageTitles: Record<ManualStage, string> = {
  decompose: "Stage 1 — Decompose",
  rewrite: "Stage 2 — Rewrite",
  verify: "Stage 3 — Verify",
  final: "Stage 4 — Final",
};

const prerequisites: Record<ManualStage, readonly ManualStage[]> = {
  decompose: [],
  rewrite: ["decompose"],
  verify: ["decompose", "rewrite"],
  final: ["decompose", "rewrite", "verify"],
};

export interface ArtifactVisualAsset {
  asset: VisualAsset;
  path: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function fenceFor(value: string): string {
  let longest = 0;
  for (const match of value.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return "`".repeat(Math.max(4, longest + 1));
}

function promptSection(title: string, prompt: string): string {
  const fence = fenceFor(prompt);
  return `## ${title}\n\n${fence}text\n${prompt}${prompt.endsWith("\n") ? "" : "\n"}${fence}`;
}

export function relativeArchivePath(fromFile: string, toFile: string): string {
  if (!isSafeArchivePath(fromFile) || !isSafeArchivePath(toFile)) {
    throw new Error("Workbook paths must be archive-relative and canonical.");
  }
  const from = fromFile.split("/").slice(0, -1);
  const to = toFile.split("/");
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) common += 1;
  return `${"../".repeat(from.length - common)}${to.slice(common).join("/")}`;
}

function archiveRootPrefix(fromFile: string): string {
  if (!isSafeArchivePath(fromFile)) throw new Error("Workbook path must be archive-relative and canonical.");
  return "../".repeat(fromFile.split("/").length - 1);
}

export function escapeMarkdownText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replace(/([`*_[\]<>#])/gu, "\\$1")
    .replaceAll("://", "\\://")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

function assetMarkdown(assets: readonly ArtifactVisualAsset[], workbookPath: string): string {
  const assetLines = assets.filter(({ asset }) => asset.included).map(({ asset, path }) => [
    `- **${escapeMarkdownText(asset.id)}** — [${escapeMarkdownText(asset.filename)}](${relativeArchivePath(workbookPath, path)})`,
    asset.sourcePath ? `source: ${escapeMarkdownText(asset.sourcePath)}` : undefined,
    asset.pageNumber ? `page: ${asset.pageNumber}` : undefined,
    asset.caption ? `caption: ${escapeMarkdownText(asset.caption)}` : undefined,
    asset.altText ? `alt: ${escapeMarkdownText(asset.altText)}` : "description: missing",
  ].filter(Boolean).join("; "));
  return `## Visual assets\n\n${assetLines.length > 0 ? assetLines.join("\n") : "No separately extracted visual assets are included. For project sources, see Project assets in the Package README."}`;
}

function workflowMarkdown(
  runbookMarkdown: string,
  displayName: string,
  promptBundle: PromptBundle,
  assets: readonly ArtifactVisualAsset[],
  workflow: "one-shot" | "manual" | "combined",
  workbookPath: string,
): string {
  const sections: string[] = [];
  if (workflow !== "manual") sections.push(promptSection("One-shot", promptBundle.oneShot));
  if (workflow !== "one-shot") {
    for (const stage of manualStages) sections.push(promptSection(stageTitles[stage], promptBundle.manual[stage]));
  }
  const title = workflow === "one-shot" ? "One-shot prompt" : workflow === "manual" ? "Manual prompts" : "Combined prompts";
  return `${runbookMarkdown}\n---\n\n# ${title} — ${escapeMarkdownText(displayName)}\n\n${assetMarkdown(assets, workbookPath)}\n\n${sections.join("\n\n")}\n`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + size));
  }
  return btoa(binary);
}

function supportsInlinePreview(asset: VisualAsset): boolean {
  return asset.mimeType === "image/png"
    || asset.mimeType === "image/jpeg"
    || asset.mimeType === "image/gif"
    || asset.mimeType === "image/webp";
}

function assetHtml(assets: readonly ArtifactVisualAsset[], mode: "lightweight" | "full", workbookPath: string): string {
  const included = assets.filter(({ asset }) => asset.included);
  if (included.length === 0) return "<p>No separately extracted visual assets are included. For project sources, see Project assets in the Package README.</p>";
  return `<div class="asset-grid">${included.map(({ asset, path }) => {
    const source = mode === "full" && supportsInlinePreview(asset)
      ? `data:${asset.mimeType};base64,${bytesToBase64(asset.bytes)}`
      : "";
    const description = asset.altText || asset.caption || `${asset.kind} ${asset.id}`;
    const preview = source
      ? `<img src="${source}" alt="${escapeHtml(description)}">`
      : mode === "lightweight"
        ? `<p><a href="${escapeHtml(relativeArchivePath(workbookPath, path))}">Open packaged asset</a></p>`
        : "<p>This preserved format is not rendered in this standalone document.</p>";
    return `<article class="asset-card"><h3>${escapeHtml(asset.id)}</h3>${preview}<dl><dt>File</dt><dd>${escapeHtml(asset.filename)}</dd><dt>Source</dt><dd>${escapeHtml(asset.sourcePath ?? (asset.pageNumber ? `Page ${asset.pageNumber}` : "Document"))}</dd><dt>Caption</dt><dd>${escapeHtml(asset.caption ?? "Not supplied")}</dd><dt>Alt text</dt><dd>${escapeHtml(asset.altText ?? "Not supplied")}</dd></dl></article>`;
  }).join("")}</div>`;
}

function hydratePrompt(prompt: string, responses: Readonly<Record<WorkbookResponseStage, string>>): string {
  return prompt
    .replaceAll("<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>", responses.decompose.trim() ? responses.decompose : "<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>")
    .replaceAll("<<<INSERT_STAGE_2_REWRITE_RESPONSE>>>", responses.rewrite.trim() ? responses.rewrite : "<<<INSERT_STAGE_2_REWRITE_RESPONSE>>>")
    .replaceAll("<<<INSERT_STAGE_3_VERIFICATION_RESPONSE>>>", responses.verify.trim() ? responses.verify : "<<<INSERT_STAGE_3_VERIFICATION_RESPONSE>>>");
}

function copyEnabled(stage: ManualStage, responses: Readonly<Record<WorkbookResponseStage, string>>): boolean {
  return prerequisites[stage].every((prerequisite) => responses[prerequisite].trim().length > 0);
}

function freezePromptState(value: WorkbookPromptState): Readonly<WorkbookPromptState> {
  return Object.freeze({ ...value });
}

function freezeProgress(value: WorkbookProgress): Readonly<WorkbookProgress> {
  return Object.freeze({
    schemaVersion: 1 as const,
    documentKey: value.documentKey,
    responses: Object.freeze({ ...value.responses }),
    oneShotPrompt: freezePromptState(value.oneShotPrompt),
    manual: Object.freeze({
      prompts: Object.freeze(Object.fromEntries(manualStages.map((stage) => [
        stage,
        freezePromptState(value.manual.prompts[stage]),
      ])) as unknown as Record<ManualStage, Readonly<WorkbookPromptState>>),
    }),
  });
}

export function createWorkbookProgress(workbook: DocumentWorkbook): Readonly<WorkbookProgress> {
  const responses: Record<WorkbookResponseStage, string> = {
    oneShot: "",
    decompose: "",
    rewrite: "",
    verify: "",
    final: "",
  };
  const prompts = Object.fromEntries(manualStages.map((stage) => {
    const canonicalText = hydratePrompt(workbook.promptBundle.manual[stage], responses);
    return [stage, {
      text: canonicalText,
      canonicalText,
      copyEnabled: copyEnabled(stage, responses),
      edited: false,
      stale: false,
    }];
  })) as unknown as Record<ManualStage, WorkbookPromptState>;
  return freezeProgress({
    schemaVersion: 1,
    documentKey: workbook.documentKey,
    responses,
    oneShotPrompt: {
      text: workbook.promptBundle.oneShot,
      canonicalText: workbook.promptBundle.oneShot,
      copyEnabled: true,
      edited: false,
      stale: false,
    },
    manual: { prompts },
  });
}

function requireMatchingWorkbook(workbook: DocumentWorkbook, progress: Readonly<WorkbookProgress>): void {
  if (progress.documentKey !== workbook.documentKey) throw new Error("Workbook progress belongs to a different document.");
}

export function updateWorkbookResponse(
  workbook: DocumentWorkbook,
  progress: Readonly<WorkbookProgress>,
  stage: WorkbookResponseStage,
  response: string,
): Readonly<WorkbookProgress> {
  requireMatchingWorkbook(workbook, progress);
  const responses = { ...progress.responses, [stage]: response };
  const prompts = Object.fromEntries(manualStages.map((manualStage) => {
    const previous = progress.manual.prompts[manualStage];
    const canonicalText = hydratePrompt(workbook.promptBundle.manual[manualStage], responses);
    const canonicalChanged = canonicalText !== previous.canonicalText;
    return [manualStage, {
      text: previous.edited ? previous.text : canonicalText,
      canonicalText,
      copyEnabled: copyEnabled(manualStage, responses),
      edited: previous.edited,
      stale: previous.edited && (previous.stale || canonicalChanged),
    }];
  })) as unknown as Record<ManualStage, WorkbookPromptState>;
  return freezeProgress({ ...progress, responses, manual: { prompts } });
}

export function editWorkbookPrompt(
  workbook: DocumentWorkbook,
  progress: Readonly<WorkbookProgress>,
  stage: "oneShot" | ManualStage,
  text: string,
): Readonly<WorkbookProgress> {
  requireMatchingWorkbook(workbook, progress);
  if (stage === "oneShot") {
    return freezeProgress({
      ...progress,
      oneShotPrompt: {
        ...progress.oneShotPrompt,
        text,
        edited: text !== progress.oneShotPrompt.canonicalText,
        stale: false,
      },
    });
  }
  const previous = progress.manual.prompts[stage];
  return freezeProgress({
    ...progress,
    manual: {
      prompts: {
        ...progress.manual.prompts,
        [stage]: {
          ...previous,
          text,
          edited: text !== previous.canonicalText,
          stale: previous.stale && text !== previous.canonicalText,
        },
      },
    },
  });
}

function restoreCanonicalPrompt(
  workbook: DocumentWorkbook,
  progress: Readonly<WorkbookProgress>,
  stage: "oneShot" | ManualStage,
): Readonly<WorkbookProgress> {
  requireMatchingWorkbook(workbook, progress);
  if (stage === "oneShot") {
    return freezeProgress({
      ...progress,
      oneShotPrompt: {
        ...progress.oneShotPrompt,
        text: progress.oneShotPrompt.canonicalText,
        edited: false,
        stale: false,
      },
    });
  }
  const previous = progress.manual.prompts[stage];
  return freezeProgress({
    ...progress,
    manual: {
      prompts: {
        ...progress.manual.prompts,
        [stage]: { ...previous, text: previous.canonicalText, edited: false, stale: false },
      },
    },
  });
}

export const reapplyWorkbookPrompt = restoreCanonicalPrompt;
export const resetWorkbookPrompt = restoreCanonicalPrompt;

function promptEditor(stage: ManualStage, state: Readonly<WorkbookPromptState>): string {
  const label = stageTitles[stage];
  const actionName = stage[0].toUpperCase() + stage.slice(1);
  return `<section class="prompt-section" data-manual-stage="${stage}" aria-labelledby="heading-${stage}">
    <div class="prompt-heading"><h2 id="heading-${stage}">${label}</h2><button type="button" data-copy-stage="${stage}" aria-label="Copy ${actionName}"${state.copyEnabled ? "" : " disabled"}>Copy prompt</button></div>
    <p class="prerequisite" data-prerequisite-stage="${stage}">${state.copyEnabled ? "Ready to copy." : "Add the required earlier responses to enable Copy."}</p>
    <label for="prompt-${stage}">Editable ${label} prompt</label>
    <textarea id="prompt-${stage}" data-prompt-stage="${stage}" rows="16">${escapeHtml(state.text)}</textarea>
    <p class="stale" data-stale-stage="${stage}"${state.stale ? "" : " hidden"}>Upstream responses changed. Review this preserved edit, then choose Reapply.</p>
    <div class="prompt-actions"><button type="button" data-reset-stage="${stage}">Reset</button><button type="button" data-reapply-stage="${stage}"${state.stale ? "" : " disabled"}>Reapply</button></div>
    <label for="response-${stage}">${label} model response${stage === "final" ? " (optional for progress copy)" : ""}</label>
    <textarea id="response-${stage}" data-response-stage="${stage}" rows="10">${escapeHtml("")}</textarea>
  </section>`;
}

interface StandaloneSource {
  documentKey: string;
  originalDisplayName: string;
  sourceKind: DocumentWorkbook["sourceKind"];
  runbookDocument: Readonly<RunbookDocument>;
  promptBundle: Readonly<PromptBundle>;
  visualAssets: readonly ArtifactVisualAsset[];
}

function standaloneHtml(
  source: StandaloneSource,
  progress: Readonly<WorkbookProgress>,
  workflow: "one-shot" | "manual" | "combined",
  mediaMode: "lightweight" | "full",
  workbookPath: string,
): string {
  const serializedBundle = workflow === "one-shot"
    ? { oneShot: source.promptBundle.oneShot }
    : workflow === "manual"
      ? { manual: source.promptBundle.manual }
      : source.promptBundle;
  const serializedProgress = workflow === "one-shot"
    ? {
        schemaVersion: progress.schemaVersion,
        documentKey: progress.documentKey,
        responses: { oneShot: progress.responses.oneShot },
        oneShotPrompt: progress.oneShotPrompt,
      }
    : workflow === "manual"
      ? {
          schemaVersion: progress.schemaVersion,
          documentKey: progress.documentKey,
          responses: Object.fromEntries(manualStages.map((stage) => [stage, progress.responses[stage]])),
          manual: progress.manual,
        }
      : progress;
  const payload = { schemaVersion: 1, workflow, workbook: {
    documentKey: source.documentKey,
    originalDisplayName: source.originalDisplayName,
    promptBundle: serializedBundle,
  }, progress: serializedProgress };
  const showTabs = workflow === "combined";
  const workflowHidden = workflow === "combined";
  const title = workflow === "combined" ? "Combined prompts" : workflow === "one-shot" ? "One-shot prompt" : "Manual prompts";
  const responseValues = progress.responses;
  const oneShotResponseLabel = source.sourceKind === "project"
    ? PROJECT_ONE_SHOT_RESPONSE_LABEL
    : "One-shot final document and compact audit";
  const manualMarkup = workflow === "one-shot" ? "" : manualStages.map((stage) => promptEditor(stage, progress.manual.prompts[stage])
    .replace(`data-response-stage="${stage}" rows="10"></textarea>`, `data-response-stage="${stage}" rows="10">${escapeHtml(responseValues[stage])}</textarea>`)).join("\n");
  const oneShotMarkup = workflow === "manual" ? "" : `<section id="panel-one-shot"${showTabs ? ' role="tabpanel" aria-labelledby="tab-one-shot" hidden' : ""}>
      <h2>One-shot</h2><label for="prompt-oneShot">Editable One-shot prompt</label><textarea id="prompt-oneShot" data-prompt-stage="oneShot" rows="20">${escapeHtml(progress.oneShotPrompt.text)}</textarea>
      <div class="prompt-actions"><button type="button" data-reset-stage="oneShot">Reset</button></div>
      <label for="response-oneShot">${oneShotResponseLabel}</label><textarea id="response-oneShot" data-response-stage="oneShot" rows="12">${escapeHtml(responseValues.oneShot)}</textarea>
    </section>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <title>${title} — ${escapeHtml(source.originalDisplayName)}</title>
  <style>
    :root { color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; } body { margin: 0; background: #fff; color: #111; line-height: 1.5; }
    main { width: min(100% - 32px, 980px); margin: 0 auto; padding: 32px 0 72px; }
    h1 { margin: 0 0 20px; font-size: clamp(1.75rem, 6vw, 3rem); line-height: 1.08; } h2 { margin: 0; font-size: 1.15rem; }
    .top-actions, .tabs, .prompt-heading, .prompt-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .top-actions { position: sticky; top: 0; z-index: 2; padding: 12px 0; background: #fff; border-bottom: 1px solid #bbb; }
    .tabs { margin: 24px 0; } [role="tab"][aria-selected="true"] { background: #111; color: #fff; }
    .runbook, textarea { width: 100%; border: 1px solid #777; background: #f7f7f7; padding: 14px; color: #111; font: .9rem/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
    .runbook { overflow: auto; margin-bottom: 32px; } textarea { display: block; resize: vertical; }
    .prompt-section, .assets { margin-top: 32px; } .prompt-heading { justify-content: space-between; margin-bottom: 8px; }
    .asset-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 16px; }
    .asset-card { border: 1px solid #bbb; padding: 16px; min-width: 0; } .asset-card img { width: 100%; max-height: 480px; object-fit: contain; }
    .asset-card dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; } .asset-card dd { margin: 0; overflow-wrap: anywhere; }
    button { min-height: 44px; border: 2px solid #111; background: #fff; color: #111; padding: 8px 14px; font: inherit; font-weight: 700; cursor: pointer; }
    button:hover, button:focus-visible { background: #111; color: #fff; } button:disabled { cursor: not-allowed; opacity: .45; }
    label { display: block; margin: 14px 0 6px; font-weight: 700; } .stale { border-left: 4px solid #8a5600; padding-left: 10px; font-weight: 700; }
    #copy-status { min-height: 1.5em; font-weight: 700; }
    [hidden] { display: none !important; }
    @media (max-width: 480px) { main { width: min(100% - 24px, 980px); padding-top: 16px; } .top-actions, .prompt-heading, .prompt-actions { align-items: stretch; flex-direction: column; } button { width: 100%; } .asset-card dl { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <h1>${title} — ${escapeHtml(source.originalDisplayName)}</h1>
    <div class="top-actions">
      ${workflow === "manual" ? "" : '<button type="button" data-copy-stage="oneShot">COPY ONE-SHOT PROMPT</button>'}
      ${workflow === "one-shot" ? "" : "<button type=\"button\" data-copy-active-manual>COPY CURRENT MANUAL PROMPT</button>"}
      <button type="button" data-download-progress>DOWNLOAD PROGRESS COPY</button>
    </div>
    ${showTabs ? `<div class="tabs" role="tablist" aria-label="Workbook sections"><button type="button" role="tab" id="tab-readme" aria-controls="panel-readme" aria-selected="true" data-workflow-tab="readme">README</button><button type="button" role="tab" id="tab-one-shot" aria-controls="panel-one-shot" aria-selected="false" tabindex="-1" data-workflow-tab="one-shot">ONE-SHOT</button><button type="button" role="tab" id="tab-manual" aria-controls="panel-manual" aria-selected="false" tabindex="-1" data-workflow-tab="manual">MANUAL</button></div>` : ""}
    <section id="panel-readme"${showTabs ? ' role="tabpanel" aria-labelledby="tab-readme"' : ""}>${renderRunbookHtml(source.runbookDocument, { archiveRootPrefix: archiveRootPrefix(workbookPath) })}<section class="assets" aria-labelledby="assets-heading"><h2 id="assets-heading">Visual assets</h2>${assetHtml(source.visualAssets, mediaMode, workbookPath)}</section></section>
    ${oneShotMarkup}
    ${workflow === "one-shot" ? "" : `<section id="panel-manual"${showTabs ? ' role="tabpanel" aria-labelledby="tab-manual"' : ""}${workflowHidden ? " hidden" : ""}>${manualMarkup}</section>`}
    <p id="copy-status" role="status" aria-live="polite"></p>
  </main>
  <script type="application/json" id="workbook-data">${escapeJsonForScript(payload)}</script>
  <script>
    (() => {
      const manualStages = ["decompose", "rewrite", "verify", "final"];
      const prerequisites = { decompose: [], rewrite: ["decompose"], verify: ["decompose", "rewrite"], final: ["decompose", "rewrite", "verify"] };
      const markers = { decompose: "<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>", rewrite: "<<<INSERT_STAGE_2_REWRITE_RESPONSE>>>", verify: "<<<INSERT_STAGE_3_VERIFICATION_RESPONSE>>>" };
      const payload = JSON.parse(document.getElementById("workbook-data").textContent);
      let state = payload.progress;
      const hasOneShot = Boolean(state.oneShotPrompt);
      const hasManual = Boolean(state.manual);
      const stageLabels = { oneShot: "One-shot", decompose: "Decompose", rewrite: "Rewrite", verify: "Verify", final: "Final" };
      let activeManualStage = "decompose";
      const status = document.getElementById("copy-status");
      const escapedJson = (value) => JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
      const hydrated = (stage) => Object.entries(markers).reduce((text, pair) => text.replaceAll(pair[1], state.responses[pair[0]].trim() ? state.responses[pair[0]] : pair[1]), payload.workbook.promptBundle.manual[stage]);
      const enabled = (stage) => prerequisites[stage].every((item) => state.responses[item].trim().length > 0);
      const render = () => {
        if (hasOneShot) {
          document.querySelector('[data-prompt-stage="oneShot"]').value = state.oneShotPrompt.text;
          document.querySelector('[data-response-stage="oneShot"]').value = state.responses.oneShot;
        }
        if (hasManual) manualStages.forEach((stage) => {
          const prompt = state.manual.prompts[stage];
          document.querySelector('[data-prompt-stage="' + stage + '"]').value = prompt.text;
          document.querySelector('[data-response-stage="' + stage + '"]').value = state.responses[stage];
          document.querySelector('[data-copy-stage="' + stage + '"]').disabled = !prompt.copyEnabled;
          const stale = document.querySelector('[data-stale-stage="' + stage + '"]');
          stale.hidden = !prompt.stale;
          document.querySelector('[data-reapply-stage="' + stage + '"]').disabled = !prompt.stale;
        });
        if (hasManual) document.querySelector("button[data-copy-active-manual]").disabled = !state.manual.prompts[activeManualStage].copyEnabled;
      };
      const setResponse = (stage, value) => {
        state = { ...state, responses: { ...state.responses, [stage]: value } };
        if (!hasManual) { render(); return; }
        const prompts = { ...state.manual.prompts };
        manualStages.forEach((manualStage) => {
          const previous = prompts[manualStage];
          const canonicalText = hydrated(manualStage);
          prompts[manualStage] = { ...previous, text: previous.edited ? previous.text : canonicalText, canonicalText, copyEnabled: enabled(manualStage), stale: previous.edited && (previous.stale || canonicalText !== previous.canonicalText) };
        });
        state = { ...state, manual: { prompts } };
        render();
      };
      const setPrompt = (stage, value) => {
        if (stage === "oneShot") state = { ...state, oneShotPrompt: { ...state.oneShotPrompt, text: value, edited: value !== state.oneShotPrompt.canonicalText, stale: false } };
        else { const previous = state.manual.prompts[stage]; state = { ...state, manual: { prompts: { ...state.manual.prompts, [stage]: { ...previous, text: value, edited: value !== previous.canonicalText, stale: previous.stale && value !== previous.canonicalText } } } }; }
      };
      const resetPrompt = (stage) => {
        if (stage === "oneShot") state = { ...state, oneShotPrompt: { ...state.oneShotPrompt, text: state.oneShotPrompt.canonicalText, edited: false, stale: false } };
        else { const previous = state.manual.prompts[stage]; state = { ...state, manual: { prompts: { ...state.manual.prompts, [stage]: { ...previous, text: previous.canonicalText, edited: false, stale: false } } } }; }
        render();
      };
      const selectForManualCopy = (node) => { const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(node); selection.removeAllRanges(); selection.addRange(range); };
      const copy = async (stage) => {
        const node = document.querySelector('[data-prompt-stage="' + stage + '"]'); const text = node.value; let copied = false;
        try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); copied = true; } } catch { copied = false; }
        if (!copied) { node.focus(); node.select(); try { copied = document.execCommand("copy"); } catch { copied = false; } if (!copied) selectForManualCopy(node); }
        const label = stageLabels[stage];
        status.textContent = copied ? label + " prompt copied." : "Copy unavailable. The " + label + " prompt is selected; press Ctrl+C or Command+C.";
      };
      const progressCopy = () => {
        const clone = document.documentElement.cloneNode(true); const nextPayload = { ...payload, progress: state };
        clone.querySelector("#workbook-data").textContent = escapedJson(nextPayload);
        const html = "<!doctype html>\\n" + clone.outerHTML;
        const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
        const link = document.createElement("a"); link.href = url; link.download = payload.workbook.documentKey + "-progress.html"; link.click(); URL.revokeObjectURL(url);
      };
      const selectWorkflow = (selected, moveFocus) => {
        document.querySelectorAll('[role="tab"][data-workflow-tab]').forEach((tab) => { const active = tab.dataset.workflowTab === selected; tab.setAttribute("aria-selected", String(active)); tab.tabIndex = active ? 0 : -1; });
        document.getElementById("panel-readme").hidden = selected !== "readme";
        document.getElementById("panel-one-shot").hidden = selected !== "one-shot";
        document.getElementById("panel-manual").hidden = selected !== "manual";
        if (moveFocus) document.querySelector('[data-workflow-tab="' + selected + '"]').focus();
      };
      document.addEventListener("input", (event) => {
        const responseStage = event.target.dataset.responseStage; if (responseStage) setResponse(responseStage, event.target.value);
        const promptStage = event.target.dataset.promptStage; if (promptStage) { activeManualStage = promptStage === "oneShot" ? activeManualStage : promptStage; setPrompt(promptStage, event.target.value); render(); }
      });
      document.addEventListener("keydown", (event) => {
        const tab = event.target.closest('[role="tab"][data-workflow-tab]'); if (!tab) return;
        const tabs = Array.from(document.querySelectorAll('[role="tab"][data-workflow-tab]'));
        const index = tabs.indexOf(tab); let next;
        if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
        else if (event.key === "ArrowLeft") next = tabs[(index - 1 + tabs.length) % tabs.length];
        else if (event.key === "Home") next = tabs[0];
        else if (event.key === "End") next = tabs[tabs.length - 1];
        if (!next) return; event.preventDefault(); selectWorkflow(next.dataset.workflowTab, true);
      });
      document.addEventListener("click", (event) => {
        const button = event.target.closest("button"); if (!button) return;
        if (button.dataset.copyStage) void copy(button.dataset.copyStage);
        if (button.dataset.copyActiveManual !== undefined && state.manual.prompts[activeManualStage].copyEnabled) void copy(activeManualStage);
        if (button.dataset.resetStage) resetPrompt(button.dataset.resetStage);
        if (button.dataset.reapplyStage) resetPrompt(button.dataset.reapplyStage);
        if (button.dataset.downloadProgress !== undefined) progressCopy();
        if (button.dataset.workflowTab) selectWorkflow(button.dataset.workflowTab, true);
      });
      render();
    })();
  </script>
</body>
</html>
`;
}

function sourceFromWorkbook(workbook: DocumentWorkbook): StandaloneSource {
  const runbookDocument = workbook.runbookDocument ?? Object.freeze({
    type: "runbook-document" as const,
    blocks: Object.freeze([Object.freeze({
      type: "paragraph" as const,
      content: Object.freeze([Object.freeze({ type: "text" as const, value: workbook.runbookMarkdown })]),
    })]),
  });
  return {
    documentKey: workbook.documentKey,
    originalDisplayName: workbook.originalDisplayName,
    sourceKind: workbook.sourceKind,
    runbookDocument,
    promptBundle: workbook.promptBundle,
    visualAssets: workbook.visualAssets.map((asset) => ({ asset, path: asset.packagedPath })),
  };
}

export function renderWorkbookProgressHtml(
  workbook: DocumentWorkbook,
  progress: Readonly<WorkbookProgress>,
): string {
  requireMatchingWorkbook(workbook, progress);
  const workbookPath = workbook.paths?.combinedHtml
    ?? `documents/${workbook.documentKey}/combined-prompts/combined-prompts.html`;
  return standaloneHtml(sourceFromWorkbook(workbook), progress, "combined", "lightweight", workbookPath);
}

function isPromptState(value: unknown): value is WorkbookPromptState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return typeof state.text === "string"
    && typeof state.canonicalText === "string"
    && typeof state.copyEnabled === "boolean"
    && typeof state.edited === "boolean"
    && typeof state.stale === "boolean";
}

export function parseWorkbookProgressHtml(
  workbook: DocumentWorkbook,
  html: string,
): Readonly<WorkbookProgress> {
  const match = html.match(/<script type="application\/json" id="workbook-data">([\s\S]*?)<\/script>/u);
  if (!match) throw new Error("Workbook progress data is missing.");
  const parsed = JSON.parse(match[1]) as { progress?: unknown };
  if (!parsed.progress || typeof parsed.progress !== "object") throw new Error("Workbook progress data is invalid.");
  const progress = parsed.progress as WorkbookProgress;
  if (progress.schemaVersion !== 1
    || progress.documentKey !== workbook.documentKey
    || !progress.responses
    || !manualStages.concat("oneShot" as never).every((stage) => typeof progress.responses[stage] === "string")
    || !isPromptState(progress.oneShotPrompt)
    || !progress.manual?.prompts
    || !manualStages.every((stage) => isPromptState(progress.manual.prompts[stage]))) {
    throw new Error("Workbook progress data is invalid.");
  }
  return freezeProgress(progress);
}

export function createDocumentWorkbook(
  manifest: PromptPackageManifest,
  documentIndex: number,
  runbookDocument: Readonly<RunbookDocument>,
  promptBundle: PromptBundle,
  assets: readonly ArtifactVisualAsset[] = [],
): DocumentWorkbook {
  const document = manifest.documents[documentIndex];
  const runbookMarkdown = serializeRunbookMarkdown(runbookDocument);
  const runbook = Object.freeze({
    package: Object.freeze({ ...manifest.package }),
    documentKey: document.key,
    originalDisplayName: document.originalDisplayName,
    sourceKind: document.source.kind,
    model: Object.freeze({ ...document.model, promptStrategy: Object.freeze({ ...document.model.promptStrategy }) }),
    settings: Object.freeze({ ...document.settings }),
    contextAssessment: Object.freeze({ ...document.contextAssessment }),
    contextWarningAcknowledged: document.contextWarningAcknowledged,
    responseMarkers: Object.freeze({ ...manifest.workflow.responseMarkers }),
  });
  const frozenBundle = Object.freeze({
    oneShot: promptBundle.oneShot,
    manual: Object.freeze({ ...promptBundle.manual }),
  });
  const promptBlocks = Object.freeze(manualStages.map((stage) => Object.freeze({
    stage,
    title: stageTitles[stage],
    content: promptBundle.manual[stage],
  } satisfies CombinedPromptBlock)));
  const source: StandaloneSource = {
    documentKey: document.key,
    originalDisplayName: document.originalDisplayName,
    sourceKind: document.source.kind,
    runbookDocument,
    promptBundle: frozenBundle,
    visualAssets: assets,
  };
  const paths = Object.freeze({
    readme: manifest.rootArtifacts.readme.path,
    oneShotMarkdown: document.workbooks.oneShot.markdown.path,
    oneShotHtml: document.workbooks.oneShot.html.path,
    manualMarkdown: document.workbooks.manual.markdown.path,
    manualHtml: document.workbooks.manual.html.path,
    combinedMarkdown: document.workbooks.combined.markdown.path,
    combinedHtml: document.workbooks.combined.html.path,
    ...(document.workbooks.combined.fullHtml.status === "generated" ? { combinedFullHtml: document.workbooks.combined.fullHtml.path } : {}),
  });
  const shell = { documentKey: document.key, originalDisplayName: document.originalDisplayName, sourceKind: document.source.kind, runbook, runbookDocument, runbookMarkdown, paths, promptBundle: frozenBundle, promptBlocks, visualAssets: [] } as unknown as DocumentWorkbook;
  const progress = createWorkbookProgress(shell);
  const oneShotMarkdown = workflowMarkdown(runbookMarkdown, document.originalDisplayName, promptBundle, assets, "one-shot", paths.oneShotMarkdown);
  const manualMarkdown = workflowMarkdown(runbookMarkdown, document.originalDisplayName, promptBundle, assets, "manual", paths.manualMarkdown);
  const combinedMarkdown = workflowMarkdown(runbookMarkdown, document.originalDisplayName, promptBundle, assets, "combined", paths.combinedMarkdown);
  const oneShotHtml = standaloneHtml(source, progress, "one-shot", "lightweight", paths.oneShotHtml);
  const manualHtml = standaloneHtml(source, progress, "manual", "lightweight", paths.manualHtml);
  const combinedHtml = standaloneHtml(source, progress, "combined", "lightweight", paths.combinedHtml);
  const estimatedFullBytes = textEncoder.encode(combinedHtml).byteLength + assets
    .filter(({ asset }) => asset.included && supportsInlinePreview(asset))
    .reduce((total, { asset }) => total + Math.ceil(asset.byteCount / 3) * 4, 0);
  const fullHtmlCandidate = document.workbooks.combined.fullHtml.status === "generated" && estimatedFullBytes <= MAX_FULL_HTML_BYTES
    ? standaloneHtml(source, progress, "combined", "full", paths.combinedFullHtml ?? paths.combinedHtml)
    : undefined;
  const fullHtml = fullHtmlCandidate && textEncoder.encode(fullHtmlCandidate).byteLength <= MAX_FULL_HTML_BYTES
    ? fullHtmlCandidate
    : undefined;
  const visualAssets = Object.freeze(assets.map(({ asset, path }) => Object.freeze({
    ...asset,
    packagedPath: path,
    bytes: asset.bytes.slice(),
    warnings: Object.freeze([...asset.warnings]) as unknown as string[],
    ...(asset.bounds ? { bounds: Object.freeze({ ...asset.bounds }) } : {}),
  })));
  const combined = Object.freeze({
    markdown: combinedMarkdown,
    html: combinedHtml,
    ...(fullHtml ? { fullHtml } : {}),
    fullHtmlStatus: fullHtml ? "generated" as const : "not-generated" as const,
  });
  return Object.freeze({
    documentKey: document.key,
    originalDisplayName: document.originalDisplayName,
    sourceKind: document.source.kind,
    runbook,
    runbookDocument,
    runbookMarkdown,
    paths,
    promptBundle: frozenBundle,
    promptBlocks,
    oneShot: Object.freeze({ prompt: promptBundle.oneShot, markdown: oneShotMarkdown, html: oneShotHtml }),
    manual: Object.freeze({ promptBlocks, markdown: manualMarkdown, html: manualHtml }),
    combined,
    markdown: combined.markdown,
    html: combined.html,
    ...(combined.fullHtml ? { fullHtml: combined.fullHtml } : {}),
    fullHtmlStatus: combined.fullHtmlStatus,
    visualAssets,
  });
}

/** @deprecated Use createDocumentWorkbook. */
export const createCombinedPromptArtifact = createDocumentWorkbook;
