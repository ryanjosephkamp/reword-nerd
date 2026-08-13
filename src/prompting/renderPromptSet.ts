import decomposeTemplate from "../../prompts/01_decompose.md?raw";
import rewriteTemplate from "../../prompts/02_rewrite.md?raw";
import verifyTemplate from "../../prompts/03_verify.md?raw";
import finalTemplate from "../../prompts/04_final.md?raw";
import oneShotTemplate from "../../prompts/00_one_shot.md?raw";
import type { DocumentFormat, PromptBundle, PromptSet } from "../domain/contracts";
import type { SourcePreviewKind } from "../domain/sourceText";
import type {
  ModelProfile,
  PromptDelimiterStyle,
  PromptStage,
} from "../domain/profiles";
import {
  formalityLabel,
  lengthLabel,
  toneLabel,
  type RewriteSettings,
  type CodeRewriteOptions,
} from "../domain/settings";

export const responseMarkers = {
  decompose: "<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>",
  rewrite: "<<<INSERT_STAGE_2_REWRITE_RESPONSE>>>",
  verify: "<<<INSERT_STAGE_3_VERIFICATION_RESPONSE>>>",
} as const;

const templateByStage: Record<PromptStage, string> = {
  decompose: decomposeTemplate,
  rewrite: rewriteTemplate,
  verify: verifyTemplate,
  final: finalTemplate,
};

function withoutTerminalSection(template: string, heading: string): string {
  const sectionStart = template.indexOf(heading);
  if (sectionStart < 0) throw new Error(`Canonical prompt section is missing: ${heading}`);
  return template.slice(0, sectionStart).trimEnd();
}

const projectOneShotTemplate = withoutTerminalSection(oneShotTemplate, "## Required Output Contract")
  .replace("finalize the rewritten document", "finalize changed included project files");
const projectRewriteTemplate = withoutTerminalSection(rewriteTemplate, "## Output")
  .replace("The original source document", "The original reviewed project source")
  .replace("A structured semantic decomposition of that document", "A structured semantic decomposition of that project source")
  .replace("produce a new version of the document", "produce rewritten versions of applicable included project text files")
  .replace("Write a complete new version of the document", "Write complete new versions of changed included project text files");
const projectFinalTemplate = withoutTerminalSection(finalTemplate, "## Output")
  .replace("Produce the final polished version of the document.", "Produce final complete versions of only the changed included project files.");

function xmlName(name: string): string {
  return name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replaceAll(/^_+|_+$/g, "");
}

function artifact(name: string, contents: string, delimiterStyle: PromptDelimiterStyle): string {
  const separator = contents.endsWith("\n") ? "" : "\n";
  if (delimiterStyle === "xml") {
    const tag = xmlName(name);
    return `<${tag}>\n${contents}${separator}</${tag}>`;
  }
  return `===== BEGIN ${name} =====\n${contents}${separator}===== END ${name} =====`;
}

export interface PromptAssetContext {
  id: string;
  filename: string;
  mimeType: string;
  pageNumber?: number;
  sourcePath?: string;
  caption?: string;
  altText?: string;
  included: boolean;
}

export interface PromptSourceFile {
  path: string;
  text: string;
  originalHash: string;
  reviewedTextHash: string;
  languageId: string;
  previewKind: SourcePreviewKind;
}

export interface PromptDocumentContext {
  kind?: "document";
  format: DocumentFormat;
  assets: readonly PromptAssetContext[];
  latexMainFile?: string | null;
  codeRewriteOptions?: CodeRewriteOptions;
}

export interface PromptProjectContext {
  kind: "project";
  format: DocumentFormat;
  assets: readonly PromptAssetContext[];
  reviewedTreeHash: string;
  includedFiles: readonly PromptSourceFile[];
  excludedPaths: readonly string[];
  codeRewriteOptions: CodeRewriteOptions;
  latexMainFile?: string | null;
}

