#!/usr/bin/env node
import { runCommand } from "./cli.mjs";
import { RELEASE_VIDEO_VERSIONS, checkReleaseMedia } from "./video-lib.mjs";

await runCommand(async () => {
  const results = [];
  for (const version of RELEASE_VIDEO_VERSIONS) {
    const result = await checkReleaseMedia(process.cwd(), version);
    results.push(`v${version}: MP4 ${result.mp4.bytes} bytes, WebM ${result.webm.bytes} bytes, poster ${result.poster.bytes} bytes, aggregate ${result.aggregateBytes} bytes`);
  }
  return `Release media valid — ${results.join("; ")}.`;
});
