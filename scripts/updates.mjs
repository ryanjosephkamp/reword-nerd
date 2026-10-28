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
  readFileSync(join(root, "src/styles/tokens.css"), "utf8"),
  readFileSync(join(root, "scripts/updates.css"), "utf8"),
].join("\n");

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
<script>try{var t=localStorage.getItem("reword-nerd:theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}</script>
<style>${styles}</style>
</head>
<body>
<header class="top"><a class="brand" href="${base}"><span class="mark">rn</span> reword<span class="accent">_</span>nerd</a><a class="open" href="${base}app/">Open the app</a></header>
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