export type PromptSourceContext = PromptDocumentContext | PromptProjectContext;

export type PromptProjectSource = Pick<PromptProjectContext,
  "kind" | "reviewedTreeHash" | "includedFiles" | "excludedPaths">;

export function sourceBoundaryToken(treeHash: string, files: readonly Pick<PromptSourceFile, "text">[]): string {
  const canonicalHash = treeHash.replaceAll(/[^a-f0-9]/giu, "").toUpperCase();
  let length = Math.min(12, canonicalHash.length);
  let token = `SOURCE_BOUNDARY_${canonicalHash.slice(0, length)}`;
  const content = files.map((file) => file.text).join("\n");
  while (content.includes(token)) {
    if (length < canonicalHash.length) length = Math.min(canonicalHash.length, length + 4);
    else token += "_X";
    token = length < canonicalHash.length || !token.endsWith("_X")
      ? `SOURCE_BOUNDARY_${canonicalHash.slice(0, length)}`
      : token;
  }
  return token;
}

export function renderPromptSource(context: PromptProjectSource): string {
  const files = [...context.includedFiles].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const boundary = sourceBoundaryToken(context.reviewedTreeHash, files);
  const body = files.map((file) => `${boundary} BEGIN FILE ${file.path} | ORIGINAL ${file.originalHash} | REVIEWED ${file.reviewedTextHash}\n${file.text}${file.text.endsWith("\n") ? "" : "\n"}${boundary} END FILE ${file.path}`).join("\n");
  return `${boundary} BEGIN PROJECT\nReviewed snapshot: ${context.reviewedTreeHash}\n${body}\nExcluded paths: ${context.excludedPaths.length > 0 ? [...context.excludedPaths].sort().join(", ") : "None."}\n${boundary} END PROJECT`;
}

function projectFinalOutputContract(context: PromptProjectContext): string {
  const boundary = sourceBoundaryToken(context.reviewedTreeHash, context.includedFiles);
  return `## Project Final Output Contract

For this project source, this terminal contract replaces every earlier document-only final-document, single-document, two-block, or fidelity-audit output instruction. Keep fidelity-audit concerns inside RISK_MANIFEST and do not emit a separate audit.

Return exactly the following four top-level sections in this order and no preamble or trailing commentary. Use exact reviewed project paths. Sort changed-file blocks and all manifest entries by path in ascending Unicode code-unit order.

\`\`\`text
<<<CHANGED_FILES>>>
${boundary} BEGIN CHANGED FILES
${boundary} BEGIN CHANGED FILE path/to/changed-file.ext
[Complete UTF-8 contents of this changed text file]
${boundary} END CHANGED FILE path/to/changed-file.ext
${boundary} END CHANGED FILES
<<<END_CHANGED_FILES>>>

<<<UNCHANGED_PATHS>>>
- path/to/unchanged-file.ext
<<<END_UNCHANGED_PATHS>>>

<<<EXCLUDED_PATHS>>>
- path/to/excluded-file.ext
<<<END_EXCLUDED_PATHS>>>

<<<RISK_MANIFEST>>>
- path/to/affected-file.ext | REVIEW | [compact evidence-bound risk]
<<<END_RISK_MANIFEST>>>
\`\`\`

Inside CHANGED_FILES, emit one complete path-delimited block per changed prompt-included text file; never emit a patch, diff, excerpt, ellipsis, or omitted section. If there are no changed files, emit \`None.\` between the CHANGED FILES boundary lines. UNCHANGED_PATHS must list every prompt-included file not returned as changed. EXCLUDED_PATHS must list every supplied excluded path and must not propose changes to it. RISK_MANIFEST must list only concrete affected paths and compact evidence-bound risks; emit \`None.\` when no risk remains. Use \`None.\` for any other empty block. Every prompt-included path must appear exactly once as changed or unchanged.`;
}

