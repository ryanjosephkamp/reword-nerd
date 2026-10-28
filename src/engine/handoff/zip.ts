// Writes ZIP files in the browser. The ZIP library loads only when a package is built.

export interface ZipEntry {
  path: string;
  data: Blob | string;
}

export async function makeZip(entries: readonly ZipEntry[]): Promise<Blob> {
  const { BlobReader, BlobWriter, TextReader, ZipWriter } = await import("@zip.js/zip.js");
  const writer = new ZipWriter(new BlobWriter("application/zip"), { useWebWorkers: false });
  for (const entry of entries) {
    const reader =
      typeof entry.data === "string" ? new TextReader(entry.data) : new BlobReader(entry.data);
    await writer.add(entry.path, reader);
  }
  return writer.close();
}

/** Reads every file in a ZIP the user drops back in (for example an agent's output folder). */
export async function readZip(blob: Blob): Promise<{ path: string; data: Blob }[]> {
  const { BlobReader, BlobWriter, ZipReader } = await import("@zip.js/zip.js");
  const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
  try {
    const files: { path: string; data: Blob }[] = [];
    for (const entry of await reader.getEntries()) {
      if (entry.directory) continue;
      files.push({ path: entry.filename, data: await entry.getData(new BlobWriter()) });
    }
    return files;
  } finally {
    await reader.close();
  }
}
