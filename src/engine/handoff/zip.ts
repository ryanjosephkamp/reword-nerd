// Writes ZIP files in the browser, and reads back the ones people return (a saved workspace,
// or an agent's finished task folder). The ZIP library loads only when one is needed.
import { quotePath } from "../paths";
import { createZipBudget, readZip as readZipFiles, ZipReadError, type ZipOpener } from "../zip";

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

const MB = 1024 * 1024;

/** A saved workspace holds every original file, so these are generous; bombs are still refused. */
export const RETURNED_ZIP_LIMITS = {
  maxEntries: 20_000,
  maxFileBytes: 250 * MB,
  maxTotalBytes: 1024 * MB,
} as const;

/** The parts of a workspace file: its index and the files it refers to. */
export function isWorkspacePart(path: string): boolean {
  return path === "workspace.json" || /^files\/\d+$/.test(path);
}

/** The task folder's inputs, which an agent doesn't change and which can be large. */
const TASK_INPUT_FOLDERS = new Set(["source", "text", "work", "assets"]);

/**
 * Files an agent may have written: anything in output/ and the report, plus loose files
 * when someone zipped the results alone. The task's own input folders are left packed.
 */
export function isAgentResultPath(path: string): boolean {
  const folders = path.split("/").slice(0, -1);
  if (folders.includes("output") || /(?:^|\/)REPORT\.md$/i.test(path)) return true;
  // The task folder may sit inside one folder named after the task.
  return !folders.slice(0, 2).some((folder) => TASK_INPUT_FOLDERS.has(folder));
}

export interface ReadReturnedZipOptions {
  /** True for the files to unpack; nothing else is unpacked. */
  want: (path: string) => boolean;
  open?: ZipOpener;
  signal?: AbortSignal;
}

/**
 * Reads the wanted files from a ZIP someone hands back. Refuses the whole ZIP, with a
 * reason written for them, if any wanted file can't be unpacked safely.
 */
export async function readZip(
  blob: Blob,
  { want, open, signal }: ReadReturnedZipOptions,
): Promise<{ path: string; data: Blob }[]> {
  const files: { path: string; data: Blob }[] = [];
  const contents = await readZipFiles(
    blob,
    {
      label: "ZIP file",
      maxEntries: RETURNED_ZIP_LIMITS.maxEntries,
      budget: createZipBudget(RETURNED_ZIP_LIMITS.maxTotalBytes),
      limitFor: (path) => (want(path) ? RETURNED_ZIP_LIMITS.maxFileBytes : null),
      open,
      signal,
    },
    // Each file becomes a Blob as soon as it's unpacked, so its bytes aren't held twice.
    async ({ path, bytes }) => {
      files.push({ path, data: new Blob([bytes]) });
    },
  );
  const [skipped] = contents.skipped;
  if (skipped) {
    throw new ZipReadError(
      `${quotePath(skipped.path)} in this ZIP wasn't opened. ${skipped.reason}`,
    );
  }
  return files;
}

export { ZipReadError } from "../zip";
