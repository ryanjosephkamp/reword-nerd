import { describe, expect, it } from "vitest";
import { compareTexts, overlapShare, wordCount } from "../../../src/engine/results/compare";
import { exportRewrite, markdownToDocx } from "../../../src/engine/results/export";
import { readZip } from "../../../src/engine/handoff/zip";

describe("compare", () => {
  it("marks added and removed words and measures overlap", async () => {
    const parts = await compareTexts("The garden is small.", "The garden is tiny.");
    expect(parts.some((part) => part.kind === "removed" && part.value.includes("small"))).toBe(
      true,
    );
    expect(parts.some((part) => part.kind === "added" && part.value.includes("tiny"))).toBe(true);
    expect(overlapShare(parts)).toBeCloseTo(0.75);
    expect(wordCount("  one two\nthree ")).toBe(3);
  });
});

describe("export", () => {
  it("keeps text formats and their names", async () => {
    const file = await exportRewrite("notes/plan.md", "markdown", "# Plan");
    expect(file.name).toBe("plan.md");
    expect(await file.blob.text()).toBe("# Plan");
  });

  it("writes Word files for Word and PDF sources", async () => {
    const file = await exportRewrite(
      "paper.pdf",
      "pdf",
      "# Title\n\nSome **bold** text.\n\n- one\n- two\n\n| A | B |\n| - | - |\n| 1 | 2 |",
    );
    expect(file.name).toBe("paper.docx");
    const parts = await readZip(file.blob);
    const body = await parts.find((part) => part.path === "word/document.xml")!.data.text();
    expect(body).toContain("Title");
    expect(body).toContain("bold");
    expect(body).toContain("<w:tbl>");
  });

  it("handles nested lists and links", async () => {
    const blob = await markdownToDocx(
      "1. First\n   - inner [site](https://example.com)\n2. Second",
    );
    const parts = await readZip(blob);
    const body = await parts.find((part) => part.path === "word/document.xml")!.data.text();
    expect(body).toContain("inner");
    expect(body).toContain("Second");
  });
});
