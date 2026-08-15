import {
  imagePairKey,
  imagePairPaths,
  isSafeImageArchivePath,
  stableImageArchiveCompare,
} from "../../src/image/export";

describe("Image export paths", () => {
  it("derives portable ordinal pair keys without preserving source extensions", () => {
    // Catches unsafe source names entering ZIP paths or duplicate names collapsing together.
    expect(imagePairKey(1, " Café FINAL.PNG ")).toBe("001-cafe-final");
    expect(imagePairKey(2, "../🖼️.png")).toBe("002-image");
    expect(imagePairKey(100, `${"Very long name ".repeat(8)}.jpeg`)).toMatch(/^100-[a-z0-9-]{1,48}$/u);
    expect(() => imagePairKey(0, "x.png")).toThrow("IMAGE_PAIR_ORDINAL_INVALID");
    expect(() => imagePairKey(101, "x.png")).toThrow("IMAGE_PAIR_ORDINAL_INVALID");
  });

  it("materializes the exact five-file pair tree", () => {
    // Catches source artifacts escaping their pair directory or acquiring extra entries.
    expect(imagePairPaths("001-example", "png")).toEqual({
      source: "pairs/001-example/source.png",
      prompt: "pairs/001-example/prompt.txt",
      runCard: "pairs/001-example/run-card.md",
      metadata: "pairs/001-example/metadata.json",
      openMe: "pairs/001-example/OPEN-ME.html",
    });
  });

  it.each([
    "",
    "/absolute",
    "C:/drive",
    "pairs\\bad",
    "pairs//bad",
    "pairs/./bad",
    "pairs/../bad",
    "pairs/control\u0000",
    "pairs/decomposed-e\u0301",
  ])("rejects unsafe archive path %j", (path) => {
    // Catches traversal, platform-specific, control, and non-NFC ZIP names.
    expect(isSafeImageArchivePath(path)).toBe(false);
  });

  it("accepts NFC relative paths and compares paths by stable code-unit order", () => {
    // Catches locale-dependent ZIP entry ordering.
    expect(isSafeImageArchivePath("pairs/001-café/source.png")).toBe(true);
    expect(["b", "A", "a"].sort(stableImageArchiveCompare)).toEqual(["A", "a", "b"]);
  });
});
