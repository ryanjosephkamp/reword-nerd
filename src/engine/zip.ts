// Reads ZIP files (Word files are ZIPs too) without trusting what they say about themselves.
// Every entry's name is checked before anything is unpacked, each file's stated size and
// compression ratio are checked before it's unpacked, and unpacked bytes are counted as they
// arrive. Callers say which files they want, so nothing else is ever unpacked.
import { archivePath, clashReason, findClash, isSystemClutter, nameProblem } from "./paths";

/** A failure whose message is written for the person using the app. */
export class ZipReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipReadError";
  }
}

/** One entry as the ZIP library reports it. */
export interface RawZipEntry {
  path: string;
  directory: boolean;
  encrypted: boolean;
  compressedSize: number;
  uncompressedSize: number;
  unixMode: number | null;
  read(writable: WritableStream<Uint8Array>, signal?: AbortSignal): Promise<void>;
}

export interface ZipArchive {
  entries(signal?: AbortSignal): AsyncIterable<RawZipEntry>;
  close(): Promise<void>;
}

export type ZipOpener = (source: Blob) => Promise<ZipArchive>;

/** Opens a ZIP with zip.js, which loads only when a ZIP is first read. */
export async function openZipArchive(source: Blob): Promise<ZipArchive> {
  const { BlobReader, ZipReader } = await import("@zip.js/zip.js");
  // "strict" refuses archives whose two copies of an entry's details disagree, a trick that
  // makes different tools see different files.
  const reader = new ZipReader(new BlobReader(source), {
    useWebWorkers: false,
    strictness: "strict",
  });
  return {
    async *entries() {
      for await (const entry of reader.getEntriesGenerator()) {
        yield {
          path: entry.filename,
          directory: entry.directory,
          encrypted: entry.encrypted,
          compressedSize: entry.compressedSize,
          uncompressedSize: entry.uncompressedSize,
          unixMode: entry.unixMode ?? entry.unixExternalUpper ?? null,
          async read(writable, signal) {
            if (entry.directory) return;
            await entry.getData(writable, {
              checkSignature: true,
              checkOverlappingEntry: true,
              useWebWorkers: false,
              signal,
            });
          },
        };
      }
    },
    close: () => reader.close(),
  };
}

/** Above this size, a file unpacking to more than MAX_RATIO times its stored size is refused. */
export const RATIO_FLOOR_BYTES = 1024 * 1024;
export const MAX_RATIO = 100;

/** Bytes still allowed to be unpacked; one budget can be shared by several archives. */
export interface ZipBudget {
  remaining: number;
  /** The whole allowance, for messages. */
  readonly total: number;
}

export function createZipBudget(total: number): ZipBudget {
  return { remaining: total, total };
}

export type ZipSkipProblem =
  "too-large" | "expands" | "encrypted" | "link" | "damaged" | "over-budget";

export interface ZipSkip {
  path: string;
  problem: ZipSkipProblem;
  reason: string;
}

/** A file entry whose name passed the safety checks. */
export interface ZipFile {
  path: string;
  /** Stated unpacked size. */
  size: number;
  compressedSize: number;
}

export interface ZipListing {
  /** File entries in archive order, without folders or system clutter. */
  files: ZipFile[];
  /** Refuses the archive when the chosen files' names would clash or can't be unpacked. */
  checkNames(files: readonly ZipFile[]): void;
  /** Refuses the archive when the chosen files add up to far more than the ZIP itself. */
  checkExpansion(files: readonly ZipFile[]): void;
  /** Unpacks one file, or says why it wasn't. Unpacked bytes come out of the budget. */
  unpack(
    file: ZipFile,
    limit: number,
    budget: ZipBudget,
  ): Promise<Uint8Array<ArrayBuffer> | ZipSkip>;
  close(): Promise<void>;
}

export interface ListZipOptions {
  /** How messages name the archive, such as "ZIP file" or "Word file". */
  label: string;
  /** Entries beyond this many (folders included) make the archive too big to open. */
  maxEntries: number;
  open?: ZipOpener;
  signal?: AbortSignal;
}