const codeProjectFidelityGuidance = `## Code and Project Fidelity Contract
Preserve executable syntax, control flow, identifiers, imports and signatures, paths, keys, types, numbers, placeholders and escapes, citations and licenses, markup structure, and table shape and formulas.
Do not modify excluded files. Do not claim that builds or tests were run.
Inspect the generated diffs and run your normal tests/build after applying changes.`;

function projectStageGuidance(context: PromptProjectContext, stage: PromptStage): string {
  const boundary = sourceBoundaryToken(context.reviewedTreeHash, context.includedFiles);
  switch (stage) {
    case "decompose":
      return "For this project stage, return only a structured semantic inventory organized by exact included path. Inventory rewriteable narrative and every protected code or structured-data constraint; do not return changed files or a final manifest.";
    case "rewrite":
      return `For this project stage, return only candidate complete UTF-8 changed-file blocks, sorted by exact path, using ${boundary} BEGIN CANDIDATE FILE path/to/changed-file.ext and ${boundary} END CANDIDATE FILE path/to/changed-file.ext. Omit unchanged and excluded file contents. Do not return final unchanged, excluded, or risk manifests at this stage.`;
    case "verify":
      return "For this project stage, return only an evidence-bound verification report organized by exact path. Identify supported repairs and remaining risks without returning changed-file contents or final manifests.";
    case "final":
      return "For this project stage, repair only verified issues in included project files and follow the terminal project final output contract. Do not return a single document or separate process commentary.";
  }
}

const projectOneShotExecutionGuidance = "For this project source, perform the four project stages internally and finalize changed included project files. Keep intermediate work internal and follow only the terminal project final output contract.";

function isCodeOrStructuredFormat(format: DocumentFormat): boolean {
  return new Set<DocumentFormat>([
    "html", "xml", "json", "jsonl", "ndjson", "csv", "tsv", "yaml", "toml",
    "ini", "config", "css", "sql", "code",
  ]).has(format);
}

function codeRewriteSelection(options: CodeRewriteOptions | undefined): string {
  if (!options) return "";
  return `\n\n## Rewrite Selection\nDocumentation and markup: ${options.documentationAndMarkup ? "include" : "exclude"}\nComments and docstrings: ${options.commentsAndDocstrings ? "include" : "exclude"}\nUser-facing strings: ${options.userFacingStrings ? "include" : "exclude"}\nNarrative structured-data values: ${options.narrativeStructuredDataValues ? "include" : "exclude"}\nProtected executable syntax: always preserve`;
}

const assetStageGuidance: Record<PromptStage, string> = {
  decompose: "For this stage, inventory every included visual asset, its caption or description, the claim it supports, its source location, and any placement uncertainty.",
  rewrite: "For this stage, place each required visual asset near the rewritten discussion it supports and preserve stable asset identifiers and figure references.",
  verify: "For this stage, verify every included asset is referenced correctly, captions remain faithful, and no unsupported visual claim was introduced.",
  final: "For this stage, repair missing or incorrect visual placement. Propose a clearly identified description only when the source supplied no caption or alt text.",
};

const oneShotAssetGuidance = "For the internal decomposition, inventory every included asset and its role. Preserve and place required assets in the rewrite, verify every reference and caption, then repair any supported fidelity issue before finalizing.";

