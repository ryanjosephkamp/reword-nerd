#!/usr/bin/env node
import { renderUpdates } from "./lib.mjs";
import { runCommand } from "./cli.mjs";

await runCommand(async () => {
  const slugs = await renderUpdates(process.cwd());
  return `Rendered Updates: archive, ${slugs.length} posts, RSS feed, and sitemap.`;
});
