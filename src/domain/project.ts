import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader, type Entry } from "@zip.js/zip.js";
import createIgnore from "ignore";

import { hashBytes, type HashAdapter } from "./extraction";
import type { SettingsOverride } from "./settings";
import {
  classifyStandaloneTextName,
  decodeSafeStandaloneText,
  genericTextClassification,
  sourceExtension,
  type SourcePreviewKind,
} from "./sourceText";

export const MAX_PROJECT_ENTRIES = 500;
export const MAX_FOLDER_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRY_BYTES = 25 * 1024 * 1024;
export const MAX_PROJECT_BYTES = 100 * 1024 * 1024;
export const MAX_ZIP_CONTAINER_BYTES = 100 * 1024 * 1024;
export const MAX_PROJECT_ARCHIVE_RATIO = 100;
export const MAX_PROMPT_TEXT_FILES = 250;
export const MAX_PROMPT_DECODED_TEXT_BYTES = 5 * 1024 * 1024;

export type ProjectIssueCode =
  | "UNSAFE_PROJECT_PATH"
  | "PROJECT_PATH_COLLISION"
  | "NESTED_ARCHIVE"
  | "PROJECT_LIMIT_EXCEEDED"
  | "INVALID_PROJECT"
  | "SENSITIVE_ENTRY"
  | "INVALID_PROJECT_REVIEW";

const projectIssueMessages: Record<ProjectIssueCode, string> = {
  UNSAFE_PROJECT_PATH: "The project contains an unsafe or duplicate normalized path.",
  PROJECT_PATH_COLLISION: "The project contains paths that collide when letter case is ignored.",
  NESTED_ARCHIVE: "Nested archives are not supported in a project.",
  PROJECT_LIMIT_EXCEEDED: "The project exceeds a permitted local safety limit.",
  INVALID_PROJECT: "The project could not be read safely.",
  SENSITIVE_ENTRY: "Sensitive project entries cannot be included in prompts or exports.",
  INVALID_PROJECT_REVIEW: "Every prompt-included text file must contain valid reviewed text before confirmation.",
};

export class ProjectReadError extends Error {
  constructor(readonly code: ProjectIssueCode) {
    super(projectIssueMessages[code]);
    this.name = "ProjectReadError";
  }
}

export type ProjectSourceKind = "folder" | "zip";
export type ProjectClassification = "latex" | "general-text";
export type ProjectContentKind = "text" | "asset" | "invalid-text";
export type ProjectExclusionReason =
  | "gitignore"
  | "default-excluded"
  | "non-text-asset"
  | "invalid-text"
  | "prompt-limit"
  | null;

export interface FolderProjectInput {
  kind: "folder";
  name: string;
  files: readonly File[];
}

export interface ZipProjectInput {
  kind: "zip";
  name: string;
  bytes: Uint8Array;
}

export interface ProjectReadOptions {
  honorRootGitignore?: boolean;
  excludeDependenciesBuildGenerated?: boolean;
  preserveSafeNonTextAssets?: boolean;
  existingSessionBytes?: number;
  hasher?: HashAdapter | null;
}

export interface ProjectEntry {
  readonly path: string;
  readonly immutablePath: string;
  byteCount: number;
  originalHash: string;
  /** @deprecated Compatibility alias for originalHash. */
  sha256: string;
  originalBytes: Uint8Array;
  contentKind: ProjectContentKind;
  languageId: string | null;
  previewKind: SourcePreviewKind | null;
  reviewedText: string | null;
  reviewedTextHash: string | null;
  reviewRevision: number;
  promptIncluded: boolean;
  packageIncluded: boolean;
  exclusionReason: ProjectExclusionReason;
  restorable: boolean;
}