const MB = 1024 * 1024;

function megabytes(bytes: number): string {
  return `${Math.max(1, Math.ceil(bytes / MB))} MB`;
}

function isLink(mode: number | null): boolean {
  return mode !== null && (mode & 0o170000) === 0o120000;
}

function hasPossibleSizes({ compressedSize, uncompressedSize }: RawZipEntry): boolean {
  return (
    Number.isSafeInteger(compressedSize) &&
    Number.isSafeInteger(uncompressedSize) &&
    compressedSize >= 0 &&
    uncompressedSize >= 0 &&
    !(uncompressedSize > 0 && compressedSize === 0)
  );
}

/** True for a large file that unpacks to far more than its stored size. */
export function expandsTooMuch({ size, compressedSize }: ZipFile): boolean {
  return size > RATIO_FLOOR_BYTES && size / Math.max(1, compressedSize) > MAX_RATIO;
}

function skip(path: string, problem: ZipSkipProblem, reason: string): ZipSkip {
  return { path, problem, reason };
}

const DAMAGED = "This file is damaged inside the ZIP and couldn't be unpacked.";
const WRONG_SIZE =
  "This file's contents don't match the size the ZIP lists, so it wasn't unpacked.";
const EXPANDS = "This file unpacks to far more than its stored size, so it wasn't unpacked.";

class SizeMismatch extends Error {}

async function unpackEntry(
  entry: RawZipEntry,
  signal: AbortSignal | undefined,
): Promise<Uint8Array<ArrayBuffer>> {
  const expected = entry.uncompressedSize;
  const bytes = new Uint8Array(expected);
  let written = 0;
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      signal?.throwIfAborted();
      // Checking the length before copying stops a lying entry from growing past its size.
      const length = chunk?.byteLength;
      if (!Number.isSafeInteger(length) || written + length > expected) throw new SizeMismatch();
      bytes.set(chunk, written);
      written += length;
    },
  });
  await entry.read(writable, signal);
  if (written !== expected) throw new SizeMismatch();
  return bytes;
}

/** Lists a ZIP's files, refusing it if any name could escape it or it has too many entries. */
export async function listZip(source: Blob, options: ListZipOptions): Promise<ZipListing> {
  const { label, signal } = options;
  let archive: ZipArchive;
  try {
    archive = await (options.open ?? openZipArchive)(source);
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof ZipReadError) throw error;
    throw new ZipReadError(`This ${label} couldn't be opened. It may be damaged.`);
  }
  try {
    const files: ZipFile[] = [];
    const entries = new Map<ZipFile, RawZipEntry>();
    let count = 0;
    try {
      // The generator reads one entry at a time, so a huge archive is refused early.
      for await (const entry of archive.entries(signal)) {
        signal?.throwIfAborted();
        count += 1;
        if (count > options.maxEntries) {
          throw new ZipReadError(
            `This ${label} holds more than ${options.maxEntries.toLocaleString("en-US")} files, ` +
              "which is more than can be opened at once. Split it into smaller ones.",
          );
        }
        const path = archivePath(entry.path, entry.directory);
        if (path === null) {
          throw new ZipReadError(
            `This ${label} contains a file with an unsafe name (${entry.path}), so it wasn't opened.`,
          );
        }
        if (entry.directory || isSystemClutter(path)) continue;
        const file = { path, size: entry.uncompressedSize, compressedSize: entry.compressedSize };
        entries.set(file, entry);
        files.push(file);
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof ZipReadError) throw error;
      throw new ZipReadError(`This ${label} is damaged and couldn't be opened.`);
    }
    return listing(source, archive, files, entries, options);
  } catch (error) {
    await archive.close().catch(() => undefined);
    throw error;
  }
}

