// Word-level comparison between the source text and the rewrite, plus simple measures
// that help a person judge how much changed.

export interface DiffPart {
  value: string;
  kind: "same" | "added" | "removed";
}

export async function compareTexts(before: string, after: string): Promise<DiffPart[]> {
  const { diffWordsWithSpace } = await import("diff");
  return diffWordsWithSpace(before, after).map((change) => ({
    value: change.value,
    kind: change.added ? "added" : change.removed ? "removed" : "same",
  }));
}

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

export function wordCount(text: string): number {
  return text.match(WORD)?.length ?? 0;
}

/** Share of the rewrite's words that also appear, in order, in the source. Lower means more rewritten. */
export function overlapShare(parts: readonly DiffPart[]): number {
  let same = 0;
  let total = 0;
  for (const part of parts) {
    if (part.kind === "removed") continue;
    const words = wordCount(part.value);
    total += words;
    if (part.kind === "same") same += words;
  }
  return total === 0 ? 0 : same / total;
}
