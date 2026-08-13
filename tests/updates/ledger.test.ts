import { describe, expect, it } from "vitest";
import { validateReleaseLedger } from "../../scripts/updates/lib.mjs";

const validLedger = {
  schemaVersion: 1,
  site: {
    title: "reword-nerd Updates",
    description: "A builder's journal for reword-nerd.",
    canonicalOrigin: "https://ryanjosephkamp.github.io",
    basePath: "/reword-nerd/updates/",
  },
  entries: [
    {
      kind: "release",
      slug: "v0-7-0",
      title: "reword-nerd v0.7",
      summary: "A static Updates journal.",
      status: "current",
      date: "2026-08-13",
      author: "Ryan Joseph Kamp",
      tags: ["release", "updates"],
      relatedPrs: [],
      markdownPath: "content/updates/v0-7-0.md",
      version: "0.7.0",
      classification: "feature",
      visualChanges: true,
      video: {
        policy: "exempt",
        exemptionReason: "The static journal is fully represented in text and screenshots.",
      },
    },
  ],
} as const;

describe("ReleaseLedgerV1 validation", () => {
  it("accepts a safe current feature release", () => {
    // Removing validation of the complete public entry contract must make this fail.
    expect(validateReleaseLedger(validLedger)).toEqual(validLedger);
  });

  it.each([
    ["remote media", { video: { policy: "required", mp4Path: "https://cdn.example/video.mp4", posterPath: "/media/poster.webp", transcriptPath: "/media/transcript.txt" } }],
    ["path traversal", { markdownPath: "content/updates/../private.md" }],
    ["unsafe author markup", { author: "<script>alert(1)</script>" }],
  ])("rejects %s", (_label, replacement) => {
    // Removing safe-path or safe-text enforcement must make this fail.
    const entry = { ...validLedger.entries[0], ...replacement };
    expect(() => validateReleaseLedger({ ...validLedger, entries: [entry] })).toThrow(/unsafe|same-origin|path/i);
  });

  it("rejects a visual release with neither complete local video nor an exemption", () => {
    // Removing the visual-change video policy gate must make this fail.
    const entry = { ...validLedger.entries[0], video: { policy: "required" } };
    expect(() => validateReleaseLedger({ ...validLedger, entries: [entry] })).toThrow(/video/i);
  });

  it.each([
    ["a non-leap February 29", "2026-02-29"],
    ["a normalized February 31", "2026-02-31"],
    ["an April 31", "2026-04-31"],
    ["month zero", "2026-00-01"],
    ["day zero", "2026-01-00"],
  ])("rejects %s", (_label, date) => {
    // Replacing strict calendar validation with Date.parse normalization must make this accept an impossible date.
    const entry = { ...validLedger.entries[0], date };
    expect(() => validateReleaseLedger({ ...validLedger, entries: [entry] })).toThrow(/date/i);
  });

  it("accepts a real leap day", () => {
    // Rejecting all February 29 values must make this valid Gregorian calendar date fail.
    const entry = { ...validLedger.entries[0], date: "2024-02-29" };
    expect(validateReleaseLedger({ ...validLedger, entries: [entry] })).toMatchObject({ entries: [{ date: "2024-02-29" }] });
  });
});
