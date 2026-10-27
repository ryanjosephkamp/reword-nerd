import type { PromptBinding, PromptBundle, PromptSet } from "../domain/contracts";

export { hydrateBoundPrompt } from "./hydrationRuntime.js";

/** Compatibility for pre-binding in-memory callers; ambiguous legacy prompts fail closed. */
export function promptBindings(bundle: PromptBundle, stage: keyof PromptSet): readonly PromptBinding[] {
  if (bundle.manualBindings) return bundle.manualBindings[stage];
  const prior = ["decompose", "rewrite", "verify"] as const;
  const markers = ["<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>", "<<<INSERT_STAGE_2_REWRITE_RESPONSE>>>", "<<<INSERT_STAGE_3_VERIFICATION_RESPONSE>>>"];
  const count = ["decompose", "rewrite", "verify", "final"].indexOf(stage);
  const text = bundle.manual[stage];
  return prior.flatMap((key, index) => {
    const marker = markers[index];
    const occurrences = text.split(marker).length - 1;
    if (occurrences > 1 || (index >= count && occurrences > 0)) throw new Error("Ambiguous legacy hydration markers; rebuild from reviewed source.");
    const start = text.indexOf(marker);
    return index < count && occurrences === 1 ? [{ stage: key, start, end: start + marker.length }] : [];
  }).sort((a, b) => a.start - b.start);
}
