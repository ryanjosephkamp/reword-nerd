import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { dirname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import ts from "typescript";

const execFile = promisify(execFileCallback);

const SAFE_TEXT = /^[^<>]+$/u;
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const RAW_HTML_OR_MDX = /<!--|<![^>]*>|<\/?[A-Za-z][^>]*>|<\/?>|^\s*(?:import|export)(?:\s|\{)/mu;
const MDX_EXPRESSION = /(?<!\\)\{\s*(?:\/\*[\s\S]*?\*\/|[A-Za-z_$][\w$]*(?:\s*(?:\}|[.\x5B(+*/%?:=!<>-]))|[\d'"\x5B({])/u;
const FIRST_PERSON_SINGULAR = /\b(?:i|me|my|mine|myself)\b/iu;

function isValidIsoDate(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= daysInMonth;
}

function fail(message) {
  throw new Error(`Invalid release ledger: ${message}`);
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function requireSafeText(value, label) {
  if (typeof value !== "string" || !SAFE_TEXT.test(value.trim()) || [...value].some((character) => character.codePointAt(0) < 32)) fail(`${label} contains unsafe or empty text`);
  return value;
}

function requireLocalWebPath(value, label) {
  if (typeof value !== "string" || !value.startsWith("/reword-nerd/") || value.includes("..") || /^(?:[a-z]+:)?\/\//iu.test(value)) {
    fail(`${label} must be a safe same-origin /reword-nerd/ path`);
  }
  return value;
}

function requireMarkdownPath(value, slug) {
  const expected = `content/updates/${slug}.md`;
  if (value !== expected || value.includes("..")) fail(`markdown path must be ${expected}`);
  return value;
}

function validateVideo(value, entry, label) {
  const video = requireObject(value, `${label}.video`);
  if (!["none", "required", "exempt"].includes(video.policy)) fail(`${label}.video.policy is invalid`);
  if (video.policy === "required") {
    for (const key of ["mp4Path", "webmPath", "posterPath", "transcriptPath"]) requireLocalWebPath(video[key], `${label}.video.${key}`);
  }
  if (video.policy === "exempt") requireSafeText(video.exemptionReason, `${label}.video.exemptionReason`);
  if (entry.kind === "release") {
    if (entry.visualChanges && video.policy !== "required") fail(`${label} visual ${entry.classification} release requires policy required`);
    if (!entry.visualChanges && entry.classification === "feature" && !["required", "exempt"].includes(video.policy)) fail(`${label} nonvisual feature release requires policy required or a public exemption reason`);
    if (!entry.visualChanges && entry.classification === "maintenance" && video.policy !== "none") fail(`${label} nonvisual maintenance release requires policy none`);
    if (video.policy === "exempt" && (entry.visualChanges || entry.classification !== "feature")) fail(`${label} exemptions are only for nonvisual feature releases`);
  } else if (entry.visualChanges && video.policy === "none") {
    fail(`${label} declares visual changes and needs video or an exemption`);
  }
  return video;
}

/**
 * Validate and return the JSON-authoritative ReleaseLedgerV1 value.
 * @param {unknown} input
 */
export function validateReleaseLedger(input) {
  const ledger = requireObject(input, "root");
  if (ledger.schemaVersion !== 1) fail("schemaVersion must be 1");

  const site = requireObject(ledger.site, "site");
  requireSafeText(site.title, "site.title");
  requireSafeText(site.description, "site.description");
  if (site.canonicalOrigin !== "https://ryanjosephkamp.github.io") fail("site.canonicalOrigin is unsafe");
  if (site.basePath !== "/reword-nerd/updates/") fail("site.basePath is unsafe");

  if (!Array.isArray(ledger.entries) || ledger.entries.length === 0) fail("entries must be a non-empty array");
  const slugs = new Set();
  let currentReleases = 0;

  for (const [index, candidate] of ledger.entries.entries()) {
    const label = `entries[${index}]`;
    const entry = requireObject(candidate, label);
    if (!["release", "article"].includes(entry.kind)) fail(`${label}.kind is invalid`);
    if (typeof entry.slug !== "string" || !SAFE_SLUG.test(entry.slug)) fail(`${label}.slug is unsafe`);
    if (slugs.has(entry.slug)) fail(`${label}.slug is duplicated`);
    slugs.add(entry.slug);
    requireSafeText(entry.title, `${label}.title`);
    requireSafeText(entry.summary, `${label}.summary`);
    requireSafeText(entry.author, `${label}.author`);
    if (!["draft", "current", "published", "archived"].includes(entry.status)) fail(`${label}.status is invalid`);
    if (entry.status === "current") currentReleases += entry.kind === "release" ? 1 : 0;
    if (!isValidIsoDate(entry.date)) fail(`${label}.date is invalid`);
    if (!Array.isArray(entry.tags) || entry.tags.length === 0) fail(`${label}.tags must be non-empty`);
    entry.tags.forEach((tag, tagIndex) => requireSafeText(tag, `${label}.tags[${tagIndex}]`));
    if (!Array.isArray(entry.relatedPrs) || entry.relatedPrs.some((pr) => !Number.isSafeInteger(pr) || pr < 1)) fail(`${label}.relatedPrs is invalid`);
    requireMarkdownPath(entry.markdownPath, entry.slug);
    if (typeof entry.visualChanges !== "boolean") fail(`${label}.visualChanges must be boolean`);
    if (entry.kind === "release") {
      if (typeof entry.version !== "string" || !SEMVER.test(entry.version)) fail(`${label}.version is invalid SemVer`);
      if (!["feature", "maintenance"].includes(entry.classification)) fail(`${label}.classification is invalid`);
      const expectedClassification = entry.version.split(".")[2] === "0" ? "feature" : "maintenance";
      if (entry.classification !== expectedClassification) fail(`${label}.classification disagrees with SemVer`);
    } else if ("version" in entry || "classification" in entry) {
      fail(`${label} article cannot declare release version fields`);
    }
    validateVideo(entry.video, entry, label);
  }

  if (currentReleases > 1) fail("only one release may be current");
  return input;
}

export async function readReleaseLedger(rootDirectory) {
  const ledgerPath = resolve(rootDirectory, "content/updates/releases.json");
  const contentRoot = resolve(rootDirectory, "content/updates") + sep;
  if (!ledgerPath.startsWith(contentRoot)) fail("ledger path escaped content root");
  return validateReleaseLedger(JSON.parse(await readFile(ledgerPath, "utf8")));
}

export function classifyRelease(version) {
  const match = SEMVER.exec(version);
  if (!match) throw new Error(`Invalid SemVer version: ${version}`);
  return match[3] === "0" ? "feature" : "maintenance";
}

const REQUIRED_SECTIONS = [
  "At a glance",
  "Added",
  "Changed",
  "Fixed",
  "Why this matters",
  "See it in action",
  "How to use it",
  "Compatibility and limitations",
  "Privacy",
  "Verification",
  "What comes next",
  "Feedback and contribution links",
];

function markdownProblem(markdown, entry) {
  const proseWithoutInlineCode = markdown.replace(/`[^`\n]*`/gu, "");
  if (RAW_HTML_OR_MDX.test(proseWithoutInlineCode) || MDX_EXPRESSION.test(proseWithoutInlineCode)) return "raw HTML or MDX is not allowed";
  if (/\b(?:TODO|TBD|FIXME|PLACEHOLDER)\b|\[insert\b|lorem ipsum/iu.test(markdown)) return "placeholder prose is not allowed";
  const proseWithoutLinkDestinations = proseWithoutInlineCode.replace(/\]\([^)]+\)/gu, "]");
  if (FIRST_PERSON_SINGULAR.test(proseWithoutLinkDestinations)) return "first-person singular prose is not allowed; use terse changelog voice";
  if (!markdown.startsWith(`# ${entry.title}\n`)) return `first heading must exactly match ${entry.title}`;
  let prior = -1;
  for (const heading of REQUIRED_SECTIONS) {
    const index = markdown.indexOf(`\n## ${heading}\n`);
    if (index < 0 || index <= prior) return `required section is missing or out of order: ${heading}`;
    prior = index;
  }
  for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/gu)) {
    try {
      requireLocalWebPath(match[1], "Markdown media path");
    } catch (error) {
      return error instanceof Error ? error.message : "unsafe Markdown media path";
    }
  }
  for (const match of markdown.matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/gu)) {
    try {
      safeLinkDestination(match[1]);
    } catch (error) {
      return error instanceof Error ? error.message : "unsafe Markdown link destination";
    }
  }
  return null;
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is missing or invalid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

function propertyName(node) {
  return node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : null;
}

function literalTypeValue(typeNode) {
  if (!typeNode || !ts.isLiteralTypeNode(typeNode)) return null;
  if (ts.isStringLiteral(typeNode.literal)) return typeNode.literal.text;
  if (ts.isNumericLiteral(typeNode.literal)) return Number(typeNode.literal.text);
  return null;
}

function directProperty(container, name) {
  return container.members.find((member) => ts.isPropertySignature(member) && propertyName(member.name) === name) ?? null;
}

function readSourceContracts(versionSource, exportContracts) {
  const versionFile = ts.createSourceFile("version.ts", versionSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const versionGuard = versionFile.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "assertCurrentVersion");
  if (!versionGuard || !versionGuard.body || !versionGuard.type || !ts.isTypePredicateNode(versionGuard.type)) {
    throw new Error("APP_VERSION guard declaration is missing");
  }
  const assertedVersion = literalTypeValue(versionGuard.type.type);
  const comparisons = [];
  const visitComparison = (node) => {
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
      && ts.isIdentifier(node.left)
      && node.left.text === "version"
      && ts.isStringLiteral(node.right)
    ) comparisons.push(node.right.text);
    ts.forEachChild(node, visitComparison);
  };
  visitComparison(versionGuard.body);
  if (comparisons.length !== 1) throw new Error("APP_VERSION guard comparison is missing or ambiguous");

  const packageVersionDeclaration = versionFile.statements.some((statement) => ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) => (
    ts.isIdentifier(declaration.name)
    && declaration.name.text === "packageVersion"
    && declaration.initializer
    && ts.isPropertyAccessExpression(declaration.initializer)
    && ts.isIdentifier(declaration.initializer.expression)
    && declaration.initializer.expression.text === "packageMetadata"
    && declaration.initializer.name.text === "version"
  )));
  const guardedPackageVersion = versionFile.statements.some((statement) => ts.isExpressionStatement(statement)
    && ts.isCallExpression(statement.expression)
    && ts.isIdentifier(statement.expression.expression)
    && statement.expression.expression.text === "assertCurrentVersion"
    && statement.expression.arguments.length === 1
    && ts.isIdentifier(statement.expression.arguments[0])
    && statement.expression.arguments[0].text === "packageVersion");
  const exportedAppVersion = versionFile.statements.some((statement) => ts.isVariableStatement(statement)
    && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    && statement.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name)
      && declaration.name.text === "APP_VERSION"
      && declaration.initializer
      && ts.isIdentifier(declaration.initializer)
      && declaration.initializer.text === "packageVersion"));
  if (!packageVersionDeclaration || !guardedPackageVersion || !exportedAppVersion) {
    throw new Error("APP_VERSION is not derived through the package version guard");
  }

  const contractsFile = ts.createSourceFile("contracts.ts", exportContracts, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findInterface = (name) => contractsFile.statements.find((statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === name);
  const manifest = findInterface("PromptPackageManifest");
  const progress = findInterface("WorkbookProgress");
  if (!manifest || !progress) throw new Error("Export version or schema declaration is missing");
  const manifestSchema = literalTypeValue(directProperty(manifest, "schemaVersion")?.type);
  const progressSchema = literalTypeValue(directProperty(progress, "schemaVersion")?.type);
  const packageProperty = directProperty(manifest, "package");
  if (!packageProperty?.type || !ts.isTypeLiteralNode(packageProperty.type)) throw new Error("Export package declaration is malformed");
  const packageName = literalTypeValue(directProperty(packageProperty.type, "name")?.type);
  const packageVersion = literalTypeValue(directProperty(packageProperty.type, "version")?.type);
  const packageFormat = literalTypeValue(directProperty(packageProperty.type, "format")?.type);
  if (packageName !== "reword-nerd" || typeof packageVersion !== "string" || packageFormat !== "dual-mode-prompt-package") {
    throw new Error("Export package version declaration is malformed");
  }
  return { assertedVersion, comparedVersion: comparisons[0], packageVersion, manifestSchema, progressSchema };
}

function localPathForWebPath(rootDirectory, webPath) {
  const prefix = "/reword-nerd/";
  const relativePath = webPath.slice(prefix.length);
  const publicRoot = resolve(rootDirectory, "public") + sep;
  const localPath = resolve(rootDirectory, "public", relativePath);
  if (!localPath.startsWith(publicRoot)) throw new Error(`Unsafe media path: ${webPath}`);
  return localPath;
}

export async function checkUpdates(rootDirectory) {
  const root = resolve(rootDirectory);
  const ledger = await readReleaseLedger(root);
  const packageJson = await readJson(resolve(root, "package.json"), "package.json");
  const packageLock = await readJson(resolve(root, "package-lock.json"), "package-lock.json");
  const version = packageJson.version;
  if (typeof version !== "string" || !SEMVER.test(version)) throw new Error("Package version is not valid SemVer");
  if (packageLock.version !== version || packageLock.packages?.[""]?.version !== version) throw new Error("Package and lockfile versions disagree");

  const versionSource = await readFile(resolve(root, "src/version.ts"), "utf8");
  const exportContracts = await readFile(resolve(root, "src/export/contracts.ts"), "utf8");
  const sourceContracts = readSourceContracts(versionSource, exportContracts);
  if (sourceContracts.assertedVersion !== version || sourceContracts.comparedVersion !== version) throw new Error("Central APP_VERSION contract disagrees with package version");
  if (sourceContracts.packageVersion !== version) throw new Error("Export package version contract disagrees with package version");
  if (sourceContracts.manifestSchema !== 6) throw new Error("Manifest schema must remain 6");
  if (sourceContracts.progressSchema !== 1) throw new Error("Workbook progress schema must remain 1");

  const current = ledger.entries.filter((entry) => entry.kind === "release" && entry.status === "current");
  if (current.length !== 1) throw new Error("Exactly one current release is required");
  if (ledger.entries.some((entry) => entry.status === "draft")) throw new Error("Draft Updates entries cannot ship in a production build");
  if (current[0].version !== version) throw new Error(`Current release version ${current[0].version} disagrees with package version ${version}`);

  const posts = new Map();
  for (const entry of ledger.entries) {
    const markdownPath = resolve(root, entry.markdownPath);
    const updatesRoot = resolve(root, "content/updates") + sep;
    if (!markdownPath.startsWith(updatesRoot)) throw new Error(`Broken Markdown path: ${entry.markdownPath}`);
    let markdown;
    try {
      markdown = await readFile(markdownPath, "utf8");
    } catch {
      throw new Error(`Broken Markdown path: ${entry.markdownPath}`);
    }
    const problem = markdownProblem(markdown, entry);
    if (problem) throw new Error(`Invalid Markdown in ${entry.markdownPath}: ${problem}`);
    posts.set(entry.slug, markdown);
    if (entry.video.policy === "required") {
      for (const path of [entry.video.mp4Path, entry.video.webmPath, entry.video.posterPath, entry.video.transcriptPath]) {
        try {
          await access(localPathForWebPath(root, path));
        } catch {
          throw new Error(`Broken local media path: ${path}`);
        }
      }
    }
  }
  return { ledger, posts, version };
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function escapeXml(value) {
  return escapeHtml(value);
}

function safeLinkDestination(destination) {
  if (destination.startsWith("/reword-nerd/")) return requireLocalWebPath(destination, "Markdown link destination");
  const approved = new Set([
    "https://github.com/ryanjosephkamp/reword-nerd",
    "https://github.com/ryanjosephkamp/reword-nerd/issues",
    "https://github.com/ryanjosephkamp/reword-nerd/issues/new?template=bug_report.yml",
    "https://github.com/ryanjosephkamp/reword-nerd/issues/new?template=feature_request.yml",
    "https://github.com/ryanjosephkamp/reword-nerd/security/advisories/new",
    "https://github.com/ryanjosephkamp/reword-nerd/blob/main/CONTRIBUTING.md",
    "https://github.com/sponsors/ryanjosephkamp",
    "https://ryanjosephkamp.github.io",
  ]);
  if (approved.has(destination)) return destination;
  throw new Error(`Unsafe Markdown link destination: ${destination}`);
}

export function validateRenderedPageScripts(html) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)];
  let shareModules = 0;
  for (const match of scripts) {
    const attributes = match[1].trim();
    const body = match[2].trim();
    if (/^type=["']application\/ld\+json["']$/iu.test(attributes)) continue;
    const allowedShareAttributes = /^(?:type=["']module["']\s+src=["']\/reword-nerd\/updates\/share\.js["']|src=["']\/reword-nerd\/updates\/share\.js["']\s+type=["']module["'])$/iu;
    if (allowedShareAttributes.test(attributes) && body === "") {
      shareModules += 1;
      continue;
    }
    throw new Error("Rendered Updates page contains a disallowed script");
  }
  if (shareModules > 1) throw new Error("Rendered Updates page contains more than one Share enhancement script");
  return html;
}

function inlineMarkdown(value) {
  let output = "";
  let cursor = 0;
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/gu;
  for (const match of value.matchAll(pattern)) {
    output += escapeHtml(value.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith("`")) output += `<code>${escapeHtml(token.slice(1, -1))}</code>`;
    else if (token.startsWith("**")) output += `<strong>${escapeHtml(token.slice(2, -2))}</strong>`;
    else {
      const split = token.lastIndexOf("](");
      const label = token.slice(1, split);
      const destination = safeLinkDestination(token.slice(split + 2, -1));
      output += `<a href="${escapeHtml(destination)}">${escapeHtml(label)}</a>`;
    }
    cursor = (match.index ?? 0) + token.length;
  }
  return output + escapeHtml(value.slice(cursor));
}

function renderMarkdown(markdown) {
  const lines = markdown.trim().split("\n");
  const output = [];
  let listOpen = false;
  const closeList = () => {
    if (listOpen) output.push("</ul>");
    listOpen = false;
  };
  for (const line of lines) {
    if (!line.trim()) {
      closeList();
      continue;
    }
    if (line.startsWith("# ")) {
      closeList();
      output.push(`<h1>${inlineMarkdown(line.slice(2))}</h1>`);
    } else if (line.startsWith("## ")) {
      closeList();
      output.push(`<h2>${inlineMarkdown(line.slice(3))}</h2>`);
    } else if (line.startsWith("### ")) {
      closeList();
      output.push(`<h3>${inlineMarkdown(line.slice(4))}</h3>`);
    } else if (line.startsWith("- ")) {
      if (!listOpen) output.push("<ul>");
      listOpen = true;
      output.push(`<li>${inlineMarkdown(line.slice(2))}</li>`);
    } else {
      closeList();
      output.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }
  closeList();
  return output.join("\n");
}

function renderReleaseVideo(video) {
  return `<figure class="release-video"><div class="release-video-motion"><video controls muted playsinline preload="none" poster="${escapeHtml(video.posterPath)}"><source src="${escapeHtml(video.webmPath)}" type="video/webm"><source src="${escapeHtml(video.mp4Path)}" type="video/mp4">Your browser cannot play this same-origin release video.</video></div><div class="release-video-poster"><img src="${escapeHtml(video.posterPath)}" alt="Synthetic reword-nerd v0.7 Updates, feedback, and Share release poster"></div><figcaption>Silent, synthetic release walkthrough. <a href="${escapeHtml(video.transcriptPath)}">Read the transcript</a>.</figcaption><p class="release-video-fallback">Video unavailable? <a href="${escapeHtml(video.posterPath)}">Open the release poster</a>.</p></figure>`;
}

function pageShell({ site, title, description, canonicalPath, type, body, jsonLd }) {
  const canonical = `${site.canonicalOrigin}${canonicalPath}`;
  const image = `${site.canonicalOrigin}/reword-nerd/brand/reword-nerd-logo.webp`;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <link rel="icon" href="/reword-nerd/brand/favicon.ico" sizes="any">
  <link rel="stylesheet" href="/reword-nerd/updates/updates.css">
  <link rel="alternate" type="application/rss+xml" title="${escapeHtml(site.title)}" href="/reword-nerd/updates/feed.xml">
  <meta property="og:type" content="${type}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:image" content="${escapeHtml(image)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(image)}">
  <script type="application/ld+json">${JSON.stringify(jsonLd).replaceAll("<", "\\u003c")}</script>
  <script type="module" src="/reword-nerd/updates/share.js"></script>
</head>
<body>
  <header class="site-header"><a href="/reword-nerd/">reword-nerd</a><span aria-hidden="true">/</span><a aria-current="page" href="/reword-nerd/updates/">Updates</a></header>
  ${body}
  <footer><p id="share-status" class="share-status" aria-live="polite"></p><p>Built in public, processed locally. No analytics or remote assets.</p><nav aria-label="Feedback links"><a href="https://github.com/ryanjosephkamp/reword-nerd/issues/new?template=bug_report.yml">Report a bug</a> <span aria-hidden="true">·</span> <a href="https://github.com/ryanjosephkamp/reword-nerd/issues/new?template=feature_request.yml">Suggest a feature</a> <span aria-hidden="true">·</span> <a href="https://github.com/ryanjosephkamp/reword-nerd/security/advisories/new">Security reporting</a></nav></footer>
</body>
</html>
`;
  return validateRenderedPageScripts(html);
}

const UPDATES_CSS = `:root{color-scheme:dark;--bg:#070b0d;--panel:#0d1417;--line:#233238;--text:#e4eee9;--muted:#94aaa1;--mint:#42e8b4;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);line-height:1.65}a:link,a:visited{color:var(--mint);text-underline-offset:.2em}.site-header,main,footer{width:min(100% - 2rem,72rem);margin-inline:auto}.site-header{display:flex;gap:.65rem;padding:1.25rem 0;border-bottom:1px solid var(--line)}main{padding:2.5rem 0 4rem}.eyebrow,.meta{color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-size:.78rem}h1{font-size:clamp(2rem,8vw,4.6rem);line-height:1.04;letter-spacing:-.05em;margin:.35rem 0 1rem}h2{margin-top:2.5rem;font-size:clamp(1.25rem,4vw,1.8rem)}p,li{max-width:72ch}.release-list{list-style:none;padding:0;display:grid;gap:1rem}.release-card{display:block;border:1px solid var(--line);background:var(--panel);padding:1.25rem;border-radius:.4rem}.release-card h2{margin:.35rem 0}.tags{display:flex;flex-wrap:wrap;gap:.5rem;padding:0;list-style:none}.tags li{border:1px solid var(--line);padding:.15rem .45rem}article{max-width:52rem}footer{border-top:1px solid var(--line);padding:1.25rem 0;color:var(--muted)}@media(max-width:420px){.site-header,main,footer{width:min(100% - 1.25rem,72rem)}main{padding-top:1.5rem}.release-card{padding:1rem}}
`;

const UPDATES_SHARE_CSS = ".share-control{margin:1rem 0 0;padding:.6rem .9rem;border:1px solid var(--mint);border-radius:.3rem;color:var(--mint);background:transparent;font:inherit;cursor:pointer}.share-control:hover,.share-control:focus-visible{color:var(--bg);background:var(--mint)}.share-status{min-height:1.65em;color:var(--mint)}.share-fallback-backdrop{position:fixed;inset:0;z-index:10;display:grid;place-items:center;padding:1rem;background:rgb(0 0 0 / .7)}.share-fallback{width:min(100%,36rem);padding:1.25rem;border:1px solid var(--mint);background:var(--panel)}.share-fallback textarea{width:100%;min-height:5.5rem;margin:.75rem 0;padding:.6rem;color:var(--text);background:var(--bg);border:1px solid var(--line);font:inherit}.share-fallback button{padding:.55rem .8rem;color:var(--mint);background:transparent;border:1px solid var(--mint);font:inherit;cursor:pointer}";

const RELEASE_VIDEO_CSS = ".release-video{margin:2.5rem 0;padding:1rem;border:1px solid var(--line);background:var(--panel)}.release-video-motion video,.release-video-poster img{display:block;width:100%;aspect-ratio:16/9;background:var(--bg);object-fit:cover}.release-video-poster{display:none}.release-video figcaption,.release-video-fallback{margin:.8rem 0 0;color:var(--muted);font-size:.9rem}.release-video-fallback{margin-bottom:0}@media(prefers-reduced-motion:reduce){.release-video-motion{display:none}.release-video-poster{display:block}}";

async function writeOutput(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

export async function renderUpdates(rootDirectory, outputDirectory = resolve(rootDirectory, "dist")) {
  const { ledger, posts } = await checkUpdates(rootDirectory);
  const entries = [...ledger.entries].sort((left, right) => right.date.localeCompare(left.date) || left.slug.localeCompare(right.slug));
  const archivePath = "/reword-nerd/updates/";
  await rm(resolve(outputDirectory, "updates"), { recursive: true, force: true });
  const archiveBody = `<main itemscope itemtype="https://schema.org/Blog"><p class="eyebrow">Builder's journal</p><h1>Updates</h1><p>${escapeHtml(ledger.site.description)}</p><button class="share-control" type="button" data-share-url="${escapeHtml(`${ledger.site.canonicalOrigin}${archivePath}`)}" data-share-title="${escapeHtml(ledger.site.title)}">Share</button><ol class="release-list">${entries.map((entry) => `<li class="release-card"><p class="meta"><time datetime="${entry.date}">${entry.date}</time> · ${escapeHtml(entry.kind)}</p><h2><a href="/reword-nerd/updates/${entry.slug}/">${escapeHtml(entry.title)}</a></h2><p>${escapeHtml(entry.summary)}</p><ul class="tags">${entry.tags.map((tag) => `<li>${escapeHtml(tag)}</li>`).join("")}</ul></li>`).join("")}</ol></main>`;
  const blogJsonLd = { "@context": "https://schema.org", "@type": "Blog", name: ledger.site.title, description: ledger.site.description, url: `${ledger.site.canonicalOrigin}${archivePath}` };
  await writeOutput(resolve(outputDirectory, "updates/index.html"), pageShell({ site: ledger.site, title: ledger.site.title, description: ledger.site.description, canonicalPath: archivePath, type: "website", body: archiveBody, jsonLd: blogJsonLd }));
  await writeOutput(resolve(outputDirectory, "updates/updates.css"), `${UPDATES_CSS}${UPDATES_SHARE_CSS}${RELEASE_VIDEO_CSS}`);
  await writeOutput(resolve(outputDirectory, "updates/share.js"), await readFile(resolve(rootDirectory, "public/updates/share.js"), "utf8"));

  for (const entry of entries) {
    const canonicalPath = `/reword-nerd/updates/${entry.slug}/`;
    const video = entry.video.policy === "required" ? renderReleaseVideo(entry.video) : "";
    const body = `<main><article itemscope itemtype="https://schema.org/BlogPosting"><p class="eyebrow">${escapeHtml(entry.kind === "release" ? `${entry.classification} release` : "retrospective")}</p><p class="meta"><time itemprop="datePublished" datetime="${entry.date}">${entry.date}</time> · ${escapeHtml(entry.author)}</p>${renderMarkdown(posts.get(entry.slug))}${video}</article><button class="share-control" type="button" data-share-url="${escapeHtml(`${ledger.site.canonicalOrigin}${canonicalPath}`)}" data-share-title="${escapeHtml(entry.title)}">Share</button><p><a href="/reword-nerd/updates/">← All Updates</a></p></main>`;
    const jsonLd = { "@context": "https://schema.org", "@type": "BlogPosting", headline: entry.title, description: entry.summary, datePublished: entry.date, author: { "@type": "Person", name: entry.author }, url: `${ledger.site.canonicalOrigin}${canonicalPath}` };
    await writeOutput(resolve(outputDirectory, `updates/${entry.slug}/index.html`), pageShell({ site: ledger.site, title: `${entry.title} · Updates`, description: entry.summary, canonicalPath, type: "article", body, jsonLd }));
  }

  const feedItems = entries.map((entry) => { const url = `${ledger.site.canonicalOrigin}/reword-nerd/updates/${entry.slug}/`; return `<item><title>${escapeXml(entry.title)}</title><link>${escapeXml(url)}</link><guid isPermaLink="true">${escapeXml(url)}</guid><pubDate>${new Date(`${entry.date}T00:00:00Z`).toUTCString()}</pubDate><description>${escapeXml(entry.summary)}</description></item>`; }).join("");
  await writeOutput(resolve(outputDirectory, "updates/feed.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${escapeXml(ledger.site.title)}</title><link>${ledger.site.canonicalOrigin}${archivePath}</link><description>${escapeXml(ledger.site.description)}</description>${feedItems}</channel></rss>\n`);
  const sitemapPaths = ["/reword-nerd/", archivePath, ...entries.map((entry) => `/reword-nerd/updates/${entry.slug}/`)];
  await writeOutput(resolve(outputDirectory, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemapPaths.map((path) => `<url><loc>${ledger.site.canonicalOrigin}${path}</loc></url>`).join("")}</urlset>\n`);
  return entries.map((entry) => entry.slug);
}

function assertAuthoringArguments({ slug, title, date }) {
  if (slug !== undefined && (typeof slug !== "string" || !SAFE_SLUG.test(slug))) throw new Error(`Unsafe slug: ${slug}`);
  requireSafeText(title, "title");
  if (!isValidIsoDate(date)) throw new Error(`Invalid date: ${date}`);
}

function journalScaffold(title, subject) {
  return `# ${title}

## At a glance

Prepared this ${subject} for human editorial review before publication.

## Added

- Record additions here.

## Changed

- Record changes here.

## Fixed

- Record fixes here.

## Why this matters

Explain the practical effect for people using reword-nerd.

## See it in action

Point to same-origin, synthetic release media when the release needs it.

## How to use it

Document the shortest path through the new behavior.

## Compatibility and limitations

State supported behavior and known limits directly.

## Privacy

The workbench remains local and browser-only, with no analytics or provider calls.

## Verification

Replace this inventory note with exact reviewed test and build evidence.

## What comes next

Describe the next bounded product step.

## Feedback and contribution links

- [Open an issue](https://github.com/ryanjosephkamp/reword-nerd/issues)
`;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function jsonBytes(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function transactionFailure(hooks, stage, index) {
  if (!hooks) return;
  const hook = stage === "stage" ? hooks.beforeStage : hooks.beforePublish;
  if (hook) hook({ index, stage });
}

async function publishAuthoringTransaction(rootDirectory, candidates, validate, hooks) {
  const root = resolve(rootDirectory);
  const transaction = await mkdtemp(resolve(root, ".updates-transaction-"));
  const records = candidates.map(({ path, bytes }, index) => ({
    target: resolve(path),
    bytes,
    candidate: resolve(transaction, "candidate", String(index)),
    backup: resolve(transaction, "backup", String(index)),
    existed: false,
    published: false,
  }));
  let published = false;
  try {
    for (const record of records) {
      if (!record.target.startsWith(`${root}${sep}`)) throw new Error(`Unsafe authoring target: ${record.target}`);
      await access(dirname(record.target));
    }

    for (const [index, record] of records.entries()) {
      await mkdir(dirname(record.candidate), { recursive: true });
      await writeFile(record.candidate, record.bytes, { encoding: "utf8", flag: "wx" });
      transactionFailure(hooks, "stage", index);
    }

    for (const record of records) {
      try {
        const original = await readFile(record.target);
        record.existed = true;
        await mkdir(dirname(record.backup), { recursive: true });
        await writeFile(record.backup, original, { flag: "wx" });
      } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") continue;
        throw error;
      }
    }

    await validate(new Map(records.map((record) => [record.target, record.candidate])));

    for (const [index, record] of records.entries()) {
      transactionFailure(hooks, "publish", index);
      await rename(record.candidate, record.target);
      record.published = true;
      published = true;
    }
  } catch (error) {
    if (published) {
      try {
        for (const record of [...records].reverse()) {
          if (!record.published) continue;
          if (record.existed) await rename(record.backup, record.target);
          else await rm(record.target, { force: true });
        }
      } catch (rollbackError) {
        const publicationError = error instanceof Error ? error.message : String(error);
        throw new Error(`Updates publication failed and rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}. Original publication error: ${publicationError}`, { cause: rollbackError });
      }
    }
    throw error;
  } finally {
    await rm(transaction, { recursive: true, force: true });
  }
}

export async function createUpdate(rootDirectory, options, transactionHooks) {
  assertAuthoringArguments(options);
  const ledger = await readReleaseLedger(rootDirectory);
  const existing = ledger.entries.find((entry) => entry.slug === options.slug);
  if (existing) {
    if (existing.kind !== "article" || existing.title !== options.title || existing.date !== options.date) throw new Error(`Slug already belongs to a different entry: ${options.slug}`);
    return "unchanged";
  }

  const markdownPath = resolve(rootDirectory, `content/updates/${options.slug}.md`);
  if (await pathExists(markdownPath)) throw new Error(`Refusing to overwrite existing prose: content/updates/${options.slug}.md`);
  const entry = {
    kind: "article",
    slug: options.slug,
    title: options.title,
    summary: "A builder's-journal article prepared for editorial review.",
    status: "draft",
    date: options.date,
    author: "Ryan Joseph Kamp",
    tags: ["builder's journal"],
    relatedPrs: [],
    markdownPath: `content/updates/${options.slug}.md`,
    visualChanges: false,
    video: { policy: "none" },
  };
  const nextLedger = { ...ledger, entries: [...ledger.entries, entry] };
  const post = journalScaffold(options.title, "article");
  await publishAuthoringTransaction(rootDirectory, [
    { path: markdownPath, bytes: post },
    { path: resolve(rootDirectory, "content/updates/releases.json"), bytes: jsonBytes(nextLedger) },
  ], async (staged) => {
    const stagedLedger = validateReleaseLedger(JSON.parse(await readFile(staged.get(resolve(rootDirectory, "content/updates/releases.json")), "utf8")));
    const stagedPost = await readFile(staged.get(markdownPath), "utf8");
    const problem = markdownProblem(stagedPost, stagedLedger.entries.at(-1));
    if (problem) throw new Error(`Invalid staged Markdown: ${problem}`);
  }, transactionHooks);
  return "created";
}

function compareSemVer(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

async function localGitInventory(rootDirectory) {
  let stdout;
  try {
    ({ stdout } = await execFile("git", ["log", "--format=%H%x09%aI%x09%s", "--max-count=200"], { cwd: rootDirectory, encoding: "utf8" }));
  } catch (error) {
    throw new Error(`Git history is required for release preparation: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const lines = stdout.trim().split("\n").filter(Boolean);
  if (lines.length === 0) throw new Error("Git history is required for release preparation: no commits were found");
  return lines.map((line) => {
    const [commit, authoredAt, ...subjectParts] = line.split("\t");
    return { commit, authoredAt, subject: subjectParts.join("\t") };
  });
}

export async function prepareRelease(rootDirectory, options, transactionHooks) {
  assertAuthoringArguments(options);
  if (typeof options.version !== "string" || !SEMVER.test(options.version)) throw new Error(`Invalid SemVer version: ${options.version}`);
  const commits = await localGitInventory(rootDirectory);
  const ledger = await readReleaseLedger(rootDirectory);
  const slug = `v${options.version.replaceAll(".", "-")}`;
  const existing = ledger.entries.find((entry) => entry.kind === "release" && entry.version === options.version);
  if (existing) {
    if (existing.slug !== slug || existing.title !== options.title || existing.date !== options.date) throw new Error(`Release ${options.version} already has different metadata`);
    return "unchanged";
  }

  const packagePath = resolve(rootDirectory, "package.json");
  const lockPath = resolve(rootDirectory, "package-lock.json");
  const versionPath = resolve(rootDirectory, "src/version.ts");
  const contractsPath = resolve(rootDirectory, "src/export/contracts.ts");
  const packageJson = await readJson(packagePath, "package.json");
  const packageLock = await readJson(lockPath, "package-lock.json");
  const previousVersion = packageJson.version;
  if (typeof previousVersion !== "string" || !SEMVER.test(previousVersion) || compareSemVer(options.version, previousVersion) <= 0) throw new Error(`Release version must be greater than ${previousVersion}`);
  if (packageLock.version !== previousVersion || packageLock.packages?.[""]?.version !== previousVersion) throw new Error("Package and lockfile versions disagree before preparation");

  const postPath = resolve(rootDirectory, `content/updates/${slug}.md`);
  const inventoryPath = resolve(rootDirectory, `content/updates/release-review-v${options.version}.json`);
  if (await pathExists(postPath)) throw new Error(`Refusing to overwrite existing prose: content/updates/${slug}.md`);
  if (await pathExists(inventoryPath)) throw new Error(`Refusing to overwrite existing review inventory: content/updates/release-review-v${options.version}.json`);

  const versionSource = await readFile(versionPath, "utf8");
  const contractsSource = await readFile(contractsPath, "utf8");
  if (!versionSource.includes(`"${previousVersion}"`) || !contractsSource.includes(`version: "${previousVersion}"`)) throw new Error("Centralized version contracts disagree before preparation");
  packageJson.version = options.version;
  packageLock.version = options.version;
  packageLock.packages[""].version = options.version;

  const entry = {
    kind: "release",
    slug,
    title: options.title,
    summary: `Release ${options.version} notes prepared for editorial review.`,
    status: "draft",
    date: options.date,
    author: "Ryan Joseph Kamp",
    tags: ["release", classifyRelease(options.version)],
    relatedPrs: [],
    markdownPath: `content/updates/${slug}.md`,
    version: options.version,
    classification: classifyRelease(options.version),
    visualChanges: false,
    video: { policy: "exempt", exemptionReason: "This initial scaffold declares no visual behavior change; update the declaration and add release media before publishing if the interface changes." },
  };
  const nextEntries = ledger.entries.map((candidate) => candidate.kind === "release" && candidate.status === "current" ? { ...candidate, status: "published" } : candidate);
  const nextLedger = { ...ledger, entries: [...nextEntries, entry] };
  const inventory = { schemaVersion: 1, version: options.version, previousVersion, classification: entry.classification, generatedFrom: "local-git-history", commits };
  const nextVersionSource = versionSource.replaceAll(`"${previousVersion}"`, `"${options.version}"`);
  const nextContractsSource = contractsSource.replaceAll(`version: "${previousVersion}"`, `version: "${options.version}"`);
  await publishAuthoringTransaction(rootDirectory, [
    { path: postPath, bytes: journalScaffold(options.title, "release") },
    { path: inventoryPath, bytes: jsonBytes(inventory) },
    { path: packagePath, bytes: jsonBytes(packageJson) },
    { path: lockPath, bytes: jsonBytes(packageLock) },
    { path: versionPath, bytes: nextVersionSource },
    { path: contractsPath, bytes: nextContractsSource },
    { path: resolve(rootDirectory, "content/updates/releases.json"), bytes: jsonBytes(nextLedger) },
  ], async (staged) => {
    const stagedLedger = validateReleaseLedger(JSON.parse(await readFile(staged.get(resolve(rootDirectory, "content/updates/releases.json")), "utf8")));
    const stagedPost = await readFile(staged.get(postPath), "utf8");
    const problem = markdownProblem(stagedPost, stagedLedger.entries.at(-1));
    if (problem) throw new Error(`Invalid staged Markdown: ${problem}`);
    const stagedPackage = await readJson(staged.get(packagePath), "staged package.json");
    const stagedLock = await readJson(staged.get(lockPath), "staged package-lock.json");
    if (stagedPackage.version !== options.version || stagedLock.version !== options.version || stagedLock.packages?.[""]?.version !== options.version) throw new Error("Staged package versions disagree");
    const stagedContracts = readSourceContracts(await readFile(staged.get(versionPath), "utf8"), await readFile(staged.get(contractsPath), "utf8"));
    if (stagedContracts.assertedVersion !== options.version || stagedContracts.comparedVersion !== options.version || stagedContracts.packageVersion !== options.version) throw new Error("Staged version contracts disagree");
    const stagedInventory = await readJson(staged.get(inventoryPath), "staged release inventory");
    if (stagedInventory.version !== options.version || stagedInventory.previousVersion !== previousVersion || stagedInventory.commits.length !== commits.length) throw new Error("Staged release inventory disagrees with local Git history");
  }, transactionHooks);
  return "created";
}
