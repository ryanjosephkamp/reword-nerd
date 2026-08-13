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
});