function documentFidelityContext(context: PromptSourceContext, stage: PromptStage | "oneShot"): string {
  const included = context.assets.filter((asset) => asset.included);
  const catalog = included.length === 0
    ? "No extracted visual assets are included."
    : included.map((asset) => [
      asset.id,
      asset.filename,
      asset.sourcePath ? `source ${asset.sourcePath}` : undefined,
      asset.pageNumber ? `page ${asset.pageNumber}` : undefined,
      asset.caption ? `caption ${asset.caption}` : undefined,
      asset.altText ? `alt ${asset.altText}` : "description missing",
    ].filter(Boolean).join(" | ")).join("\n");
  const latex = context.format === "latex" || context.format === "latex-project"
    ? context.kind === "project"
      ? `\n\n## LaTeX Fidelity Contract\nPreserve LaTeX preambles, macros, math, citations, labels, references, paths, and figure environments unless an explicit requirement says otherwise. Main file: ${context.latexMainFile ?? "not yet selected"}. Use only the project source boundaries and the project stage or final output contract for paths and file contents. Do not use a separate LaTeX-specific file-block format. Do not rewrite bibliography or binary asset bytes.`
      : `\n\n## LaTeX Fidelity Contract\nPreserve LaTeX preambles, macros, math, citations, labels, references, paths, and figure environments unless an explicit requirement says otherwise. Main file: ${context.latexMainFile ?? "standalone or not yet selected"}. For a multi-file response, emit one safe block per rewritten TeX source using exactly:\n<<<FILE relative/path.tex>>>\nrewritten source\n<<<END FILE>>>\nDo not rewrite bibliography or binary asset bytes.`
    : "";
  const guidance = stage === "oneShot" ? oneShotAssetGuidance : assetStageGuidance[stage];
  const codeProject = context.kind === "project" || isCodeOrStructuredFormat(context.format)
    ? `\n\n${codeProjectFidelityGuidance}${codeRewriteSelection(context.codeRewriteOptions)}`
    : "";
  return `## Visual Asset Workflow\n${guidance}\nAttach the packaged files manually when the selected model interface supports image input. Otherwise use this catalog and the reviewed OCR text.\n\n${artifact("VISUAL ASSET CATALOG", catalog, "markdown")}${latex}${codeProject}`;
}

function oneShotContext(
  settings: RewriteSettings,
  profile: ModelProfile,
  documentContext?: PromptSourceContext,
): string {
  const customRequirements = settings.customRequirements || "None.";
  const project = documentContext?.kind === "project";
  return `## Model Workflow
Selected model: ${profile.label}
Reference model: ${profile.promptStrategy.referenceModel}
Guidance version: ${profile.promptStrategy.version}
One-shot guidance version: ${profile.promptStrategy.oneShotGuidanceVersion}
${project ? "Start a new conversation for each project. One-shot performs Decompose, Rewrite, Verify, and Final internally in a single request." : "Start a new conversation for each document. One-shot performs Decompose, Rewrite, Verify, and Final internally in a single request."}

## Model-Specific Execution Guidance
${profile.promptStrategy.sharedGuidance}
${project ? projectOneShotExecutionGuidance : profile.promptStrategy.oneShotGuidance}

## Rewrite Preferences
Tone: ${toneLabel(settings.tone)}
Formality: ${formalityLabel(settings.formality)}
Length: ${lengthLabel(settings.length)}
Output language: ${settings.outputLanguage}
${artifact("CUSTOM REQUIREMENTS", customRequirements, profile.promptStrategy.delimiterStyle)}${documentContext ? `\n\n${documentFidelityContext(documentContext, "oneShot")}` : ""}`;
}

function sharedContext(
  settings: RewriteSettings,
  profile: ModelProfile,
  stage: PromptStage,
  documentContext?: PromptSourceContext,
): string {
  const customRequirements = settings.customRequirements || "None.";
  const project = documentContext?.kind === "project" ? documentContext : undefined;
  return `## Model Workflow
Selected model: ${profile.label}
Reference model: ${profile.promptStrategy.referenceModel}
Guidance version: ${profile.promptStrategy.version}
${project ? "Start a new conversation for each project, run the four prompts in order, and replace response markers with the previous stage outputs." : profile.workflowNote}

## Model-Specific Execution Guidance
${profile.promptStrategy.sharedGuidance}
Current stage: ${project ? "Follow the project-specific stage contract at the end of this prompt." : profile.promptStrategy.stageGuidance[stage]}

## Rewrite Preferences
Tone: ${toneLabel(settings.tone)}
Formality: ${formalityLabel(settings.formality)}
Length: ${lengthLabel(settings.length)}
Output language: ${settings.outputLanguage}
${artifact("CUSTOM REQUIREMENTS", customRequirements, profile.promptStrategy.delimiterStyle)}${documentContext ? `\n\n${documentFidelityContext(documentContext, stage)}` : ""}`;
}

