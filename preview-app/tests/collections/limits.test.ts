import { describe, expect, it } from "vitest";
import { COLLECTION_LIMITS as L, boundedCount, boundedText, uniquePaths } from "../../src/collections/limits";
describe("collection transport boundaries", () => {
  for (const [name, maximum] of Object.entries(L)) it(`${name}: exact and over limit`, () => {
    expect(() => boundedCount(maximum, maximum, name)).not.toThrow();
    expect(() => boundedCount(maximum + 1, maximum, name)).toThrow();
    expect(() => boundedCount(-1, maximum, name)).toThrow();
  });
  it("counts UTF-8 bytes without normalization or truncation", () => {
    expect(() => boundedText("雪\r\n", 5, "literal")).not.toThrow();
    expect(() => boundedText("雪\r\n", 4, "literal")).toThrow();
    expect(() => boundedText("\ud800", 100, "literal")).toThrow();
  });
  it("permits distinct folders and duplicate bytes without aliasing identities", () => {
    expect(() => uniquePaths(["a/readme.md", "雪/readme.md"])).not.toThrow();
  });
  for (const paths of [["a.md", "A.md"], ["é.md", "e\u0301.md"], ["a.md", "ａ.md"], ["straße.md", "STRASSE.md"], ["σ.txt","ς.txt"], ["a", "a/file.txt"], ["../x"], ["a//x"], ["C:x"], ["a%2fx"], ["/x"], ["a\\x"], ["con.txt"], ["a./x"]]) {
    it(`rejects unsafe identity ${JSON.stringify(paths)}`, () => expect(() => uniquePaths(paths)).toThrow());
  }
});
