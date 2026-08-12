import decomposeTemplate from "../../prompts/01_decompose.md?raw";
import rewriteTemplate from "../../prompts/02_rewrite.md?raw";
import verifyTemplate from "../../prompts/03_verify.md?raw";
import finalTemplate from "../../prompts/04_final.md?raw";
import oneShotTemplate from "../../prompts/00_one_shot.md?raw";
import type { DocumentFormat, PromptBundle, PromptSet } from "../domain/contracts";
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

export interface PromptDocumentContext {
  format: DocumentFormat;
  assets: readonly PromptAssetContext[];
  latexMainFile?: string | null;
}

const assetStageGuidance: Record<PromptStage, string> = {
  decompose: "For this stage, inventory every included visual asset, its caption or description, the claim it supports, its source location, and any placement uncertainty.",
  rewrite: "For this stage, place each required visual asset near the rewritten discussion it supports and preserve stable asset identifiers and figure references.",
  verify: "For this stage, verify every included asset is referenced correctly, captions remain faithful, and no unsupported visual claim was introduced.",
  final: "For this stage, repair missing or incorrect visual placement. Propose a clearly identified description only when the source supplied no caption or alt text.",
};

const oneShotAssetGuidance = "For the internal decomposition, inventory every included asset and its role. Preserve and place required assets in the rewrite, verify every reference and caption, then repair any supported fidelity issue before finalizing.";

function documentFidelityContext(context: PromptDocumentContext, stage: PromptStage | "oneShot"): string {
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
  return `## Visual Asset Workflow\n${guidance}\nAttach the packaged files manually when the selected model interface supports image input. Otherwise use this catalog and the reviewed OCR text.\n\n${artifact("VISUAL ASSET CATALOG", catalog, "markdown")}${latex}`;
}

function oneShotContext(
  settings: RewriteSettings,
  profile: ModelProfile,
  documentContext?: PromptDocumentContext,
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
  documentContext?: PromptDocumentContext,
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
  documentContext?: PromptDocumentContext,
): PromptSet {
  const delimiterStyle = profile.promptStrategy.delimiterStyle;
  const source = artifact("SOURCE DOCUMENT", sourceText, delimiterStyle);
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
  documentContext?: PromptDocumentContext,
): PromptBundle {
  const source = artifact("SOURCE DOCUMENT", sourceText, profile.promptStrategy.delimiterStyle);
  const context = oneShotContext(settings, profile, documentContext);
  const oneShot = profile.promptStrategy.layout === "source-first-task-last"
    ? `${source}\n\n${context}\n\n${oneShotTemplate}`
    : `${oneShotTemplate}\n${context}\n\n${source}`;

  return {
    oneShot,
    manual: renderPromptSet(sourceText, settings, profile, documentContext),
  };
}