function listing(
  source: Blob,
  archive: ZipArchive,
  files: ZipFile[],
  entries: ReadonlyMap<ZipFile, RawZipEntry>,
  { label, signal }: ListZipOptions,
): ZipListing {
  return {
    files,

    checkNames(chosen) {
      for (const file of chosen) {
        const problem = nameProblem(file.path);
        if (problem) throw new ZipReadError(problem);
      }
      const clash = findClash(chosen.map((file) => file.path));
      if (clash) throw new ZipReadError(clashReason(clash, label));
    },

    checkExpansion(chosen) {
      const stated = chosen.reduce((total, file) => total + Math.max(0, file.size), 0);
      if (stated > MAX_RATIO * source.size + RATIO_FLOOR_BYTES) {
        throw new ZipReadError(
          `This ${label} unpacks to far more than its own size, so it wasn't opened.`,
        );
      }
    },

    async unpack(file, limit, budget) {
      signal?.throwIfAborted();
      const entry = entries.get(file);
      if (!entry) throw new Error("This file isn't from this ZIP.");
      const { path, size } = file;
      if (!hasPossibleSizes(entry)) return skip(path, "damaged", DAMAGED);
      if (entry.encrypted) return skip(path, "encrypted", "This file is password-protected.");
      if (isLink(entry.unixMode)) {
        return skip(path, "link", "This file is a link to another file, which isn't allowed.");
      }
      if (size > limit) {
        return skip(
          path,
          "too-large",
          `This file is ${megabytes(size)}; the limit is ${megabytes(limit)}.`,
        );
      }
      if (expandsTooMuch(file)) return skip(path, "expands", EXPANDS);
      if (size > budget.remaining) {
        return skip(
          path,
          "over-budget",
          `Left out because everything unpacked at once would pass ${megabytes(budget.total)}.`,
        );
      }
      budget.remaining -= size;
      try {
        return await unpackEntry(entry, signal);
      } catch (error) {
        signal?.throwIfAborted();
        budget.remaining += size;
        // zip.js reports a size that doesn't match the data as "Invalid uncompressed size".
        const wrongSize =
          error instanceof SizeMismatch ||
          (error instanceof Error && /uncompressed size/i.test(error.message));
        return skip(path, "damaged", wrongSize ? WRONG_SIZE : DAMAGED);
      }
    },

    close: () => archive.close().catch(() => undefined),
  };
}

export interface ReadZipOptions extends ListZipOptions {
  budget: ZipBudget;
  /** The largest size to unpack for a path, or null to leave that file packed. */
  limitFor: (path: string) => number | null;
}

export interface UnpackedFile {
  path: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export interface ZipContents {
  /** Unpacked files in path order; empty when `onFile` takes them instead. */
  files: UnpackedFile[];
  /** Files that were wanted but not unpacked, with the reason. */
  skipped: ZipSkip[];
  /** Paths of files that weren't wanted. */
  others: string[];
}

/** Sorts by code point so the order is the same in every browser and locale. */
export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Unpacks the files `limitFor` wants, in path order. With `onFile`, each file is handed over
 * as soon as it's unpacked and not kept, so only one is in memory at a time.
 */
export async function readZip(
  source: Blob,
  options: ReadZipOptions,
  onFile?: (file: UnpackedFile) => Promise<void>,
): Promise<ZipContents> {
  const zip = await listZip(source, options);
  try {
    const contents: ZipContents = { files: [], skipped: [], others: [] };
    const wanted: { file: ZipFile; limit: number }[] = [];
    for (const file of zip.files) {
      const limit = options.limitFor(file.path);
      if (limit === null) contents.others.push(file.path);
      else wanted.push({ file, limit });
    }
    zip.checkNames(wanted.map(({ file }) => file));
    // Files that will be skipped for their size don't count toward what the ZIP unpacks to.
    zip.checkExpansion(
      wanted
        .filter(({ file, limit }) => file.size <= limit && !expandsTooMuch(file))
        .map(({ file }) => file),
    );
    wanted.sort((left, right) => compareText(left.file.path, right.file.path));
    for (const { file, limit } of wanted) {
      const result = await zip.unpack(file, limit, options.budget);
      if (!(result instanceof Uint8Array)) contents.skipped.push(result);
      else if (onFile) await onFile({ path: file.path, bytes: result });
      else contents.files.push({ path: file.path, bytes: result });
    }
    return contents;
  } finally {
    await zip.close();
  }
}