export interface WorkspaceProject {
  kind: "project";
  id: string;
  name: string;
  sourceKind: ProjectSourceKind;
  status: "needs-review" | "ready" | "blocked" | "error";
  entries: readonly ProjectEntry[];
  originalTreeHash: string;
  reviewedTreeHash: string;
  /** @deprecated Compatibility alias for originalTreeHash. */
  treeHash: string;
  totalByteCount: number;
  classification: ProjectClassification;
  classificationChoiceRequired: boolean;
  classificationChoices: readonly ProjectClassification[];
  rootDocument: string | null;
  selectedEntryPath: string | null;
  projectOperationGeneration: number;
  projectReviewRevision: number;
  requiresReview: boolean;
  warnings: readonly string[];
  sensitiveBlockedCounts: Readonly<{
    credentialFiles: number;
    privateKeys: number;
    clearCredentials: number;
  }>;
  intake: Readonly<{ kind: ProjectSourceKind; displayName: string }>;
  /** Immutable provenance for ZIP intake. Folder projects deliberately omit a fictitious container. */
  originalContainer?: Readonly<{ displayName: string; byteCount: number; sha256: string }>;
  settingsOverride: SettingsOverride;
  contextWarningAcknowledged: boolean;
}

export interface ProjectOperationToken {
  itemId: string;
  operationId: number;
  sessionGeneration: number;
}

export interface ProjectSnapshotToken extends ProjectOperationToken {
  projectReviewRevision: number;
}

export interface ProjectPromptFile {
  path: string;
  text: string;
  originalHash: string;
  reviewedTextHash: string;
  languageId: string;
  previewKind: SourcePreviewKind;
}

export interface ProjectPromptSnapshot extends ProjectSnapshotToken {
  originalTreeHash: string;
  reviewedTreeHash: string;
  classification: ProjectClassification;
  rootDocument: string | null;
  includedFiles: readonly ProjectPromptFile[];
  excludedPaths: readonly string[];
}

interface RawProjectEntry {
  path: string;
  bytes: Uint8Array;
}

const nestedArchiveExtensions = new Set([".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".rar", ".7z"]);
const defaultExcludedSegments = new Set([
  ".git", ".hg", ".svn", "node_modules", "bower_components", "vendor", "vendors",
  ".cache", "cache", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
  "dist", "build", "out", "target", "coverage", ".next", ".nuxt", ".svelte-kit", ".turbo",
  "generated", "gen",
]);
const lockFiles = new Set([
  "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb",
  "poetry.lock", "pipfile.lock", "cargo.lock", "gemfile.lock", "composer.lock",
]);
const credentialNames = new Set([
  ".env", ".npmrc", ".pypirc", ".netrc", "credentials", "credentials.json", "secrets.json",
  "secrets.yaml", "secrets.yml", "service-account.json", "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
]);
const credentialExtensions = new Set([".pem", ".key", ".p12", ".pfx", ".jks", ".keystore"]);
const windowsReservedNames = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function bytesBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function hasPathControl(segment: string): boolean {
  return Array.from(segment).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
  });
}

export function normalizeProjectPath(path: string): string {
  const normalized = path.normalize("NFC");
  if (!normalized
    || normalized.includes("\\")
    || normalized.startsWith("/")
    || /^[A-Za-z]:/u.test(normalized)) {
    throw new ProjectReadError("UNSAFE_PROJECT_PATH");
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment
    || segment === "."
    || segment === ".."
    || hasPathControl(segment)
    || segment.includes(":")
    || /[. ]$/u.test(segment)
    || windowsReservedNames.test(segment)
    || new TextEncoder().encode(segment).byteLength > 255)
    || new TextEncoder().encode(normalized).byteLength > 1_024) {
    throw new ProjectReadError("UNSAFE_PROJECT_PATH");
  }
  return normalized;
}

function portabilityKey(path: string): string {
  return path.normalize("NFKC").toLocaleLowerCase("und")
    .replaceAll("ß", "ss")
    .replaceAll("ς", "σ");
}

function folderRelativePath(file: File): string {
  const browserPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  const slash = browserPath.indexOf("/");
  return normalizeProjectPath(slash < 0 ? browserPath : browserPath.slice(slash + 1));
}

function assertSafePathSet(paths: readonly string[]): void {
  const exact = new Set<string>();
  const folded = new Set<string>();
  for (const path of paths) {
    if (exact.has(path)) throw new ProjectReadError("UNSAFE_PROJECT_PATH");
    exact.add(path);
    const caseFolded = portabilityKey(path);
    if (folded.has(caseFolded)) throw new ProjectReadError("PROJECT_PATH_COLLISION");
    folded.add(caseFolded);
    if (nestedArchiveExtensions.has(sourceExtension(path))) throw new ProjectReadError("NESTED_ARCHIVE");
  }
}