function promptForStage(
  stage: PromptStage,
  context: string,
  artifacts: string[],
  profile: ModelProfile,
  template: string = templateByStage[stage],
  terminalContract?: string,
): string {
  const prompt = profile.promptStrategy.layout === "source-first-task-last"
    ? `${artifacts.join("\n\n")}\n\n${context}\n\n${template}`
    : `${template}\n${context}\n\n${artifacts.join("\n\n")}`;
  return terminalContract ? `${prompt}\n\n${terminalContract}` : prompt;
}

export function renderPromptSet(
  sourceText: string,
  settings: RewriteSettings,
  profile: ModelProfile,
  documentContext?: PromptSourceContext,
): PromptSet {
  const delimiterStyle = profile.promptStrategy.delimiterStyle;
  const source = documentContext?.kind === "project"
    ? renderPromptSource(documentContext)
    : artifact("SOURCE DOCUMENT", sourceText, delimiterStyle);
  const decomposition = artifact("STAGE 1 DECOMPOSITION", responseMarkers.decompose, delimiterStyle);
  const rewrite = artifact("STAGE 2 REWRITE", responseMarkers.rewrite, delimiterStyle);
  const verification = artifact("STAGE 3 VERIFICATION", responseMarkers.verify, delimiterStyle);
  const projectFinalContract = documentContext?.kind === "project"
    ? projectFinalOutputContract(documentContext)
    : undefined;
  const projectStageContract = documentContext?.kind === "project"
    ? (stage: PromptStage) => projectStageGuidance(documentContext, stage)
    : undefined;

  return {
    decompose: promptForStage("decompose", sharedContext(settings, profile, "decompose", documentContext), [source], profile, decomposeTemplate, projectStageContract?.("decompose")),
    rewrite: promptForStage("rewrite", sharedContext(settings, profile, "rewrite", documentContext), [source, decomposition], profile, projectStageContract ? projectRewriteTemplate : rewriteTemplate, projectStageContract?.("rewrite")),
    verify: promptForStage("verify", sharedContext(settings, profile, "verify", documentContext), [source, decomposition, rewrite], profile, verifyTemplate, projectStageContract?.("verify")),
    final: promptForStage(
      "final",
      sharedContext(settings, profile, "final", documentContext),
      [source, decomposition, rewrite, verification],
      profile,
      projectFinalContract ? projectFinalTemplate : finalTemplate,
      projectFinalContract ? `${projectStageContract?.("final")}\n\n${projectFinalContract}` : undefined,
    ),
  };
}

export function renderPromptBundle(
  sourceText: string,
  settings: RewriteSettings,
  profile: ModelProfile,
  documentContext?: PromptSourceContext,
): PromptBundle {
  const source = documentContext?.kind === "project"
    ? renderPromptSource(documentContext)
    : artifact("SOURCE DOCUMENT", sourceText, profile.promptStrategy.delimiterStyle);
  const context = oneShotContext(settings, profile, documentContext);
  const projectFinalContract = documentContext?.kind === "project"
    ? projectFinalOutputContract(documentContext)
    : undefined;
  const oneShotTask = projectFinalContract ? projectOneShotTemplate : oneShotTemplate;
  const assembledOneShot = profile.promptStrategy.layout === "source-first-task-last"
    ? `${source}\n\n${context}\n\n${oneShotTask}`
    : `${oneShotTask}\n${context}\n\n${source}`;
  const oneShot = projectFinalContract
    ? `${assembledOneShot}\n\n${projectFinalContract}`
    : assembledOneShot;

  return {
    oneShot,
    manual: renderPromptSet(sourceText, settings, profile, documentContext),
  };
}
