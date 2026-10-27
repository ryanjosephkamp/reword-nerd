import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  CompareView,
  StudioInsights,
} from "../../src/app/studio/StudioInsights";
import {
  analyzeText,
  countWords,
  createWordDiff,
  formatReadingTime,
  MAX_ANALYSIS_CHARACTERS,
  MAX_COMPARISON_PREVIEW_CHARACTERS,
} from "../../src/app/studio/textInsights";

describe("studio text insights", () => {
  it("counts Unicode words, contractions and hyphenated terms without counting punctuation", () => {
    expect(
      countWords("We're re-wording café naïve 123 — hello, world! 👋"),
    ).toBe(7);
    expect(countWords("  \n !? — 👋 ")).toBe(0);
    expect(countWords("cafe\u0301 東京")).toBe(2);
  });

  it("handles empty drafts without invalid averages or a misleading readability score", () => {
    const result = analyzeText(" \n\t");
    expect(result).toMatchObject({
      wordCount: 0,
      sentenceCount: 0,
      paragraphCount: 0,
      averageSentenceWords: 0,
      readingSeconds: 0,
      readingEase: null,
    });
    expect(result.observations[0].title).toBe("Start with your words");
    expect(formatReadingTime(result.readingSeconds)).toBe("—");
  });

  it("measures the actual sentences and paragraphs", () => {
    const result = analyzeText(
      "A clear start. Keep it simple!\n\nDoes this work? Yes.",
    );
    expect(result).toMatchObject({
      wordCount: 10,
      sentenceCount: 4,
      paragraphCount: 2,
      averageSentenceWords: 2.5,
      readingSeconds: 3,
      distribution: { short: 4, medium: 0, long: 0 },
    });
    expect(result.sentenceLengths).toEqual([3, 3, 3, 1]);
  });

  it("withholds English readability for tiny or predominantly non-Latin samples", () => {
    expect(analyzeText("A very short draft.").readingEase).toBeNull();
    const result = analyzeText("これは 文書 です。 ".repeat(20));
    expect(result.readingEase).toBeNull();
    expect(result.readabilityLabel).toBe("English estimate unavailable");
  });

  it("returns a bounded readability estimate and actionable measured long-sentence observation", () => {
    const result = analyzeText(
      `${"word ".repeat(28)}ends. Here is a short sentence.`,
    );
    expect(result.readingEase).toBeTypeOf("number");
    expect(result.readingEase).toBeGreaterThanOrEqual(0);
    expect(result.readingEase).toBeLessThanOrEqual(100);
    expect(result.distribution).toEqual({ short: 1, medium: 0, long: 1 });
    expect(
      result.observations.find(
        (item) => item.title === "One sentence to revisit",
      )?.description,
    ).toContain("29 words");
    expect(result.observations.length).toBeLessThanOrEqual(3);
  });

  it("labels bounded sampling and does not count beyond the analyzed sample", () => {
    const result = analyzeText("a ".repeat(MAX_ANALYSIS_CHARACTERS / 2 + 20));
    expect(result.sampled).toBe(true);
    expect(result.analyzedCharacters).toBe(MAX_ANALYSIS_CHARACTERS);
    expect(result.wordCount).toBe(MAX_ANALYSIS_CHARACTERS / 2);
  });

  it("formats approximate reading time", () => {
    expect([0, 1, 59, 60, 61, 120].map(formatReadingTime)).toEqual([
      "—",
      "< 1 min",
      "< 1 min",
      "1 min",
      "2 min",
      "2 min",
    ]);
  });
});

