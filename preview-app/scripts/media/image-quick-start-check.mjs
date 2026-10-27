#!/usr/bin/env node
import { checkImageQuickStartMedia } from "./image-quick-start-lib.mjs";

try {
  const result = await checkImageQuickStartMedia(process.cwd());
  process.stdout.write(`Image Quick Start media valid: MP4 ${result.mp4.bytes} bytes, WebM ${result.webm.bytes} bytes, poster ${result.poster.bytes} bytes, aggregate ${result.aggregateBytes} bytes.\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
