#!/usr/bin/env node
import { renderImageQuickStartMedia } from "./image-quick-start-lib.mjs";

try {
  const result = await renderImageQuickStartMedia(process.cwd());
  process.stdout.write(`Rendered Image Quick Start: MP4 ${result.mp4.bytes} bytes, WebM ${result.webm.bytes} bytes, poster ${result.poster.bytes} bytes.\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
