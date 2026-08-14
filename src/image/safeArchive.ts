import { BlobReader, ZipReader, configure, type Entry } from "@zip.js/zip.js";

import {
  MAX_IMAGE_ARCHIVE_ENTRIES,
  MAX_IMAGE_ARCHIVE_EXPANDED_BYTES,
  MAX_IMAGE_ARCHIVE_RATIO,
  MAX_IMAGE_INPUT_BYTES,
  MAX_IMAGE_PATH_BYTES,
  MAX_IMAGE_PATH_SEGMENT_BYTES,
  ImageIntakeFailure,
  failImageIntake,
} from "./intakeContracts";

const ZIP_CHUNK_SIZE = 64 * 1024;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

// Pin the locked zip.js codec stream to the same bounded size as its current default.
// This is global by zip.js design and therefore also preserves the pre-existing Text value.
configure({ chunkSize: ZIP_CHUNK_SIZE });

export interface ExpandedByteBudget {
  readonly maximumBytes: number;
  readonly usedBytes: number;
  consume(byteCount: number): void;
}

export function createExpandedByteBudget(
  maximumBytes = MAX_IMAGE_ARCHIVE_EXPANDED_BYTES,
): ExpandedByteBudget {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    failImageIntake("ARCHIVE_EXPANDED_SIZE_EXCEEDED");
  }
  let usedBytes = 0;
  return {
    maximumBytes,
    get usedBytes() { return usedBytes; },
    consume(byteCount) {
      if (!Number.isSafeInteger(byteCount)
        || byteCount < 0
        || usedBytes + byteCount > maximumBytes) {
        failImageIntake("ARCHIVE_EXPANDED_SIZE_EXCEEDED");
      }
      usedBytes += byteCount;
    },
  };
}

export interface ArchiveEntryAdapter {
  readonly path: string;
  readonly directory: boolean;
  readonly encrypted: boolean;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly unixMode: number | null;
  read(writable: WritableStream<Uint8Array>, signal?: AbortSignal): Promise<void>;
}

export interface ArchiveReaderAdapter {
  entries(signal?: AbortSignal): AsyncIterable<ArchiveEntryAdapter>;
  close(): Promise<void>;
}

export interface SafeArchiveEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
}

export interface SafeArchiveResult {
  readonly entries: readonly SafeArchiveEntry[];
  readonly expandedBytes: number;
}

export interface ReadSafeArchiveOptions {
  readonly open?: (source: Blob) => Promise<ArchiveReaderAdapter>;
  readonly budget?: ExpandedByteBudget;
  readonly signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Archive read cancelled.", "AbortError");
}

function isSymlinkMode(mode: number | null): boolean {
  return mode !== null && (mode & 0o170000) === 0o120000;
}

function hasControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
  });
}

export function normalizeImageArchivePath(rawPath: string, directory = false): string {
  const withoutDirectorySlash = directory && rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
  const normalized = withoutDirectorySlash.normalize("NFC");
  if (!normalized
    || normalized.includes("\\")
    || normalized.startsWith("/")
    || /^[A-Za-z]:/u.test(normalized)
    || new TextEncoder().encode(normalized).byteLength > MAX_IMAGE_PATH_BYTES) {
    failImageIntake("UNSAFE_PATH");
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment
    || segment === "."
    || segment === ".."
    || hasControl(segment)
    || segment.includes(":")
    || /[. ]$/u.test(segment)
    || WINDOWS_RESERVED.test(segment)
    || new TextEncoder().encode(segment).byteLength > MAX_IMAGE_PATH_SEGMENT_BYTES)) {
    failImageIntake("UNSAFE_PATH");
  }
  return normalized;
}

function portabilityKey(path: string): string {
  return path.normalize("NFKC").toLowerCase();
}

function pathsConflict(
  left: { path: string; portable: string; directory: boolean },
  right: { path: string; portable: string; directory: boolean },
): boolean {
  return left.path === right.path
    || left.portable === right.portable
    || (!left.directory && right.path.startsWith(`${left.path}/`))
    || (!right.directory && left.path.startsWith(`${right.path}/`))
    || (!left.directory && right.portable.startsWith(`${left.portable}/`))
    || (!right.directory && left.portable.startsWith(`${right.portable}/`));
}

function hasZipSignature(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && ((bytes[2] === 0x03 && bytes[3] === 0x04)
      || (bytes[2] === 0x05 && bytes[3] === 0x06)
      || (bytes[2] === 0x07 && bytes[3] === 0x08));
}

async function openZipJsArchive(source: Blob): Promise<ArchiveReaderAdapter> {
  const reader = new ZipReader(new BlobReader(source), {
    strictness: "strict",
    useWebWorkers: false,
  });
  return {
    async *entries(signal) {
      for await (const entry of reader.getEntriesGenerator({ strictness: "strict" })) {
        throwIfAborted(signal);
        const file = entry as Entry;
        yield {
          path: file.filename,
          directory: file.directory,
          encrypted: file.encrypted,
          compressedSize: file.compressedSize,
          uncompressedSize: file.uncompressedSize,
          unixMode: file.unixMode ?? file.unixExternalUpper ?? null,
          read: async (writable, readSignal) => {
            if (file.directory) return;
            await file.getData(writable, {
              checkSignature: true,
              strictness: "strict",
              useWebWorkers: false,
              signal: readSignal,
            });
          },
        };
      }
    },
    close: () => reader.close(),
  };
}

interface AuditedEntry {
  readonly entry: ArchiveEntryAdapter;
  readonly path: string;
}

function comparePaths(left: AuditedEntry, right: AuditedEntry): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

