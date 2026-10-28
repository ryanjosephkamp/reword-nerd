// Renders content/updates/*.md into dist/updates: an index, one page per post, and an RSS feed.
// Runs after `vite build` so it can reuse the built font file.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { marked } from "marked";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const out = join(dist, "updates");
const base = process.env.VITE_BASE_PATH || "/";
const origin = "https://ryanjosephkamp.github.io";

function frontMatter(source) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source);
  if (!match) throw new Error("Each update needs front matter with a title, date, and summary.");
  const fields = Object.fromEntries(
    match[1].split("\n").map((line) => {
      const at = line.indexOf(":");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
  );
  for (const key of ["title", "date", "summary"]) {
    if (!fields[key]) throw new Error(`An update is missing its ${key}.`);
  }
  return { ...fields, body: match[2] };
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function longDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fontFace() {
  const assets = join(dist, "assets");
  if (!existsSync(assets)) return "";
  const file = readdirSync(assets).find((name) =>
    /^newsreader-latin-opsz-normal.*\.woff2$/.test(name),
  );
  return file
    ? `@font-face{font-family:"Newsreader Variable";font-style:normal;font-weight:200 800;font-display:swap;src:url(${base}assets/${file}) format("woff2-variations");}`
    : "";
}

const styles = [
  fontFace(),
  readFileSync(join(root, "src/styles/palettes.css"), "utf8"),
  readFileSync(join(root, "src/styles/tokens.css"), "utf8").replace(/^@import .*$/m, ""),
  readFileSync(join(root, "src/styles/appearance.css"), "utf8"),
  readFileSync(join(root, "scripts/updates.css"), "utf8"),
].join("\n");

// The landing page's script runs the appearance menu; these pages load the same file.
function landingScript() {
  const landing = join(dist, "index.html");
  if (!existsSync(landing)) return "";
  const match = /<script type="module" crossorigin src="([^"]+)"><\/script>/.exec(
    readFileSync(landing, "utf8"),
  );
  return match ? `<script type="module" crossorigin src="${match[1]}"></script>` : "";
}

const PALETTE_ICON =
  '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M200.77,53.89A103.27,103.27,0,0,0,128,24h-1.07A104,104,0,0,0,24,128c0,43,26.58,79.06,69.36,94.17A32,32,0,0,0,136,192a16,16,0,0,1,16-16h46.21a31.81,31.81,0,0,0,31.2-24.88,104.43,104.43,0,0,0,2.59-24A103.28,103.28,0,0,0,200.77,53.89Zm13,93.71A15.89,15.89,0,0,1,198.21,160H152a32,32,0,0,0-32,32,16,16,0,0,1-21.31,15.07C62.49,194.3,40,164,40,128a88,88,0,0,1,87.09-88h.9a88.35,88.35,0,0,1,88,87.25A88.86,88.86,0,0,1,213.81,147.6ZM140,76a12,12,0,1,1-12-12A12,12,0,0,1,140,76ZM96,100A12,12,0,1,1,84,88,12,12,0,0,1,96,100Zm0,56a12,12,0,1,1-12-12A12,12,0,0,1,96,156Zm88-56a12,12,0,1,1-12-12A12,12,0,0,1,184,100Z"/></svg>';

function page(title, description, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="color-scheme" content="dark light">
<link rel="icon" href="${base}brand/favicon.ico" sizes="any">
<link rel="alternate" type="application/rss+xml" title="reword_nerd updates" href="${base}updates/feed.xml">
<script>try{var d=document.documentElement,t=localStorage.getItem("reword-nerd:theme"),p=localStorage.getItem("reword-nerd:palette");if(t==="light"||t==="dark")d.dataset.theme=t;if(p&&/^[a-z]+$/.test(p))d.dataset.palette=p}catch(e){}</script>
<style>${styles}</style>
${landingScript()}
</head>
<body>
<header class="top"><a class="brand" href="${base}"><img class="mark" src="${base}brand/quill-96.webp" alt="" width="32" height="32"> reword<span class="accent">_</span>nerd</a><span class="actions"><button type="button" class="appearance-button" data-appearance aria-label="Appearance" title="Appearance">${PALETTE_ICON}</button><a class="open" href="${base}app/">Open the app</a></span></header>
<main>${body}</main>
<footer class="foot"><a href="${base}updates/">All updates</a><a href="${base}updates/feed.xml">RSS</a><a href="https://github.com/ryanjosephkamp/reword-nerd">Source on GitHub</a></footer>
</body>
</html>
`;
}

const posts = readdirSync(join(root, "content/updates"))
  .filter((name) => name.endsWith(".md"))
  .map((name) => ({
    slug: name.replace(/\.md$/, ""),
    ...frontMatter(readFileSync(join(root, "content/updates", name), "utf8")),
  }))
  .filter((post) => post.draft !== "true")
  .sort((a, b) => (a.date < b.date ? 1 : -1));

mkdirSync(out, { recursive: true });

for (const post of posts) {
  mkdirSync(join(out, post.slug), { recursive: true });
  const body = `<article class="post"><p class="date">${longDate(post.date)}</p><h1>${escapeHtml(post.title)}</h1>${marked.parse(post.body)}</article>`;
  writeFileSync(
    join(out, post.slug, "index.html"),
    page(`${post.title} · reword_nerd`, post.summary, body),
  );
}

const list = posts
  .map(
    (post) =>
      `<li><a href="${base}updates/${post.slug}/"><span class="date">${longDate(post.date)}</span><span class="title">${escapeHtml(post.title)}</span><span class="summary">${escapeHtml(post.summary)}</span></a></li>`,
  )
  .join("");
writeFileSync(
  join(out, "index.html"),
  page(
    "Updates · reword_nerd",
    "What changed in reword_nerd, release by release.",
    `<h1>Updates</h1><ul class="posts">${list}</ul>`,
  ),
);

const items = posts
  .map(
    (post) =>
      `<item><title>${escapeHtml(post.title)}</title><link>${origin}${base}updates/${post.slug}/</link><guid>${origin}${base}updates/${post.slug}/</guid><pubDate>${new Date(`${post.date}T12:00:00Z`).toUTCString()}</pubDate><description>${escapeHtml(post.summary)}</description></item>`,
  )
  .join("");
writeFileSync(
  join(out, "feed.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>reword_nerd updates</title><link>${origin}${base}updates/</link><description>What changed in reword_nerd, release by release.</description>${items}</channel></rss>\n`,
);

console.log(`Rendered ${posts.length} updates.`);
