import type { PromptBundle } from "../src/domain/contracts";
import { responseMarkers } from "../src/prompting/renderPromptSet";

const stages = ["decompose", "rewrite", "verify", "final"] as const;

/** Detect ambiguous legacy packages before exact pre-fix reconstruction. */
export function hasHydrationMarkerCollision(bundle: PromptBundle): boolean {
  return stages.some((stage, index) =>
    Object.entries(responseMarkers).some(([prior, marker]) => {
      const expected = stages.indexOf(prior as (typeof stages)[number]) < index ? 1 : 0;
      return bundle.manual[stage].split(marker).length - 1 !== expected;
    }),
  );
}
