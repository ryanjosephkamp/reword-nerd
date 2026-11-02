// Line-by-line comparison in the style of a code review: removed lines, added lines, and the
// words that changed inside a line that was edited rather than replaced.

export type RowKind = "same" | "add" | "del";

export interface DiffSegment {
  text: string;
  changed: boolean;
}

export interface DiffRow {
  kind: RowKind;
  oldLine: number | null;
  newLine: number | null;
  segments: DiffSegment[];
}

export interface LineDiff {
  rows: DiffRow[];
  added: number;
  removed: number;
}

function lines(text: string): string[] {
  const parts = text.split("\n");
  if (parts.at(-1) === "") parts.pop();
  return parts;
}

function normalize(text: string): string {
  const unified = text.replace(/\r\n?/g, "\n");
  return unified.endsWith("\n") || unified === "" ? unified : `${unified}\n`;
}

type WordDiff = typeof import("diff").diffWordsWithSpace;

/** Joins neighboring pieces with the same mark, so one change reads as one highlight. */
function merge(segments: DiffSegment[]): DiffSegment[] {
  // A lone space between two changes belongs to the change.
  const marked = segments.map((segment, index) =>
    !segment.changed &&
    segment.text.trim() === "" &&
    segments[index - 1]?.changed &&
    segments[index + 1]?.changed
      ? { ...segment, changed: true }
      : segment,
  );
  const out: DiffSegment[] = [];
  for (const segment of marked) {
    const last = out.at(-1);
    if (last && last.changed === segment.changed) last.text += segment.text;
    else out.push({ ...segment });
  }
  return out;
}

/** Marks the changed words in a pair of edited lines, or nothing when they barely overlap. */
function highlight(diffWords: WordDiff, before: string, after: string) {
  const parts = diffWords(before, after);
  const same = parts
    .filter((part) => !part.added && !part.removed)
    .reduce((sum, part) => sum + part.value.trim().length, 0);
  const longest = Math.max(before.trim().length, after.trim().length, 1);
  if (same / longest < 0.3) return null;
  return {
    before: merge(
      parts
        .filter((part) => !part.added)
        .map((part) => ({ text: part.value, changed: Boolean(part.removed) })),
    ),
    after: merge(
      parts
        .filter((part) => !part.removed)
        .map((part) => ({ text: part.value, changed: Boolean(part.added) })),
    ),
  };
}

export async function lineDiff(before: string, after: string): Promise<LineDiff> {
  const { diffLines, diffWordsWithSpace } = await import("diff");
  const rows: DiffRow[] = [];
  let oldLine = 1;
  let newLine = 1;
  let added = 0;
  let removed = 0;
  for (const change of diffLines(normalize(before), normalize(after))) {
    for (const text of lines(change.value)) {
      if (change.added) {
        rows.push({ kind: "add", oldLine: null, newLine: newLine++, segments: [] });
        added += 1;
      } else if (change.removed) {
        rows.push({ kind: "del", oldLine: oldLine++, newLine: null, segments: [] });
        removed += 1;
      } else {
        rows.push({ kind: "same", oldLine: oldLine++, newLine: newLine++, segments: [] });
      }
      rows.at(-1)!.segments = [{ text, changed: false }];
    }
  }

  // Pair the removed and added lines of each change, in order, and mark the words that changed.
  for (let start = 0; start < rows.length;) {
    if (rows[start].kind !== "del") {
      start += 1;
      continue;
    }
    let end = start;
    while (end < rows.length && rows[end].kind === "del") end += 1;
    let addEnd = end;
    while (addEnd < rows.length && rows[addEnd].kind === "add") addEnd += 1;
    const pairs = Math.min(end - start, addEnd - end);
    for (let offset = 0; offset < pairs; offset += 1) {
      const removedRow = rows[start + offset];
      const addedRow = rows[end + offset];
      const marked = highlight(
        diffWordsWithSpace,
        removedRow.segments[0].text,
        addedRow.segments[0].text,
      );
      if (marked) {
        removedRow.segments = marked.before;
        addedRow.segments = marked.after;
      }
    }
    start = addEnd;
  }
  return { rows, added, removed };
}

/** Indices of rows to show: every change plus `context` unchanged lines around it. */
export function visibleRows(rows: readonly DiffRow[], context = 3): boolean[] {
  const show = rows.map(() => false);
  rows.forEach((row, index) => {
    if (row.kind === "same") return;
    for (
      let near = Math.max(0, index - context);
      near <= Math.min(rows.length - 1, index + context);
      near += 1
    ) {
      show[near] = true;
    }
  });
  return show;
}