describe("studio insights and comparison interface", () => {
  it("switches comparison layouts while preserving source text and rendering markup as plain text", () => {
    const originalText = "A <script>alert('hello')</script> draft.";
    const text = "A safer <strong>draft</strong>.";
    const view = render(createElement(CompareView, { originalText, text }));
    expect(screen.getByRole("button", { name: "Inline" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(view.container.querySelector("script")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Side by side" }));
    expect(screen.getByLabelText("Original text").textContent).toBe(
      originalText,
    );
    expect(screen.getByLabelText("Edited text").textContent).toBe(text);
    expect(
      screen.getByRole("button", { name: "Side by side" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      view.container.querySelector(".studio-compare-document strong"),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Inline" }));
    expect(screen.getByLabelText("Inline text comparison")).toBeInTheDocument();
    view.unmount();
  });

  it("updates text metrics when the edited draft changes", () => {
    const view = render(
      createElement(StudioInsights, {
        originalText: "First draft.",
        text: "First draft.",
      }),
    );
    expect(screen.queryByText("2 sentences total")).not.toBeInTheDocument();
    view.rerender(
      createElement(StudioInsights, {
        originalText: "First draft.",
        text: "First draft. Another idea.",
      }),
    );
    expect(screen.getByText("2 sentences total")).toBeInTheDocument();
    expect(screen.getByText("+2 from original")).toBeInTheDocument();
    expect(screen.getByText("How these numbers work")).toBeInTheDocument();
    view.unmount();
  });

  it("bounds large comparison rendering and clearly labels preview-only changes", () => {
    const sharedText = "a ".repeat(MAX_COMPARISON_PREVIEW_CHARACTERS / 2);
    const originalText = sharedText + "original ending";
    const text = sharedText + "edited ending";
    const view = render(createElement(CompareView, { originalText, text }));
    expect(
      screen.getByText(/changes beyond this preview are not shown/),
    ).toBeInTheDocument();
    expect(screen.getByText("0 words added (preview)")).toBeInTheDocument();
    expect(screen.getByLabelText("Inline text comparison").textContent).toBe(
      sharedText,
    );
    view.unmount();
  });

  it("names source and result panes for a completed rewrite comparison", () => {
    const view = render(
      createElement(CompareView, {
        originalText: "Initial words.",
        text: "Refined words.",
        originalLabel: "Source",
        resultLabel: "Your result",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Side by side" }));
    expect(screen.getByLabelText("Source text").textContent).toBe(
      "Initial words.",
    );
    expect(screen.getByLabelText("Your result text").textContent).toBe(
      "Refined words.",
    );
    expect(screen.getByText("Your result")).toBeInTheDocument();
    view.unmount();
  });
});

describe("studio word comparison", () => {
  const reconstruct = (
    chunks: ReturnType<typeof createWordDiff>["chunks"],
    original: boolean,
  ) =>
    chunks
      .filter((chunk) => chunk.kind !== (original ? "insert" : "delete"))
      .map((chunk) => chunk.text)
      .join("");

  it.each([
    ["", ""],
    ["", "New text."],
    ["Old text.", ""],
    ["A clear draft.", "A clear draft."],
    ["A long draft.", "A short draft."],
    ["a\r\nb\t c  ", "a\nb c "],
    ["café 🙂 & <script>", "cafe 🙃 & <strong>"],
    ["red red blue red", "red blue red red"],
    ["!", "!!"],
    ["hello", "hello there"],
    ["a \u0000 b", "a \u0000\n b"],
  ])(
    "preserves exact original and edited content: %j → %j",
    (original, edited) => {
      const result = createWordDiff(original, edited);
      expect(reconstruct(result.chunks, true)).toBe(original);
      expect(reconstruct(result.chunks, false)).toBe(edited);
    },
  );

  it("identifies a word replacement without marking its shared surroundings as changed", () => {
    const result = createWordDiff("A long draft.", "A short draft.");
    expect(result.chunks).toEqual([
      { kind: "equal", text: "A " },
      { kind: "delete", text: "long" },
      { kind: "insert", text: "short" },
      { kind: "equal", text: " draft." },
    ]);
    expect(result).toMatchObject({
      insertedWords: 1,
      deletedWords: 1,
      coarse: false,
    });
  });

  it("reports whitespace-only changes with zero changed words", () => {
    const result = createWordDiff("One  sentence.\r\n", "One sentence.\n");
    expect(result).toMatchObject({
      insertedWords: 0,
      deletedWords: 0,
      coarse: false,
    });
    expect(result.chunks.some((chunk) => chunk.kind === "delete")).toBe(true);
  });

  it("falls back to complete change blocks before quadratic comparison becomes expensive", () => {
    const original = `Intro. ${"alpha ".repeat(1000)}End.`;
    const edited = `Intro. ${"beta ".repeat(1000)}End.`;
    const result = createWordDiff(original, edited);
    expect(result.coarse).toBe(true);
    expect(reconstruct(result.chunks, true)).toBe(original);
    expect(reconstruct(result.chunks, false)).toBe(edited);
    expect(result.chunks[0]).toEqual({ kind: "equal", text: "Intro. " });
    expect(result.chunks.at(-1)?.kind).toBe("equal");
  });

  it("avoids tokenizing very large documents and still preserves every character", () => {
    const original = "original ".repeat(30_000);
    const edited = "edited ".repeat(30_000);
    const result = createWordDiff(original, edited);
    expect(result.coarse).toBe(true);
    expect(result.chunks).toHaveLength(2);
    expect(reconstruct(result.chunks, true)).toBe(original);
    expect(reconstruct(result.chunks, false)).toBe(edited);
  });
});
