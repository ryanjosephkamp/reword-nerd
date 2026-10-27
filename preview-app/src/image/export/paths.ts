import type { ImageFileExtension } from "../contracts";
import { MAX_IMAGE_PATH_BYTES, MAX_IMAGE_PATH_SEGMENT_BYTES } from "../intakeContracts";

const PAIR_KEY_PATTERN = /^\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const encoder = new TextEncoder();

export function stableImageArchiveCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function imagePairKey(ordinal: number, sourceName: string): string {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > 100) {
    throw new Error("IMAGE_PAIR_ORDINAL_INVALID");
  }
  const trimmed = sourceName.trim();
  const extensionAt = trimmed.lastIndexOf(".");
  const stem = extensionAt > 0 ? trimmed.slice(0, extensionAt) : trimmed;
  const slug = stem
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^A-Za-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase()
    .slice(0, 48)
    .replace(/-+$/gu, "") || "image";
  return `${String(ordinal).padStart(3, "0")}-${slug}`;
}

export function isSafeImageArchivePath(path: string): boolean {
  if (!path
    || path !== path.normalize("NFC")
    || path.includes("\\")
    || path.startsWith("/")
    || encoder.encode(path).byteLength > MAX_IMAGE_PATH_BYTES) return false;
  if (/^[A-Za-z]:/u.test(path)) return false;
  if (Array.from(path).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  })) return false;
  return path.split("/").every((segment) => segment.length > 0
    && segment !== "."
    && segment !== ".."
    && encoder.encode(segment).byteLength <= MAX_IMAGE_PATH_SEGMENT_BYTES);
}

export interface ImagePairPaths {
  readonly source: string;
  readonly prompt: string;
  readonly runCard: string;
  readonly metadata: string;
  readonly openMe: string;
}

export function imagePairPaths(key: string, extension: ImageFileExtension): ImagePairPaths {
  if (!PAIR_KEY_PATTERN.test(key)) throw new Error("IMAGE_PAIR_KEY_INVALID");
  const base = `pairs/${key}`;
  const paths = {
    source: `${base}/source.${extension}`,
    prompt: `${base}/prompt.txt`,
    runCard: `${base}/run-card.md`,
    metadata: `${base}/metadata.json`,
    openMe: `${base}/OPEN-ME.html`,
  };
  if (!Object.values(paths).every(isSafeImageArchivePath)) throw new Error("IMAGE_ARCHIVE_PATH_INVALID");
  return Object.freeze(paths);
}

export function assertUniquePortableImageArchivePaths(paths: readonly string[]): void {
  const exact = new Set<string>();
  const portable = new Set<string>();
  for (const path of paths) {
    if (!isSafeImageArchivePath(path)) throw new Error("IMAGE_ARCHIVE_PATH_INVALID");
    const portabilityKey = path.normalize("NFC").toLocaleLowerCase("en-US");
    if (exact.has(path) || portable.has(portabilityKey)) throw new Error("IMAGE_ARCHIVE_PATH_COLLISION");
    exact.add(path);
    portable.add(portabilityKey);
  }
}
