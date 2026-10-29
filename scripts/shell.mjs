// The page shell shared by the pages built after `vite build`: Updates, the not-found page, and
// redirects from old addresses. Uses the built landing script and font, so run it after a build.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const root = resolve(import.meta.dirname, "..");
export const dist = join(root, "dist");
export const base = process.env.VITE_BASE_PATH || "/";
export const origin = "https://ryanjosephkamp.github.io";

export function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

export function page(title, description, body, head = "") {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
${head}<meta name="color-scheme" content="dark light">
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
