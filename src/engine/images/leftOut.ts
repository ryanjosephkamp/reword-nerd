// Counts what was left out of a PDF or Word file, so one short note can replace a long list.
import type { ImageProblem } from "./errors";
import { IMAGE_LIMITS } from "./limits";

export const WHY = {
  tooSmall: `too small to use, under ${IMAGE_LIMITS.minPdfPictureSide} pixels on a side`,
  unreadable: "couldn't be read",
  tooLarge: "too large to use",
  unsupported: "format not supported",
  notDrawn: "couldn't be drawn",
} as const;

export function whyForProblem(problem: ImageProblem): string {
  if (problem === "unsupported") return WHY.unsupported;
  if (problem === "too-large") return WHY.tooLarge;
  return WHY.unreadable;
}

interface Group {
  noun: string;
  why: string;
  count: number;
  details: Set<string>;
}

export class LeftOut {
  readonly #groups = new Map<string, Group>();

  /** Records one left-out item; `detail` (such as a format name) is listed once per kind. */
  add(noun: "picture" | "page capture", why: string, detail?: string): void {
    const key = `${noun}|${why}`;
    const group = this.#groups.get(key) ?? { noun, why, count: 0, details: new Set<string>() };
    group.count += 1;
    if (detail) group.details.add(detail);
    this.#groups.set(key, group);
  }

  get count(): number {
    let total = 0;
    for (const group of this.#groups.values()) total += group.count;
    return total;
  }

  /** Phrases such as "left out 3 pictures (couldn't be read)". */
  phrases(): string[] {
    return [...this.#groups.values()].map(({ noun, why, count, details }) => {
      const what = `${count} ${noun}${count === 1 ? "" : "s"}`;
      const detail = details.size > 0 ? `: ${[...details].sort().join(", ")}` : "";
      return `left out ${what} (${why}${detail})`;
    });
  }
}
