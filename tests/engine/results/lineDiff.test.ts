import { describe, expect, it } from "vitest";
import { lineDiff, visibleRows } from "../../../src/engine/results/lineDiff";

describe("lineDiff", () => {
  it("numbers lines and marks the words that changed", async () => {
    const diff = await lineDiff(
      "one\nthe quick brown fox\nthree\n",
      "one\nthe quick red fox\nthree\n",
    );
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.rows.map((row) => row.kind)).toEqual(["same", "del", "add", "same"]);
    const [removed, added] = diff.rows.slice(1, 3);
    expect(removed.oldLine).toBe(2);
    expect(added.newLine).toBe(2);
    expect(removed.segments.filter((part) => part.changed).map((part) => part.text)).toEqual([
      "brown",
    ]);
    expect(added.segments.filter((part) => part.changed).map((part) => part.text)).toEqual(["red"]);
  });

  it("doesn't mark words in lines that were replaced outright", async () => {
    const diff = await lineDiff("alpha beta gamma\n", "completely different words here\n");
    expect(diff.rows.every((row) => row.segments.every((part) => !part.changed))).toBe(true);
  });

  it("treats a missing final newline and Windows line endings as no change", async () => {
    const diff = await lineDiff("a\r\nb", "a\nb\n");
    expect(diff.added + diff.removed).toBe(0);
  });

  it("shows three lines of context around each change", async () => {
    const before = Array.from({ length: 20 }, (_unused, index) => `line ${index}`).join("\n");
    const after = before.replace("line 10", "line ten");
    const diff = await lineDiff(before, after);
    const shown = visibleRows(diff.rows);
    expect(shown.filter(Boolean)).toHaveLength(8);
    expect(shown[6]).toBe(false);
    expect(shown[7]).toBe(true);
  });
});
