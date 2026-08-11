import decomposeTemplate from "../../prompts/01_decompose.md?raw";
import rewriteTemplate from "../../prompts/02_rewrite.md?raw";
import verifyTemplate from "../../prompts/03_verify.md?raw";
import finalTemplate from "../../prompts/04_final.md?raw";
import type { PromptSet } from "../domain/contracts";
import type { ModelProfile } from "../domain/profiles";
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

function artifact(name: string, contents: string): string {
  const separator = contents.endsWith("\n") ? "" : "\n";
  return `===== BEGIN ${name} =====\n${contents}${separator}===== END ${name} =====`;
}

function sharedContext(settings: RewriteSettings, profile: ModelProfile): string {
  const customRequirements = settings.customRequirements || "None.";
  return `## Model Workflow
Selected model: ${profile.label}
${profile.workflowNote}

## Rewrite Preferences
Tone: ${toneLabel(settings.tone)}
Formality: ${formalityLabel(settings.formality)}
Length: ${lengthLabel(settings.length)}
Output language: ${settings.outputLanguage}
Custom requirements: ${customRequirements}`;
}

function prompt(template: string, context: string, artifacts: string[]): string {
  return `${template}\n${context}\n\n${artifacts.join("\n\n")}`;
}

export function renderPromptSet(
  sourceText: string,
  settings: RewriteSettings,
  profile: ModelProfile,
): PromptSet {
  const context = sharedContext(settings, profile);
  const source = artifact("SOURCE DOCUMENT", sourceText);
  const decomposition = artifact("STAGE 1 DECOMPOSITION", responseMarkers.decompose);
  const rewrite = artifact("STAGE 2 REWRITE", responseMarkers.rewrite);
  const verification = artifact("STAGE 3 VERIFICATION", responseMarkers.verify);

  return {
    decompose: prompt(decomposeTemplate, context, [source]),
    rewrite: prompt(rewriteTemplate, context, [source, decomposition]),
    verify: prompt(verifyTemplate, context, [source, decomposition, rewrite]),
    final: prompt(finalTemplate, context, [source, decomposition, rewrite, verification]),
  };
}
