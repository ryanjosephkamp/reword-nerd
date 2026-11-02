// Renders content/updates/*.md into dist/updates: an index, one page per post, and an RSS feed.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";
import { base, dist, escapeHtml, origin, page, root } from "./shell.mjs";

const out = join(dist, "updates");

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

function longDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
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
