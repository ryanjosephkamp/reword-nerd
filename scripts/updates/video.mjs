#!/usr/bin/env node
import { parseNamedArguments, runCommand } from "./cli.mjs";
import { renderReleaseMedia } from "./video-lib.mjs";

await runCommand(async () => {
  const { version } = parseNamedArguments(process.argv.slice(2), ["version"]);
  const result = await renderReleaseMedia(process.cwd(), version);
  return `Rendered release media for v${version}: MP4 ${result.mp4.bytes} bytes, WebM ${result.webm.bytes} bytes, poster ${result.poster.bytes} bytes.`;
});
