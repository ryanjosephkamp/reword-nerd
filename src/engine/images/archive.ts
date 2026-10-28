// Reads a ZIP (Word files are ZIPs too) without trusting what it says about itself: every
// entry's name and size is checked before anything is unpacked, and unpacked bytes are
// counted as they arrive.
import { ImageReadError, type ImageProblem } from "./errors";
import { IMAGE_LIMITS } from "./limits";
import { tooLargeFileReason } from "./validate";

export interface ZipEntry {
  path: string;
  directory: boolean;
  encrypted: boolean;
  compressedSize: number;
  uncompressedSize: number;
  unixMode: number | null;
  read(writable: WritableStream<Uint8Array>, signal?: AbortSignal): Promise<void>;
}

export interface ZipArchive {
  entries(signal?: AbortSignal): AsyncIterable<ZipEntry>;
  close(): Promise<void>;
}

export type ZipOpener = (source: Blob) => Promise<ZipArchive>;

/** Bytes still allowed to be unpacked, shared by a ZIP and any Word file inside it. */
export interface UnpackBudget {
  remaining: number;
}

export function createUnpackBudget(): UnpackBudget {
  return { remaining: IMAGE_LIMITS.maxArchiveExpandedBytes };
}

export interface ArchiveFile {
  path: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export interface ArchiveSkip {
  path: string;
  reason: string;
  problem: ImageProblem;
}

export interface ArchiveContents {
  /** Unpacked files, sorted by path. */
  files: ArchiveFile[];
  /** Files that were wanted but not unpacked, with the reason. */
  skipped: ArchiveSkip[];
  /** Paths of files that weren't wanted. */
  others: string[];
}

export interface ReadArchiveOptions {
  open: ZipOpener;
  budget: UnpackBudget;
  /** The largest size to unpack for a path, or null to leave that file packed. */
  limitFor: (path: string) => number | null;
  /** How messages name the archive, such as "ZIP file" or "Word file". */
  label: string;
  signal?: AbortSignal;
}

const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const MAX_PATH_BYTES = 1_024;
const MAX_SEGMENT_BYTES = 255;

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
  });
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Returns the path in a standard form, or null when it could escape its folder or can't
 * be written on every common file system (the files may be saved back out later).
 */
export function safeArchivePath(rawPath: string, directory = false): string | null {
  const trimmed = directory && rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
  const path = trimmed.normalize("NFC");
  if (
    !path ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/u.test(path) ||
    byteLength(path) > MAX_PATH_BYTES
  ) {
    return null;
  }
  const unsafeSegment = path
    .split("/")
    .some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        hasControlCharacter(segment) ||
        segment.includes(":") ||
        /[. ]$/u.test(segment) ||
        WINDOWS_RESERVED.test(segment) ||
        byteLength(segment) > MAX_SEGMENT_BYTES,
    );
  return unsafeSegment ? null : path;
}

interface PathRecord {
  path: string;
  /** Case- and compatibility-folded, as Windows and macOS compare names. */
  folded: string;
  directory: boolean;
}

function pathsClash(left: PathRecord, right: PathRecord): boolean {
  if (left.folded === right.folded) return true;
  // A file can't also be a folder that holds other files.
  return (
    (!left.directory && right.folded.startsWith(`${left.folded}/`)) ||
    (!right.directory && left.folded.startsWith(`${right.folded}/`))
  );
}

function isSymlink(mode: number | null): boolean {
  return mode !== null && (mode & 0o170000) === 0o120000;
}

interface Candidate {
  entry: ZipEntry;
  path: string;
}

async function unpack(
  { entry, path }: Candidate,
  damaged: () => ImageReadError,
  signal?: AbortSignal,
): Promise<ArchiveFile> {
  const expected = entry.uncompressedSize;
  const bytes = new Uint8Array(expected);
  let written = 0;
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      signal?.throwIfAborted();
      // Check the length before copying so a lying entry can't grow past its stated size.
      const length = chunk?.byteLength;
      if (!Number.isSafeInteger(length) || written + length > expected) throw damaged();
      bytes.set(chunk, written);
      written += length;
    },
  });
  await entry.read(writable, signal);
  if (written !== expected) throw damaged();
  return { path, bytes };
}

