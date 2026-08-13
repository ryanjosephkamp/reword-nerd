import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createUpdate, prepareRelease } from "../../scripts/updates/lib.mjs";

const execFile = promisify(execFileCallback);
const roots: string[] = [];

async function releaseRoot({ git = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "reword-nerd-release-"));
  roots.push(root);
  await mkdir(join(root, "content/updates"), { recursive: true });
  await mkdir(join(root, "src/export"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({ name: "reword-nerd", version: "0.6.0" }, null, 2)}\n`);
  await writeFile(join(root, "package-lock.json"), `${JSON.stringify({ name: "reword-nerd", version: "0.6.0", packages: { "": { version: "0.6.0" } } }, null, 2)}\n`);
  await writeFile(join(root, "src/version.ts"), 'asserts version is "0.6.0" { if (version !== "0.6.0") throw new Error(); }\n');
  await writeFile(join(root, "src/export/contracts.ts"), 'version: "0.6.0"; schemaVersion: 6; schemaVersion: 1;\n');
  const ledger = {
    schemaVersion: 1,
    site: { title: "reword-nerd Updates", description: "A builder's journal for reword-nerd.", canonicalOrigin: "https://ryanjosephkamp.github.io", basePath: "/reword-nerd/updates/" },
    entries: [{ kind: "release", slug: "v0-6-0", title: "reword-nerd v0.6", summary: "Project workspaces.", status: "current", date: "2026-08-13", author: "Ryan Joseph Kamp", tags: ["release"], relatedPrs: [7], markdownPath: "content/updates/v0-6-0.md", version: "0.6.0", classification: "feature", visualChanges: false, video: { policy: "exempt", exemptionReason: "This synthetic fixture predates release media." } }],
  };
  await writeFile(join(root, "content/updates/releases.json"), `${JSON.stringify(ledger, null, 2)}\n`);
  await writeFile(join(root, "content/updates/v0-6-0.md"), "existing reviewed prose\n");
  if (git) {
    await execFile("git", ["init"], { cwd: root });
    await execFile("git", ["config", "user.email", "test@example.com"], { cwd: root });
    await execFile("git", ["config", "user.name", "Test Author"], { cwd: root });
    await execFile("git", ["add", "."], { cwd: root });
    await execFile("git", ["commit", "-m", "Release v0.6.0 (#7)"], { cwd: root });
  }
  return root;
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("Updates authoring commands", () => {
  it("creates an idempotent safe article scaffold", async () => {
    // Removing duplicate protection must make the second call alter the ledger or prose.
    const root = await releaseRoot();
    expect(await createUpdate(root, { slug: "road-to-v0-6", title: "Road to v0.6", date: "2026-08-13" })).toBe("created");
    const before = await readFile(join(root, "content/updates/road-to-v0-6.md"), "utf8");
    expect(await createUpdate(root, { slug: "road-to-v0-6", title: "Road to v0.6", date: "2026-08-13" })).toBe("unchanged");
    expect(await readFile(join(root, "content/updates/road-to-v0-6.md"), "utf8")).toBe(before);
    expect(before).toContain("## Feedback and contribution links");
  });

  it("prepares a feature release from local Git history and preserves edited prose on rerun", async () => {
    // Removing version synchronization, Git inventory, or idempotent prose custody must make this fail.
    const root = await releaseRoot();
    expect(await prepareRelease(root, { version: "0.7.0", title: "reword-nerd v0.7", date: "2026-08-13" })).toBe("created");
    expect(JSON.parse(await readFile(join(root, "package.json"), "utf8")).version).toBe("0.7.0");
    expect(await readFile(join(root, "src/export/contracts.ts"), "utf8")).toContain('version: "0.7.0"');
    const inventory = JSON.parse(await readFile(join(root, "content/updates/release-review-v0.7.0.json"), "utf8"));
    expect(inventory).toMatchObject({ schemaVersion: 1, version: "0.7.0", classification: "feature" });
    expect(inventory.commits[0].subject).toBe("Release v0.6.0 (#7)");
    const ledger = JSON.parse(await readFile(join(root, "content/updates/releases.json"), "utf8"));
    expect(ledger.entries.at(-1)).toMatchObject({
      kind: "release",
      version: "0.7.0",
      visualChanges: false,
      video: { policy: "exempt", exemptionReason: expect.stringMatching(/initial scaffold.*no visual/i) },
    });

    const postPath = join(root, "content/updates/v0-7-0.md");
    await writeFile(postPath, `${await readFile(postPath, "utf8")}\nHuman-reviewed sentence.\n`);
    expect(await prepareRelease(root, { version: "0.7.0", title: "reword-nerd v0.7", date: "2026-08-13" })).toBe("unchanged");
    expect(await readFile(postPath, "utf8")).toContain("Human-reviewed sentence.");
  });

  it("fails clearly when required Git history is unavailable", async () => {
    // Removing the local-history precondition must make release preparation proceed without an auditable inventory.
    const root = await releaseRoot({ git: false });
    await expect(prepareRelease(root, { version: "0.7.0", title: "reword-nerd v0.7", date: "2026-08-13" })).rejects.toThrow(/Git history.*required/i);
  });

  it("rejects impossible calendar dates before authoring files", async () => {
    // Replacing command date validation with Date.parse normalization must make either command continue with February 31.
    const root = await releaseRoot();
    await expect(createUpdate(root, { slug: "calendar-check", title: "Calendar check", date: "2026-02-31" })).rejects.toThrow(/Invalid date/i);
    await expect(prepareRelease(root, { version: "0.7.0", title: "reword-nerd v0.7", date: "2026-02-31" })).rejects.toThrow(/Invalid date/i);
  });
});
