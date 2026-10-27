import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ledger from "../../content/updates/releases.json";
import { validateReleaseLedger } from "../../scripts/updates/lib.mjs";

const root = process.cwd();

function section(markdown: string, heading: "Added" | "Changed" | "Fixed") {
  const match = new RegExp(`\\n## ${heading}\\n([\\s\\S]*?)(?=\\n## )`, "u").exec(markdown);
  if (!match) throw new Error(`Missing ${heading} section`);
  return match[1];
}

describe("v0.8 Image portal release", () => {
  it("promotes the approved visual article into the sole formal current v0.8 release", async () => {
    // Leaving any version surface or the prior current release behind must make the final release gate fail.
    expect(validateReleaseLedger(ledger)).toBe(ledger);
    const current = ledger.entries.filter((entry) => entry.kind === "release" && entry.status === "current");
    const previous = ledger.entries.find((entry) => entry.slug === "v0-7-0");
    const release = ledger.entries.find((entry) => entry.slug === "v0-8-0");
    const packageMetadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    const lockMetadata = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
    const reviewInventory = JSON.parse(await readFile(join(root, "content/updates/release-review-v0.8.0.json"), "utf8"));

    expect(current).toHaveLength(1);
    expect(previous).toMatchObject({ kind: "release", slug: "v0-7-0", version: "0.7.0", status: "published" });
    expect(current[0]).toMatchObject({ slug: "v0-8-0", version: "0.8.0" });
    expect(packageMetadata.version).toBe("0.8.0");
    expect(lockMetadata.version).toBe("0.8.0");
    expect(lockMetadata.packages[""].version).toBe("0.8.0");
    expect(release).toMatchObject({
      kind: "release",
      slug: "v0-8-0",
      status: "current",
      date: "2026-08-14",
      markdownPath: "content/updates/v0-8-0.md",
      version: "0.8.0",
      classification: "feature",
      visualChanges: true,
      video: {
        policy: "required",
        mp4Path: "/reword-nerd/media/updates/v0-8-0/release-update.mp4",
        webmPath: "/reword-nerd/media/updates/v0-8-0/release-update.webm",
        posterPath: "/reword-nerd/media/updates/v0-8-0/poster.webp",
        transcriptPath: "/reword-nerd/media/updates/v0-8-0/transcript.txt",
      },
    });
    expect(reviewInventory).toMatchObject({
      schemaVersion: 1,
      version: "0.8.0",
      previousVersion: "0.7.0",
      classification: "feature",
      generatedFrom: "local-git-history",
    });
    expect(reviewInventory.commits.length).toBeGreaterThan(0);
  });

  it("uses neutral action-led prose and records the complete approved v0.8 scope", async () => {
    // Dropping a requested release-note topic or returning to first-person changelog prose must make this fail.
    const markdown = await readFile(join(root, "content/updates/v0-8-0.md"), "utf8");
    const proseWithoutLinks = markdown.replace(/\]\([^)]+\)/gu, "]");
    expect(proseWithoutLinks).not.toMatch(/\b(?:i|me|my|mine|myself)\b/iu);

    for (const heading of ["Added", "Changed", "Fixed"] as const) {
      const bullets = section(markdown, heading).match(/^- .+$/gmu) ?? [];
      expect(bullets.length).toBeGreaterThan(0);
      expect(bullets.every((bullet) => bullet.startsWith(`- ${heading}`))).toBe(true);
    }

    for (const topic of [
      "Image portal",
      "safe local intake",
      "per-image settings",
      "local OCR review",
      "deterministic packages",
      "Night Terminal HTML exports",
      "Continuous PDF view",
      "Gallery",
      "accessible visual refinements",
      "selectable-text containment",
      "timestamped ZIP downloads",
    ]) expect(markdown).toContain(topic);

    expect(markdown).not.toMatch(/separately authorized release gate|complete the formal version change/iu);
    expect(markdown).toMatch(/future marketing media and external writing[\s\S]{0,120}independent later work/iu);
  });
});
