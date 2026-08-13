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

const codeProjectFidelityGuidance = `## Code and Project Fidelity Contract
Preserve executable syntax, control flow, identifiers, imports and signatures, paths, keys, types, numbers, placeholders and escapes, citations and licenses, markup structure, and table shape and formulas.
Return changed text files only in deterministic path-delimited blocks. Report unchanged, excluded, and risk manifests. Do not modify excluded files. Tools may edit only a copied project and must report the same manifest. Do not claim that builds or tests were run.
Inspect the generated diffs and run your normal tests/build after applying changes.`;

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
    ? `\n\n## LaTeX Fidelity Contract\nPreserve LaTeX preambles, macros, math, citations, labels, references, paths, and figure environments unless an explicit requirement says otherwise. Main file: ${context.latexMainFile ?? "standalone or not yet selected"}. For a multi-file response, emit one safe block per rewritten TeX source using exactly:\n<<<FILE relative/path.tex>>>\nrewritten source\n<<<END FILE>>>\nDo not rewrite bibliography or binary asset bytes.`
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
  return `## Model Workflow
Selected model: ${profile.label}
Reference model: ${profile.promptStrategy.referenceModel}
Guidance version: ${profile.promptStrategy.version}
One-shot guidance version: ${profile.promptStrategy.oneShotGuidanceVersion}
Start a new conversation for each document. One-shot performs Decompose, Rewrite, Verify, and Final internally in a single request.

## Model-Specific Execution Guidance
${profile.promptStrategy.sharedGuidance}
${profile.promptStrategy.oneShotGuidance}

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
  return `## Model Workflow
Selected model: ${profile.label}
Reference model: ${profile.promptStrategy.referenceModel}
Guidance version: ${profile.promptStrategy.version}
${profile.workflowNote}

## Model-Specific Execution Guidance
${profile.promptStrategy.sharedGuidance}
Current stage: ${profile.promptStrategy.stageGuidance[stage]}

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
): string {
  const template = templateByStage[stage];
  if (profile.promptStrategy.layout === "source-first-task-last") {
    return `${artifacts.join("\n\n")}\n\n${context}\n\n${template}`;
  }
  return `${template}\n${context}\n\n${artifacts.join("\n\n")}`;
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

  return {
    decompose: promptForStage("decompose", sharedContext(settings, profile, "decompose", documentContext), [source], profile),
    rewrite: promptForStage("rewrite", sharedContext(settings, profile, "rewrite", documentContext), [source, decomposition], profile),
    verify: promptForStage("verify", sharedContext(settings, profile, "verify", documentContext), [source, decomposition, rewrite], profile),
    final: promptForStage("final", sharedContext(settings, profile, "final", documentContext), [source, decomposition, rewrite, verification], profile),
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
  const oneShot = profile.promptStrategy.layout === "source-first-task-last"
    ? `${source}\n\n${context}\n\n${oneShotTemplate}`
    : `${oneShotTemplate}\n${context}\n\n${source}`;

  return {
    oneShot,
    manual: renderPromptSet(sourceText, settings, profile, documentContext),
  };
}
