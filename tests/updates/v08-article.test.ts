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

describe("v0.8 Image portal Updates article", () => {
  it("publishes a visual article without changing the formal v0.7 release identity", async () => {
    // Turning this article into a release or making it current must not silently perform the separately gated version bump.
    expect(validateReleaseLedger(ledger)).toBe(ledger);
    const current = ledger.entries.filter((entry) => entry.kind === "release" && entry.status === "current");
    const article = ledger.entries.find((entry) => entry.slug === "v0-8-0");
    const packageMetadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ slug: "v0-7-0", version: "0.7.0" });
    expect(packageMetadata.version).toBe("0.7.0");
    expect(article).toMatchObject({
      kind: "article",
      slug: "v0-8-0",
      status: "published",
      date: "2026-08-14",
      markdownPath: "content/updates/v0-8-0.md",
      visualChanges: true,
      video: {
        policy: "required",
        mp4Path: "/reword-nerd/media/updates/v0-8-0/release-update.mp4",
        webmPath: "/reword-nerd/media/updates/v0-8-0/release-update.webm",
        posterPath: "/reword-nerd/media/updates/v0-8-0/poster.webp",
        transcriptPath: "/reword-nerd/media/updates/v0-8-0/transcript.txt",
      },
    });
    expect(article).not.toHaveProperty("version");
    expect(article).not.toHaveProperty("classification");
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
  });
});
