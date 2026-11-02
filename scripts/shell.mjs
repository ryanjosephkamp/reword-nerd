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

const credit = `<div class="credit"><p class="made">Made by <a href="https://ryanjosephkamp.github.io/">Ryan Kamp</a></p><ul class="social" aria-label="Ryan Kamp online"><li><a href="https://ryanjosephkamp.github.io/" aria-label="Ryan Kamp’s website" title="Website"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.2"/><path d="M2.8 12h18.4M12 2.8c2.6 2.6 3.9 5.7 3.9 9.2s-1.3 6.6-3.9 9.2c-2.6-2.6-3.9-5.7-3.9-9.2S9.4 5.4 12 2.8Z"/></g></svg></a></li><li><a href="https://github.com/ryanjosephkamp/" aria-label="Ryan Kamp on GitHub" title="GitHub"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg></a></li><li><a href="https://www.linkedin.com/in/rjk1999" aria-label="Ryan Kamp on LinkedIn" title="LinkedIn"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg></a></li><li><a href="https://x.com/ryanjosephkamp" aria-label="Ryan Kamp on X" title="X"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg></a></li><li><a href="https://m.youtube.com/@RyanJosephKamp" aria-label="Ryan Kamp on YouTube" title="YouTube"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg></a></li></ul><a class="sponsor" href="https://github.com/sponsors/ryanjosephkamp"><svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 16.8S3 12.6 3 7.6A3.6 3.6 0 0 1 10 6a3.6 3.6 0 0 1 7 1.6c0 5-7 9.2-7 9.2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>Sponsor on GitHub</a></div>`;

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
<footer class="foot"><nav class="foot-links" aria-label="More"><a href="${base}updates/">All updates</a><a href="${base}updates/feed.xml">RSS</a><a href="https://github.com/ryanjosephkamp/reword-nerd">Source on GitHub</a></nav>${credit}</footer>
</body>
</html>
`;
}
