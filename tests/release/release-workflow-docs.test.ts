import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

describe("v0.7 release documentation contract", () => {
  it("publishes an explicit local authoring, review, video, and owner-controlled publication workflow", () => {
    // Without a dedicated workflow, contributors can mistake offline generators or a local build for publication authority.
    const workflowPath = join(root, "docs/release-workflow.md");
    expect(existsSync(workflowPath)).toBe(true);

    const workflow = read("docs/release-workflow.md");
    for (const command of [
      "npm ci",
      "npm run release:prepare",
      "npm run updates:check",
      "npm run updates:video",
      "npm run updates:video:check",
      "npm run lint",
      "npm run typecheck",
      "npm test -- --run",
      "VITE_BASE_PATH=/reword-nerd/ npm run build",
      "PLAYWRIGHT_BASE_PATH=/reword-nerd/ PLAYWRIGHT_USE_PREVIEW=1 npm run e2e",
    ]) expect(workflow).toContain(command);

    expect(workflow).toMatch(/does not.*(?:publish|push|commit|merge)/iu);
    expect(workflow).toMatch(/human.*review|review.*human/iu);
    expect(workflow).toMatch(/owner.*(?:push|pull request|publish|deploy)/iu);
    expect(workflow).toMatch(/ledger.*post.*feed.*sitemap/isu);
    expect(workflow).toMatch(/poster|representative.*frame/iu);
  });

  it("keeps public authored Updates and release media distinct from private session material throughout the contributor docs", () => {
    // Removing this distinction risks treating intentionally public site assets as uploaded documents, or vice versa.
    for (const path of [
      "README.md",
      "CONTRIBUTING.md",
      "docs/architecture.md",
      "docs/privacy.md",
      "docs/design-system.md",
      "docs/directory-structure.md",
      "content/updates/v0-7-0.md",
    ]) {
      const source = read(path);
      expect(source).toMatch(/public(?:ly)?\s+authored[\s\S]*(?:Updates|release media)|(?:Updates|release media)[\s\S]*public(?:ly)?\s+authored/iu);
      expect(source).toMatch(/distinct from[\s\S]*(?:uploaded|session)|(?:uploaded|session)[\s\S]*distinct from/iu);
    }
  });

  it("documents the complete v0.7 navigation and overlay privacy inventory", () => {
    // Stale counts or omitted overlays make the source allowlist and focus boundary impossible to audit from the docs.
    const privacy = read("docs/privacy.md");
    expect(privacy).toMatch(/exactly seven[\s\S]*external navigation destinations/iu);
    for (const destination of [
      "https://github.com/ryanjosephkamp/reword-nerd",
      "https://github.com/ryanjosephkamp/reword-nerd/issues/new?template=bug_report.yml",
      "https://github.com/ryanjosephkamp/reword-nerd/issues/new?template=feature_request.yml",
      "https://github.com/ryanjosephkamp/reword-nerd/security/advisories/new",
      "https://github.com/ryanjosephkamp/",
      "https://ryanjosephkamp.github.io",
      "https://github.com/sponsors/ryanjosephkamp",
    ]) expect(privacy).toContain(destination);

    const architecture = read("docs/architecture.md");
    expect(architecture).toContain("Share's manual-copy fallback");
    expect(architecture).toContain("mutually exclusive modal-overlay");
  });

  it("installs the FFmpeg inspection tools before both verification and deployment builds", () => {
    // Release-media validation is a required unit/build gate, so both clean Linux jobs must provide ffprobe explicitly.
    const workflow = read(".github/workflows/deploy-pages.yml");
    const [verifyJob, deployJob] = workflow.split("\n  deploy:");
    for (const job of [verifyJob, deployJob]) {
      expect(job).toContain("Install FFmpeg tools");
      expect(job).toContain("sudo apt-get install --no-install-recommends --yes ffmpeg");
      expect(job).toContain("ffprobe -version");
    }
  });
});