export async function readArchive(
  source: Blob,
  options: ReadArchiveOptions,
): Promise<ArchiveContents> {
  const { label, signal } = options;
  const damaged = () => new ImageReadError(`This ${label} is damaged and couldn't be opened.`);
  let archive: ZipArchive;
  try {
    archive = await options.open(source);
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof ImageReadError) throw error;
    throw new ImageReadError(`This ${label} couldn't be opened. It may be damaged.`);
  }
  try {
    const records: PathRecord[] = [];
    const candidates: Candidate[] = [];
    const contents: ArchiveContents = { files: [], skipped: [], others: [] };
    let count = 0;
    try {
      for await (const entry of archive.entries(signal)) {
        signal?.throwIfAborted();
        count += 1;
        if (count > IMAGE_LIMITS.maxArchiveEntries) {
          throw new ImageReadError(
            `This ${label} holds more than ${IMAGE_LIMITS.maxArchiveEntries} files, ` +
              "which is more than can be opened at once. Split it into smaller ones.",
          );
        }
        const path = safeArchivePath(entry.path, entry.directory);
        if (!path) {
          throw new ImageReadError(
            `This ${label} contains a file with an unsafe name (${entry.path}), ` +
              "so it wasn't opened.",
          );
        }
        const record = {
          path,
          folded: path.normalize("NFKC").toLowerCase(),
          directory: entry.directory,
        };
        if (records.some((existing) => pathsClash(existing, record))) {
          throw new ImageReadError(
            `This ${label} contains files whose names clash (${path}), so it wasn't opened.`,
          );
        }
        records.push(record);
        if (isSymlink(entry.unixMode)) {
          throw new ImageReadError(
            `This ${label} contains a link to another file (${path}), which isn't allowed.`,
          );
        }
        const { compressedSize, uncompressedSize } = entry;
        if (
          !Number.isSafeInteger(compressedSize) ||
          !Number.isSafeInteger(uncompressedSize) ||
          compressedSize < 0 ||
          uncompressedSize < 0 ||
          (uncompressedSize > 0 && compressedSize === 0)
        ) {
          throw damaged();
        }
        if (entry.directory) continue;
        const limit = options.limitFor(path);
        if (limit === null) {
          contents.others.push(path);
          continue;
        }
        if (entry.encrypted) {
          throw new ImageReadError(
            `This ${label} is password-protected. Remove the password and add it again.`,
          );
        }
        if (uncompressedSize > limit) {
          contents.skipped.push({
            path,
            reason: tooLargeFileReason(uncompressedSize, limit),
            problem: "too-large",
          });
        } else if (
          uncompressedSize / Math.max(1, compressedSize) >
          IMAGE_LIMITS.maxCompressionRatio
        ) {
          contents.skipped.push({
            path,
            reason: "This file unpacks to far more than its stored size, so it wasn't opened.",
            problem: "unreadable",
          });
        } else {
          candidates.push({ entry, path });
        }
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof ImageReadError) throw error;
      throw damaged();
    }

    candidates.sort((left, right) => compareText(left.path, right.path));
    for (const candidate of candidates) {
      const size = candidate.entry.uncompressedSize;
      if (size > options.budget.remaining) {
        contents.skipped.push({
          path: candidate.path,
          reason:
            "Left out because everything unpacked from this file would pass " +
            `${IMAGE_LIMITS.maxArchiveExpandedBytes / (1024 * 1024)} MB.`,
          problem: "too-large",
        });
        continue;
      }
      options.budget.remaining -= size;
      try {
        contents.files.push(await unpack(candidate, damaged, signal));
      } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof ImageReadError) throw error;
        throw damaged();
      }
    }
    return contents;
  } finally {
    await archive.close().catch(() => undefined);
  }
}

/** Sorts by code point so the order is the same in every browser and locale. */
export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Opens a ZIP with zip.js, loaded only when a ZIP or Word file is first read. */
export async function openZipArchive(source: Blob): Promise<ZipArchive> {
  const { BlobReader, ZipReader } = await import("@zip.js/zip.js");
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
          unixMode: entry.unixMode ?? null,
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
