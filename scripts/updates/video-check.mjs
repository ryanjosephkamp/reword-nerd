#!/usr/bin/env node
import { runCommand } from "./cli.mjs";
import { checkReleaseMedia } from "./video-lib.mjs";

await runCommand(async () => {
  const result = await checkReleaseMedia(process.cwd(), "0.7.0");
  return `Release media valid: MP4 ${result.mp4.bytes} bytes, WebM ${result.webm.bytes} bytes, poster ${result.poster.bytes} bytes, aggregate ${result.aggregateBytes} bytes.`;
});
