import { readFile } from "node:fs/promises";
import type { Download } from "@playwright/test";
import { BlobReader, BlobWriter, ZipReader } from "@zip.js/zip.js";

/** Lists the files in a downloaded ZIP with their text, for checking task folders. */
export async function zipContents(download: Download): Promise<Map<string, string>> {
  const path = await download.path();
  const bytes = await readFile(path);
  const reader = new ZipReader(new BlobReader(new Blob([bytes])));
  const files = new Map<string, string>();
  for (const entry of await reader.getEntries()) {
    if (entry.directory) continue;
    files.set(entry.filename, await (await entry.getData(new BlobWriter())).text());
  }
  await reader.close();
  return files;
}
