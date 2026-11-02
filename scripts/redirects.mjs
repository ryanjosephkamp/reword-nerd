// Keeps old addresses working: the classic site's pages and the /preview/ site that came before
// 0.9 now point to their new homes. Also writes the not-found page, which sends any other old
// /preview/ address to the same page without the prefix.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { base, dist, escapeHtml, origin, page } from "./shell.mjs";

// Old path (relative to the site) → new path. A target without its own query keeps the old one,
// so /preview/app/?mode=images still opens Images.
const REDIRECTS = {
  "preview/": "",
  "preview/app/": "app/",
  "preview/image/": "app/?mode=images",
  "preview/updates/": "updates/",
  "image/": "app/?mode=images",
  "updates/road-to-v0-6/": "updates/earlier-releases/",
  "updates/v0-7-0/": "updates/earlier-releases/",
  "updates/v0-8-0/": "updates/earlier-releases/",
};

function redirectPage(target) {
  const href = `${base}${target}`;
  const keepQuery = target.includes("?") ? "" : "+location.search";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Moved · reword_nerd</title>
<meta name="robots" content="noindex">
<meta name="color-scheme" content="dark light">
<link rel="canonical" href="${origin}${escapeHtml(href)}">
<script>location.replace(${JSON.stringify(href)}${keepQuery}+location.hash)</script>
<meta http-equiv="refresh" content="0; url=${escapeHtml(href)}">
</head>
<body>
<p>This page moved to <a href="${escapeHtml(href)}">${escapeHtml(origin + href)}</a>.</p>
</body>
</html>
`;
}

for (const [from, to] of Object.entries(REDIRECTS)) {
  mkdirSync(join(dist, from), { recursive: true });
  writeFileSync(join(dist, from, "index.html"), redirectPage(to));
}

const preview = `${base}preview/`;
writeFileSync(
  join(dist, "404.html"),
  page(
    "Page not found · reword_nerd",
    "This page doesn't exist.",
    `<article class="post"><h1>Page not found</h1><p>Nothing lives at this address. Try the <a href="${base}">home page</a>, <a href="${base}app/">the app</a>, or <a href="${base}updates/">Updates</a>.</p></article>`,
    `<meta name="robots" content="noindex">
<script>if(location.pathname.startsWith(${JSON.stringify(preview)}))location.replace(${JSON.stringify(base)}+location.pathname.slice(${preview.length})+location.search+location.hash)</script>
`,
  ),
);

console.log(`Wrote ${Object.keys(REDIRECTS).length} redirects and the not-found page.`);
