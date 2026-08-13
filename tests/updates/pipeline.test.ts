import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkUpdates, renderUpdates, validateRenderedPageScripts } from "../../scripts/updates/lib.mjs";

const roots: string[] = [];

async function fixtureRoot(overrides: { version?: string; markdown?: string; status?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), "reword-nerd-updates-"));
  roots.push(root);
  await mkdir(join(root, "content/updates"), { recursive: true });
  await mkdir(join(root, "src/export"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "reword-nerd", version: overrides.version ?? "0.7.0" }));
  await writeFile(join(root, "package-lock.json"), JSON.stringify({ name: "reword-nerd", version: overrides.version ?? "0.7.0", packages: { "": { version: overrides.version ?? "0.7.0" } } }));
  await writeFile(join(root, "src/version.ts"), `import packageMetadata from "../package.json";
function assertCurrentVersion(version: string): asserts version is "${overrides.version ?? "0.7.0"}" {
  if (version !== "${overrides.version ?? "0.7.0"}") throw new Error(version);
}
const packageVersion = packageMetadata.version;
assertCurrentVersion(packageVersion);
export const APP_VERSION = packageVersion;
`);
  await writeFile(join(root, "src/export/contracts.ts"), `export interface PromptPackageManifest {
  schemaVersion: 6;
  package: { name: "reword-nerd"; version: "${overrides.version ?? "0.7.0"}"; format: "dual-mode-prompt-package" };
}
export interface WorkbookProgress { schemaVersion: 1; }
`);
  const ledger = {
    schemaVersion: 1,
    site: {
      title: "reword-nerd Updates",
      description: "A builder's journal for reword-nerd.",
      canonicalOrigin: "https://ryanjosephkamp.github.io",
      basePath: "/reword-nerd/updates/",
    },
    entries: [{
      kind: "release",
      slug: "v0-7-0",
      title: "reword-nerd v0.7",
      summary: "A static Updates journal.",
      status: overrides.status ?? "current",
      date: "2026-08-13",
      author: "Ryan Joseph Kamp",
      tags: ["release", "updates"],
      relatedPrs: [7],
      markdownPath: "content/updates/v0-7-0.md",
      version: "0.7.0",
      classification: "feature",
      visualChanges: true,
      video: { policy: "exempt", exemptionReason: "The journal is fully represented in text." },
    }],
  };
  await writeFile(join(root, "content/updates/releases.json"), `${JSON.stringify(ledger, null, 2)}\n`);
  await writeFile(join(root, "content/updates/v0-7-0.md"), overrides.markdown ?? `# reword-nerd v0.7

## At a glance

I added a static builder's journal.

## Added

- Static Updates pages.

## Changed

- Release preparation is deterministic.

## Fixed

- Version drift now fails validation.

## Why this matters

Readers can inspect each release without running JavaScript.

## See it in action

The archive links to this post.

## How to use it

Open Updates from the workbench.

## Compatibility and limitations

The journal uses safe Markdown only.

## Privacy

No analytics, accounts, or remote assets are used.

## Verification

The release passed local tests and a production build.

## What comes next

I will keep the journal current.

## Feedback and contribution links

- [Open an issue](https://github.com/ryanjosephkamp/reword-nerd/issues)
`);
  return root;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Updates validation and rendering", () => {
  it("fails a draft current release, version disagreement, placeholders, and raw HTML", async () => {
    // Removing any production gate below must make this test accept an unsafe release.
    await expect(checkUpdates(await fixtureRoot({ status: "draft" }))).rejects.toThrow(/draft|current/i);
    await expect(checkUpdates(await fixtureRoot({ version: "0.6.0" }))).rejects.toThrow(/version/i);
    await expect(checkUpdates(await fixtureRoot({ markdown: "# TODO\n\n<script>alert(1)</script>" }))).rejects.toThrow(/placeholder|raw HTML/i);
  });

  it("reads the actual version and schema declarations instead of matching unrelated text", async () => {
    const versionRoot = await fixtureRoot();
    await writeFile(
      join(versionRoot, "src/version.ts"),
      'import packageMetadata from "../package.json";\nfunction assertCurrentVersion(version: string): asserts version is "0.6.0" { if (version !== "0.6.0") throw new Error(version); }\nconst packageVersion = packageMetadata.version;\nassertCurrentVersion(packageVersion);\nexport const APP_VERSION = packageVersion;\n// "0.7.0"\n',
    );
    await expect(checkUpdates(versionRoot)).rejects.toThrow(/APP_VERSION|package version/i);

    const schemaRoot = await fixtureRoot();
    await writeFile(
      join(schemaRoot, "src/export/contracts.ts"),
      'export interface PromptPackageManifest { schemaVersion: 5; package: { name: "reword-nerd"; version: "0.6.0"; format: "dual-mode-prompt-package" }; }\nexport interface WorkbookProgress { schemaVersion: 2; }\n// version: "0.7.0"; schemaVersion: 6; schemaVersion: 1;\n',
    );
    await expect(checkUpdates(schemaRoot)).rejects.toThrow(/package version|schema/i);

    const nestedSchemaRoot = await fixtureRoot();
    await writeFile(
      join(nestedSchemaRoot, "src/export/contracts.ts"),
      'export interface PromptPackageManifest { schemaVersion: 5; metadata: { schemaVersion: 6 }; package: { name: "reword-nerd"; version: "0.7.0"; format: "dual-mode-prompt-package" }; }\nexport interface WorkbookProgress { schemaVersion: 1; }\n',
    );
    await expect(checkUpdates(nestedSchemaRoot)).rejects.toThrow(/manifest schema/i);

    const stringDecoyRoot = await fixtureRoot();
    await writeFile(
      join(stringDecoyRoot, "src/version.ts"),
      'import packageMetadata from "../package.json";\nfunction assertCurrentVersion(version: string): asserts version is "0.7.0" { const decoy = \'if (version !== "0.7.0")\'; if (version !== "0.6.0") throw new Error(decoy); }\nconst packageVersion = packageMetadata.version;\nassertCurrentVersion(packageVersion);\nexport const APP_VERSION = packageVersion;\n',
    );
    await expect(checkUpdates(stringDecoyRoot)).rejects.toThrow(/APP_VERSION|package version/i);
  });

  it("renders deterministic semantic pages, feed, and sitemap without client JavaScript", async () => {
    // Removing the static outputs or public metadata must make these literal boundary checks fail.
    const root = await fixtureRoot();
    await renderUpdates(root, join(root, "dist"));
    const archive = await readFile(join(root, "dist/updates/index.html"), "utf8");
    const post = await readFile(join(root, "dist/updates/v0-7-0/index.html"), "utf8");
    const feed = await readFile(join(root, "dist/updates/feed.xml"), "utf8");
    const sitemap = await readFile(join(root, "dist/sitemap.xml"), "utf8");

    expect(archive).toContain("<main");
    expect(archive).toContain('itemscope itemtype="https://schema.org/Blog"');
    expect(post).toContain('rel="canonical" href="https://ryanjosephkamp.github.io/reword-nerd/updates/v0-7-0/"');
    expect(post).toContain('property="og:type" content="article"');
    expect(post).toContain('name="twitter:card" content="summary_large_image"');
    expect(post).toContain('"@type":"BlogPosting"');
    expect(post).not.toMatch(/<script\b(?![^>]*application\/ld\+json)/u);
    expect(feed).toContain("<rss version=\"2.0\">");
    expect(feed).toContain("A static Updates journal.");
    expect(sitemap).toContain("/reword-nerd/updates/v0-7-0/");
  });

  it("removes stale generated post routes before a standalone re-render", async () => {
    const root = await fixtureRoot();
    const output = join(root, "dist");
    await renderUpdates(root, output);
    const staleRoute = join(output, "updates/removed-release/index.html");
    await mkdir(join(output, "updates/removed-release"), { recursive: true });
    await writeFile(staleRoute, "stale");

    await renderUpdates(root, output);
    await expect(readFile(staleRoute, "utf8")).rejects.toThrow();
  });

  it("allows only one optional same-origin Share enhancement module", () => {
    // Broadening the script exception or removing it entirely must make one of these expectations fail.
    expect(() => validateRenderedPageScripts('<main>Complete static content</main><script type="module" src="/reword-nerd/updates/share.js"></script>')).not.toThrow();
    expect(() => validateRenderedPageScripts('<main>Complete static content</main><script type="module" src="/reword-nerd/updates/share.js"></script><script type="module" src="/reword-nerd/updates/share.js"></script>')).toThrow(/script/i);
    expect(() => validateRenderedPageScripts('<main>Complete static content</main><script type="module" src="/reword-nerd/updates/share.js" onload="fetch(\'/secret\')"></script>')).toThrow(/script/i);
    expect(() => validateRenderedPageScripts('<main>Complete static content</main><script src="https://cdn.example/share.js"></script>')).toThrow(/script/i);
    expect(() => validateRenderedPageScripts('<main>Complete static content</main><script>location.href="/"</script>')).toThrow(/script/i);
  });

  it("rejects GitHub links outside the exact editorial destination allowlist", async () => {
    // Replacing the exact allowlist with an owner-prefix check must make this unsafe post pass.
    const root = await fixtureRoot();
    const postPath = join(root, "content/updates/v0-7-0.md");
    await writeFile(postPath, `${await readFile(postPath, "utf8")}\n- [Unapproved](https://github.com/ryanjosephkamp/private-admin)\n`);
    await expect(checkUpdates(root)).rejects.toThrow(/unsafe.*link/i);
  });

  it.each([
    ["an HTML comment", "<!-- publication note -->"],
    ["a JSX fragment", "<>publication note</>"],
    ["an MDX export without whitespace", "export{publicationNote}"],
    ["an MDX identifier expression", "{publicationNote}"],
    ["an MDX comment expression", "{/* publication note */}"],
  ])("rejects %s in reviewed Markdown", async (_label, unsafeSource) => {
    // Narrow tag-only or whitespace-only syntax checks must make at least one prohibited raw HTML/MDX form pass.
    const root = await fixtureRoot();
    const postPath = join(root, "content/updates/v0-7-0.md");
    await writeFile(postPath, `${await readFile(postPath, "utf8")}\n${unsafeSource}\n`);
    await expect(checkUpdates(root)).rejects.toThrow(/raw HTML|MDX/i);
  });

  it("allows ordinary prose braces and inline-code braces", async () => {
    // Treating every brace as MDX must make safe prose and inline code fail this check.
    const root = await fixtureRoot();
    const postPath = join(root, "content/updates/v0-7-0.md");
    await writeFile(postPath, `${await readFile(postPath, "utf8")}\nKeep the literal {curly braces} visible and preserve \`{publicationNote}\` as code.\n`);
    await expect(checkUpdates(root)).resolves.toMatchObject({ version: "0.7.0" });
  });
});
