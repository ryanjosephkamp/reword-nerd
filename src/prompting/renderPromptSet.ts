import decomposeTemplate from "../../prompts/01_decompose.md?raw";
import rewriteTemplate from "../../prompts/02_rewrite.md?raw";
import verifyTemplate from "../../prompts/03_verify.md?raw";
import finalTemplate from "../../prompts/04_final.md?raw";
import type { PromptSet } from "../domain/contracts";
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

function sharedContext(settings: RewriteSettings, profile: ModelProfile, stage: PromptStage): string {
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
${artifact("CUSTOM REQUIREMENTS", customRequirements, profile.promptStrategy.delimiterStyle)}`;
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
): PromptSet {
  const delimiterStyle = profile.promptStrategy.delimiterStyle;
  const source = artifact("SOURCE DOCUMENT", sourceText, delimiterStyle);
  const decomposition = artifact("STAGE 1 DECOMPOSITION", responseMarkers.decompose, delimiterStyle);
  const rewrite = artifact("STAGE 2 REWRITE", responseMarkers.rewrite, delimiterStyle);
  const verification = artifact("STAGE 3 VERIFICATION", responseMarkers.verify, delimiterStyle);

  return {
    decompose: promptForStage("decompose", sharedContext(settings, profile, "decompose"), [source], profile),
    rewrite: promptForStage("rewrite", sharedContext(settings, profile, "rewrite"), [source, decomposition], profile),
    verify: promptForStage("verify", sharedContext(settings, profile, "verify"), [source, decomposition, rewrite], profile),
    final: promptForStage("final", sharedContext(settings, profile, "final"), [source, decomposition, rewrite, verification], profile),
  };
}