function validateSessionSize(totalBytes: number, existingSessionBytes: number): void {
  if (!Number.isSafeInteger(existingSessionBytes)
    || existingSessionBytes < 0
    || totalBytes > MAX_PROJECT_BYTES
    || existingSessionBytes + totalBytes > MAX_PROJECT_BYTES) {
    throw new ProjectReadError("PROJECT_LIMIT_EXCEEDED");
  }
}

function isZipSymlink(entry: Entry): boolean {
  const mode = entry.unixMode ?? entry.unixExternalUpper;
  return mode !== undefined && (mode & 0o170000) === 0o120000;
}

async function readZipEntries(input: ZipProjectInput, options: ProjectReadOptions): Promise<RawProjectEntry[]> {
  if (!Number.isSafeInteger(input.bytes.byteLength) || input.bytes.byteLength > MAX_ZIP_CONTAINER_BYTES) {
    throw new ProjectReadError("PROJECT_LIMIT_EXCEEDED");
  }
  const reader = new ZipReader(new Uint8ArrayReader(input.bytes.slice()));
  try {
    const zipEntries = await reader.getEntries();
    if (zipEntries.length > MAX_PROJECT_ENTRIES) throw new ProjectReadError("PROJECT_LIMIT_EXCEEDED");
    const result: RawProjectEntry[] = [];
    let totalBytes = 0;
    for (const entry of zipEntries) {
      if (entry.directory) continue;
      const unsafeOriginalName = (entry as Entry & { rawFilename?: Uint8Array }).filename;
      const path = normalizeProjectPath(unsafeOriginalName);
      if (entry.encrypted || isZipSymlink(entry)) throw new ProjectReadError("UNSAFE_PROJECT_PATH");
      const compressedBytes = Math.max(1, entry.compressedSize);
      totalBytes += entry.uncompressedSize;
      if (entry.uncompressedSize > MAX_ARCHIVE_ENTRY_BYTES
        || entry.uncompressedSize / compressedBytes > MAX_PROJECT_ARCHIVE_RATIO) {
        throw new ProjectReadError("PROJECT_LIMIT_EXCEEDED");
      }
      validateSessionSize(totalBytes, options.existingSessionBytes ?? 0);
      if (!entry.getData) throw new ProjectReadError("INVALID_PROJECT");
      result.push({ path, bytes: await entry.getData(new Uint8ArrayWriter()) });
    }
    assertSafePathSet(result.map((entry) => entry.path));
    return result;
  } catch (error) {
    if (error instanceof ProjectReadError) throw error;
    throw new ProjectReadError("INVALID_PROJECT");
  } finally {
    await reader.close().catch(() => undefined);
  }
}

async function readFolderEntries(input: FolderProjectInput, options: ProjectReadOptions): Promise<RawProjectEntry[]> {
  if (input.files.length > MAX_PROJECT_ENTRIES) throw new ProjectReadError("PROJECT_LIMIT_EXCEEDED");
  const paths = input.files.map(folderRelativePath);
  assertSafePathSet(paths);
  let totalBytes = 0;
  for (const file of input.files) {
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_FOLDER_FILE_BYTES) {
      throw new ProjectReadError("PROJECT_LIMIT_EXCEEDED");
    }
    totalBytes += file.size;
    validateSessionSize(totalBytes, options.existingSessionBytes ?? 0);
  }
  try {
    return await Promise.all(input.files.map(async (file, index) => ({
      path: paths[index],
      bytes: new Uint8Array(await file.arrayBuffer()),
    })));
  } catch (error) {
    if (error instanceof ProjectReadError) throw error;
    throw new ProjectReadError("INVALID_PROJECT");
  }
}

function isDefaultExcluded(path: string): boolean {
  const lowerSegments = path.toLowerCase().split("/");
  const basename = lowerSegments.at(-1) ?? "";
  return lowerSegments.some((segment) => defaultExcludedSegments.has(segment))
    || lockFiles.has(basename)
    || /(?:\.min\.(?:js|css)|\.map)$/u.test(basename);
}

function isSensitiveName(path: string): boolean {
  const basename = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  return credentialNames.has(basename)
    || (basename.startsWith(".env.") && basename !== ".env.example" && basename !== ".env.sample")
    || credentialExtensions.has(sourceExtension(basename));
}