async function extractBoundedEntry(
  audited: AuditedEntry,
  budget: ExpandedByteBudget,
  signal?: AbortSignal,
): Promise<SafeArchiveEntry> {
  const chunks: Uint8Array[] = [];
  let actualBytes = 0;
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      throwIfAborted(signal);
      const chunkByteLength = chunk?.byteLength;
      if (!Number.isSafeInteger(chunkByteLength)
        || chunkByteLength < 0
        || actualBytes + chunkByteLength > audited.entry.uncompressedSize) {
        failImageIntake("ARCHIVE_LENGTH_MISMATCH", audited.path);
      }
      budget.consume(chunkByteLength);
      const owned = Uint8Array.from(chunk);
      chunks.push(owned);
      actualBytes += chunkByteLength;
    },
  });
  await audited.entry.read(writable, signal);
  if (actualBytes !== audited.entry.uncompressedSize) {
    failImageIntake("ARCHIVE_LENGTH_MISMATCH", audited.path);
  }
  const bytes = new Uint8Array(actualBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return Object.freeze({
    path: audited.path,
    bytes,
    compressedSize: audited.entry.compressedSize,
    uncompressedSize: audited.entry.uncompressedSize,
  });
}

export async function readSafeArchive(
  source: Blob,
  options: ReadSafeArchiveOptions = {},
): Promise<SafeArchiveResult> {
  if (!Number.isSafeInteger(source.size) || source.size < 1 || source.size > MAX_IMAGE_INPUT_BYTES) {
    failImageIntake("INPUT_SIZE_INVALID");
  }
  const budget = options.budget ?? createExpandedByteBudget();
  const startUsedBytes = budget.usedBytes;
  let reader: ArchiveReaderAdapter;
  try {
    reader = await (options.open ?? openZipJsArchive)(source);
  } catch (error) {
    if (error instanceof ImageIntakeFailure || error instanceof DOMException && error.name === "AbortError") throw error;
    failImageIntake("MALFORMED_ZIP");
  }
  try {
    const audited: AuditedEntry[] = [];
    const pathRecords: Array<{ path: string; portable: string; directory: boolean }> = [];
    let metadataCount = 0;
    let declaredExpandedBytes = 0;
    const availableExpandedBytes = budget.maximumBytes - budget.usedBytes;
    try {
      for await (const entry of reader.entries(options.signal)) {
        throwIfAborted(options.signal);
        metadataCount += 1;
        if (metadataCount > MAX_IMAGE_ARCHIVE_ENTRIES) failImageIntake("ARCHIVE_ENTRY_COUNT_EXCEEDED");
        const path = normalizeImageArchivePath(entry.path, entry.directory);
        const portable = portabilityKey(path);
        const pathRecord = { path, portable, directory: entry.directory };
        if (pathRecords.some((existing) => pathsConflict(existing, pathRecord))) {
          failImageIntake("PATH_COLLISION", path);
        }
        pathRecords.push(pathRecord);
        if (entry.encrypted) failImageIntake("ENCRYPTED_ENTRY", path);
        if (isSymlinkMode(entry.unixMode)) failImageIntake("LINK_ENTRY_UNSUPPORTED", path);
        if (!Number.isSafeInteger(entry.uncompressedSize)
          || !Number.isSafeInteger(entry.compressedSize)
          || entry.uncompressedSize < 0
          || entry.compressedSize < 0) failImageIntake("MALFORMED_ZIP", path);
        if (entry.uncompressedSize > 0 && entry.compressedSize === 0) failImageIntake("MALFORMED_ZIP", path);
        if (entry.uncompressedSize > MAX_IMAGE_INPUT_BYTES) failImageIntake("ARCHIVE_ENTRY_SIZE_EXCEEDED", path);
        declaredExpandedBytes += entry.uncompressedSize;
        if (!Number.isSafeInteger(declaredExpandedBytes)
          || declaredExpandedBytes > MAX_IMAGE_ARCHIVE_EXPANDED_BYTES
          || declaredExpandedBytes > availableExpandedBytes) {
          failImageIntake("ARCHIVE_EXPANDED_SIZE_EXCEEDED");
        }
        const ratio = entry.uncompressedSize === 0
          ? 0
          : entry.uncompressedSize / Math.max(1, entry.compressedSize);
        if (ratio > MAX_IMAGE_ARCHIVE_RATIO) failImageIntake("ARCHIVE_COMPRESSION_RATIO_EXCEEDED", path);
        if (!entry.directory && path.toLowerCase().endsWith(".zip")) {
          failImageIntake("NESTED_ARCHIVE", path);
        }
        if (!entry.directory) audited.push({ entry, path });
      }
    } catch (error) {
      if (error instanceof ImageIntakeFailure || error instanceof DOMException && error.name === "AbortError") throw error;
      failImageIntake("MALFORMED_ZIP");
    }

    const entries: SafeArchiveEntry[] = [];
    for (const entry of audited.sort(comparePaths)) {
      try {
        const extracted = await extractBoundedEntry(entry, budget, options.signal);
        if (hasZipSignature(extracted.bytes) && !entry.path.toLowerCase().endsWith(".docx")) {
          failImageIntake("NESTED_ARCHIVE", entry.path);
        }
        entries.push(extracted);
      } catch (error) {
        if (error instanceof ImageIntakeFailure || error instanceof DOMException && error.name === "AbortError") throw error;
        failImageIntake("MALFORMED_ZIP", entry.path);
      }
    }
    return Object.freeze({
      entries: Object.freeze(entries),
      expandedBytes: budget.usedBytes - startUsedBytes,
    });
  } finally {
    await reader.close().catch(() => undefined);
  }
}