function sensitiveContentCategory(bytes: Uint8Array): "privateKeys" | "clearCredentials" | null {
  const decoded = decodeSafeStandaloneText(bytes);
  // Known binary signatures are package-only assets. For undecodable/control-bearing
  // likely text, strip only unsafe controls and still fail closed on explicit secret
  // syntax so a NUL prefix cannot turn a credential file into a retained asset.
  if (!decoded.ok && decoded.issue === "UNSUPPORTED_BINARY") return null;
  const inspectedText = decoded.ok
    ? decoded.text
    : Array.from(new TextDecoder("utf-8").decode(bytes)).filter((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return !((codePoint >= 0 && codePoint <= 8)
          || codePoint === 11
          || codePoint === 12
          || (codePoint >= 14 && codePoint <= 31)
          || (codePoint >= 127 && codePoint <= 159)
          || codePoint === 0xfffd);
      }).join("");
  if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/iu.test(inspectedText)) return "privateKeys";
  return /(?:^|[\n{,])\s*(?:export\s+)?["']?[A-Z0-9_-]*(?:api[_-]?key|secret(?:[_-]?access[_-]?key)?|token|password|private[_-]?key)[A-Z0-9_-]*["']?\s*[:=]\s*["']?(?!example|sample|placeholder|changeme)[^\s"']{8,}/iu.test(inspectedText)
    ? "clearCredentials"
    : null;
}

type SensitiveCategory = keyof WorkspaceProject["sensitiveBlockedCounts"];

function sensitiveCategory(raw: RawProjectEntry): SensitiveCategory | null {
  const basename = raw.path.slice(raw.path.lastIndexOf("/") + 1).toLowerCase();
  if (credentialExtensions.has(sourceExtension(basename)) || /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$/u.test(basename)) {
    return "privateKeys";
  }
  if (isSensitiveName(raw.path)) return "credentialFiles";
  return sensitiveContentCategory(raw.bytes);
}

/** Fail-closed sensitive classifier shared by intake and the public export boundary. */
export function classifySensitiveProjectEntry(path: string, bytes: Uint8Array): SensitiveCategory | null {
  let normalized: string;
  try {
    normalized = normalizeProjectPath(path);
  } catch {
    return "credentialFiles";
  }
  return sensitiveCategory({ path: normalized, bytes: bytes.slice() });
}

function rootGitignore(entries: readonly RawProjectEntry[], enabled: boolean): ((path: string) => boolean) | null {
  if (!enabled) return null;
  const candidate = entries.find((entry) => entry.path === ".gitignore");
  if (!candidate) return null;
  const decoded = decodeSafeStandaloneText(candidate.bytes);
  if (!decoded.ok) return null;
  try {
    const matcher = createIgnore().add(decoded.text);
    return (path: string) => path !== ".gitignore" && matcher.ignores(path);
  } catch {
    return null;
  }
}

function initialEntry(
  raw: RawProjectEntry,
  sha256: string,
  ignored: boolean,
  options: Required<Pick<ProjectReadOptions,
    "excludeDependenciesBuildGenerated" | "preserveSafeNonTextAssets">>,
): ProjectEntry {
  const classification = classifyStandaloneTextName(raw.path);
  const decoded = decodeSafeStandaloneText(raw.bytes);
  const textClassification = classification ?? (decoded.ok ? genericTextClassification() : undefined);
  const defaultExcluded = options.excludeDependenciesBuildGenerated && isDefaultExcluded(raw.path);
  const safeExcludedReason: ProjectExclusionReason = ignored
    ? "gitignore"
    : defaultExcluded
      ? "default-excluded"
      : null;
  if (textClassification && decoded.ok) {
    return Object.freeze({
      path: raw.path,
      immutablePath: raw.path,
      byteCount: raw.bytes.byteLength,
      originalHash: sha256,
      sha256,
      originalBytes: raw.bytes.slice(),
      contentKind: "text",
      languageId: textClassification.languageId,
      previewKind: textClassification.previewKind,
      reviewedText: decoded.text,
      reviewedTextHash: "",
      reviewRevision: 0,
      promptIncluded: safeExcludedReason === null,
      packageIncluded: safeExcludedReason === null,
      exclusionReason: safeExcludedReason,
      restorable: true,
    });
  }
  if (classification) {
    return Object.freeze({
      path: raw.path,
      immutablePath: raw.path,
      byteCount: raw.bytes.byteLength,
      originalHash: sha256,
      sha256,
      originalBytes: raw.bytes.slice(),
      contentKind: "invalid-text",
      languageId: classification.languageId,
      previewKind: classification.previewKind,
      reviewedText: null,
      reviewedTextHash: null,
      reviewRevision: 0,
      promptIncluded: false,
      packageIncluded: false,
      exclusionReason: "invalid-text",
      restorable: false,
    });
  }
  return Object.freeze({
    path: raw.path,
    immutablePath: raw.path,
    byteCount: raw.bytes.byteLength,
    originalHash: sha256,
    sha256,
    originalBytes: raw.bytes.slice(),
    contentKind: "asset",
    languageId: null,
    previewKind: null,
    reviewedText: null,
    reviewedTextHash: null,
    reviewRevision: 0,
    promptIncluded: false,
    packageIncluded: safeExcludedReason === null && options.preserveSafeNonTextAssets,
    exclusionReason: safeExcludedReason ?? "non-text-asset",
    restorable: true,
  });
}

function applyPromptLimits(entries: readonly ProjectEntry[]): ProjectEntry[] {
  let fileCount = 0;
  let decodedBytes = 0;
  return entries.map((entry) => {
    if (!entry.promptIncluded || entry.contentKind !== "text" || entry.reviewedText === null) return entry;
    const bytes = new TextEncoder().encode(entry.reviewedText).byteLength;
    if (fileCount >= MAX_PROMPT_TEXT_FILES || decodedBytes + bytes > MAX_PROMPT_DECODED_TEXT_BYTES) {
      return Object.freeze({
        ...entry,
        promptIncluded: false,
        exclusionReason: "prompt-limit" as const,
      });
    }
    fileCount += 1;
    decodedBytes += bytes;
    return entry;
  });
}

function classifyProject(entries: readonly ProjectEntry[]): {
  classification: ProjectClassification;
  classificationChoiceRequired: boolean;
  classificationChoices: readonly ProjectClassification[];
  rootDocument: string | null;
} {
  const texCandidates = entries.filter((entry) => entry.contentKind === "text"
    && entry.reviewedText !== null
    && /\.(?:tex|ltx)$/iu.test(entry.path)
    && /\\documentclass(?:\[[^\]]*\])?\s*\{/u.test(entry.reviewedText));
  const main = texCandidates.find((entry) => entry.path === "main.tex");
  if (main || texCandidates.length === 1) {
    return {
      classification: "latex",
      classificationChoiceRequired: false,
      classificationChoices: ["latex", "general-text"],
      rootDocument: (main ?? texCandidates[0]).path,
    };
  }
  return {
    classification: "general-text",
    classificationChoiceRequired: texCandidates.length > 1,
    classificationChoices: texCandidates.length > 1 ? ["latex", "general-text"] : ["general-text", "latex"],
    rootDocument: null,
  };
}

async function buildProject(
  name: string,
  sourceKind: ProjectSourceKind,
  rawEntries: readonly RawProjectEntry[],
  options: ProjectReadOptions,
): Promise<WorkspaceProject> {
  if (rawEntries.length === 0) throw new ProjectReadError("INVALID_PROJECT");
  const sensitiveBlockedCounts = { credentialFiles: 0, privateKeys: 0, clearCredentials: 0 };
  const safeRawEntries = rawEntries.filter((entry) => {
    const category = sensitiveCategory(entry);
    if (category) sensitiveBlockedCounts[category] += 1;
    return category === null;
  });
  const ordered = [...safeRawEntries].sort((left, right) => comparePaths(left.path, right.path));
  const ignorePath = rootGitignore(ordered, options.honorRootGitignore ?? true);
  const entries = await Promise.all(ordered.map(async (raw) => {
    const entry = initialEntry(
      raw,
      await hashBytes(bytesBuffer(raw.bytes), options.hasher),
      ignorePath?.(raw.path) ?? false,
      {
        excludeDependenciesBuildGenerated: options.excludeDependenciesBuildGenerated ?? true,
        preserveSafeNonTextAssets: options.preserveSafeNonTextAssets ?? true,
      },
    );
    return entry.reviewedText === null
      ? entry
      : Object.freeze({
          ...entry,
          reviewedTextHash: await hashBytes(bytesBuffer(new TextEncoder().encode(entry.reviewedText)), options.hasher),
        });
  }));
  const limitedEntries = applyPromptLimits(entries);
  const originalTreeHash = await hashOriginalProjectTree(limitedEntries, options.hasher);
  const classification = classifyProject(limitedEntries);
  const reviewedTreeHash = await hashReviewedTree(
    limitedEntries,
    options.hasher,
    classification.classification,
    classification.rootDocument,
  );
  const blockedCount = Object.values(sensitiveBlockedCounts).reduce((total, count) => total + count, 0);
  return {
    kind: "project",
    id: `project-${originalTreeHash.slice(0, 16)}`,
    name,
    sourceKind,
    status: "needs-review",
    entries: limitedEntries,
    originalTreeHash,
    reviewedTreeHash,
    treeHash: originalTreeHash,
    totalByteCount: limitedEntries.reduce((total, entry) => total + entry.byteCount, 0),
    ...classification,
    selectedEntryPath: limitedEntries.find((entry) => entry.contentKind === "text")?.path ?? limitedEntries[0]?.path ?? null,
    projectOperationGeneration: 0,
    projectReviewRevision: 0,
    requiresReview: true,
    warnings: [
      ...(blockedCount > 0 ? [`${blockedCount} sensitive project ${blockedCount === 1 ? "file was" : "files were"} dropped before hashing and retention.`] : []),
      ...(classification.classificationChoiceRequired
        ? ["Choose whether to treat this ZIP as a LaTeX or General text project before confirming review."]
        : []),
    ],
    sensitiveBlockedCounts,
    intake: { kind: sourceKind, displayName: name },
    settingsOverride: {},
    contextWarningAcknowledged: false,
  };
}

export async function readFolderProject(
  input: FolderProjectInput,
  options: ProjectReadOptions = {},
): Promise<WorkspaceProject> {
  return buildProject(input.name, "folder", await readFolderEntries(input, options), options);
}

export async function readZipProject(
  input: ZipProjectInput,
  options: ProjectReadOptions = {},
): Promise<WorkspaceProject> {
  if (!Number.isSafeInteger(input.bytes.byteLength) || input.bytes.byteLength > MAX_ZIP_CONTAINER_BYTES) {
    throw new ProjectReadError("PROJECT_LIMIT_EXCEEDED");
  }
  // Capture caller-owned input synchronously so later mutation cannot change custody metadata or extraction.
  const containerBytes = input.bytes.slice();
  const displayName = input.name;
  const [entries, sha256] = await Promise.all([
    readZipEntries({ kind: "zip", name: displayName, bytes: containerBytes }, options),
    hashBytes(bytesBuffer(containerBytes), options.hasher),
  ]);
  const project = await buildProject(displayName, "zip", entries, options);
  return {
    ...project,
    originalContainer: Object.freeze({
      displayName,
      byteCount: containerBytes.byteLength,
      sha256,
    }),
  };
}

function cloneEntry(entry: ProjectEntry, change: Partial<ProjectEntry>): ProjectEntry {
  return Object.freeze({ ...entry, ...change, originalBytes: entry.originalBytes.slice() });
}

export async function hashOriginalProjectTree(
  entries: readonly Pick<ProjectEntry, "path" | "byteCount" | "originalHash">[],
  hasher?: HashAdapter | null,
): Promise<string> {
  const material = [...entries]
    .sort((left, right) => comparePaths(left.path, right.path))
    .map((entry) => `${entry.path}\t${entry.byteCount}\t${entry.originalHash}\n`)
    .join("");
  return hashBytes(bytesBuffer(new TextEncoder().encode(material)), hasher);
}

export async function hashReviewedTree(
  entries: readonly ProjectEntry[],
  hasher?: HashAdapter | null,
  classification: ProjectClassification = "general-text",
  rootDocument: string | null = null,
): Promise<string> {
  const material = [`classification\t${classification}`, `root\t${rootDocument ?? "-"}`, ...entries.map((entry) => [
    entry.path,
    entry.byteCount,
    entry.originalHash,
    entry.reviewedTextHash ?? "-",
    entry.reviewRevision,
    entry.promptIncluded ? "prompt" : "no-prompt",
    entry.packageIncluded ? "package" : "no-package",
  ].join("\t"))].join("\n");
  return hashBytes(bytesBuffer(new TextEncoder().encode(`${material}\n`)), hasher);
}

async function cloneProject(
  project: WorkspaceProject,
  entries: readonly ProjectEntry[],
  hasher?: HashAdapter | null,
): Promise<WorkspaceProject> {
  return {
    ...project,
    entries,
    reviewedTreeHash: await hashReviewedTree(entries, hasher, project.classification, project.rootDocument),
    warnings: [...project.warnings],
    projectReviewRevision: project.projectReviewRevision + 1,
    contextWarningAcknowledged: false,
    requiresReview: true,
    status: "needs-review",
  };
}

function validatePromptEntries(entries: readonly ProjectEntry[]): void {
  const promptIncluded = entries.filter((entry) => entry.promptIncluded);
  if (promptIncluded.length > MAX_PROMPT_TEXT_FILES) throw new ProjectReadError("PROJECT_LIMIT_EXCEEDED");
  let totalBytes = 0;
  for (const entry of entries.filter((candidate) => candidate.promptIncluded || candidate.packageIncluded)) {
    if (entry.contentKind !== "text" || entry.reviewedText === null) {
      if (entry.contentKind === "asset" && !entry.promptIncluded) continue;
      throw new ProjectReadError("INVALID_PROJECT_REVIEW");
    }
    const decoded = decodeSafeStandaloneText(new TextEncoder().encode(entry.reviewedText));
    if (!decoded.ok) throw new ProjectReadError("INVALID_PROJECT_REVIEW");
    if (entry.promptIncluded) totalBytes += new TextEncoder().encode(entry.reviewedText).byteLength;
  }
  if (totalBytes > MAX_PROMPT_DECODED_TEXT_BYTES) throw new ProjectReadError("PROJECT_LIMIT_EXCEEDED");
}

export async function setProjectEntryInclusion(
  project: WorkspaceProject,
  path: string,
  change: { promptIncluded?: boolean; packageIncluded?: boolean },
  hasher?: HashAdapter | null,
): Promise<WorkspaceProject> {
  const normalized = normalizeProjectPath(path);
  let found = false;
  const entries = project.entries.map((entry) => {
    if (entry.path !== normalized) return entry;
    found = true;
    if (!entry.restorable && (change.promptIncluded || change.packageIncluded)) {
      throw new ProjectReadError("SENSITIVE_ENTRY");
    }
    if (change.promptIncluded && entry.contentKind !== "text") {
      throw new ProjectReadError("INVALID_PROJECT_REVIEW");
    }
    const promptIncluded = change.promptIncluded ?? entry.promptIncluded;
    const packageIncluded = change.packageIncluded ?? entry.packageIncluded;
    const exclusionReason = promptIncluded
      ? null
      : entry.contentKind === "asset" && packageIncluded
        ? "non-text-asset"
        : entry.exclusionReason;
    return cloneEntry(entry, { promptIncluded, packageIncluded, exclusionReason });
  });
  if (!found) throw new ProjectReadError("INVALID_PROJECT");
  validatePromptEntries(entries);
  return cloneProject(project, entries, hasher);
}

export async function editProjectEntryText(
  project: WorkspaceProject,
  path: string,
  reviewedText: string,
  hasher?: HashAdapter | null,
): Promise<WorkspaceProject> {
  const normalized = normalizeProjectPath(path);
  let found = false;
  const entries = await Promise.all(project.entries.map(async (entry) => {
    if (entry.path !== normalized) return entry;
    found = true;
    if (entry.contentKind !== "text") throw new ProjectReadError("INVALID_PROJECT_REVIEW");
    return cloneEntry(entry, {
      reviewedText,
      reviewedTextHash: await hashBytes(bytesBuffer(new TextEncoder().encode(reviewedText)), hasher),
      reviewRevision: entry.reviewRevision + 1,
    });
  }));
  if (!found) throw new ProjectReadError("INVALID_PROJECT");
  return cloneProject(project, entries, hasher);
}

export async function chooseProjectClassification(
  project: WorkspaceProject,
  classification: ProjectClassification,
  rootDocument: string | null = project.rootDocument,
  hasher?: HashAdapter | null,
): Promise<WorkspaceProject> {
  if (!project.classificationChoices.includes(classification)) throw new ProjectReadError("INVALID_PROJECT");
  let normalizedRoot: string | null = null;
  if (classification === "latex") {
    if (rootDocument === null) throw new ProjectReadError("INVALID_PROJECT_REVIEW");
    try {
      normalizedRoot = normalizeProjectPath(rootDocument);
    } catch {
      throw new ProjectReadError("INVALID_PROJECT_REVIEW");
    }
    const rootEntry = project.entries.find((entry) => entry.path === normalizedRoot);
    if (!rootEntry
      || rootEntry.contentKind !== "text"
      || rootEntry.reviewedText === null
      || !/\.(?:tex|ltx)$/iu.test(rootEntry.path)
      || !rootEntry.promptIncluded
      || !rootEntry.packageIncluded) {
      throw new ProjectReadError("INVALID_PROJECT_REVIEW");
    }
  }
  return {
    ...project,
    classification,
    rootDocument: normalizedRoot,
    classificationChoiceRequired: false,
    reviewedTreeHash: await hashReviewedTree(project.entries, hasher, classification, normalizedRoot),
    projectReviewRevision: project.projectReviewRevision + 1,
    contextWarningAcknowledged: false,
    requiresReview: true,
    status: "needs-review",
  };
}

export function confirmProjectReview(project: WorkspaceProject): WorkspaceProject {
  if (project.classificationChoiceRequired) throw new ProjectReadError("INVALID_PROJECT_REVIEW");
  validatePromptEntries(project.entries);
  return { ...project, entries: [...project.entries], warnings: [...project.warnings], requiresReview: false, status: "ready" };
}

export function isCurrentProjectOperation(
  expected: ProjectOperationToken,
  candidate: ProjectOperationToken,
): boolean {
  return expected.itemId === candidate.itemId
    && expected.operationId === candidate.operationId
    && expected.sessionGeneration === candidate.sessionGeneration;
}

export function isCurrentProjectSnapshot(
  expected: ProjectSnapshotToken,
  candidate: ProjectSnapshotToken,
): boolean {
  return isCurrentProjectOperation(expected, candidate)
    && expected.projectReviewRevision === candidate.projectReviewRevision;
}

export function joinProjectArchivePath(prefix: string, entryPath: string): string {
  return normalizeProjectPath(`${normalizeProjectPath(prefix)}/${normalizeProjectPath(entryPath)}`);
}

export function createProjectPromptSnapshot(
  project: WorkspaceProject,
  sessionGeneration: number,
): ProjectPromptSnapshot {
  if (project.requiresReview || project.status !== "ready") throw new ProjectReadError("INVALID_PROJECT_REVIEW");
  validatePromptEntries(project.entries);
  return {
    itemId: project.id,
    operationId: project.projectOperationGeneration,
    sessionGeneration,
    projectReviewRevision: project.projectReviewRevision,
    originalTreeHash: project.originalTreeHash,
    reviewedTreeHash: project.reviewedTreeHash,
    classification: project.classification,
    rootDocument: project.rootDocument,
    includedFiles: project.entries.flatMap((entry) => entry.promptIncluded
      && entry.contentKind === "text"
      && entry.reviewedText !== null
      && entry.reviewedTextHash !== null
      && entry.languageId !== null
      && entry.previewKind !== null
      ? [{
          path: entry.path,
          text: entry.reviewedText,
          originalHash: entry.originalHash,
          reviewedTextHash: entry.reviewedTextHash,
          languageId: entry.languageId,
          previewKind: entry.previewKind,
        }]
      : []),
    excludedPaths: project.entries.filter((entry) => !entry.promptIncluded).map((entry) => entry.path),
  };
}

export function isCurrentProjectPromptSnapshot(
  project: WorkspaceProject,
  sessionGeneration: number,
  snapshot: ProjectPromptSnapshot,
): boolean {
  return !project.requiresReview
    && project.status === "ready"
    && snapshot.itemId === project.id
    && snapshot.operationId === project.projectOperationGeneration
    && snapshot.sessionGeneration === sessionGeneration
    && snapshot.projectReviewRevision === project.projectReviewRevision
    && snapshot.originalTreeHash === project.originalTreeHash
    && snapshot.reviewedTreeHash === project.reviewedTreeHash;
}
