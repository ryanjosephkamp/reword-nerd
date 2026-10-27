import { hasHydrationMarkerCollision } from "./hydration";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { inflateRawSync } from "node:zlib";
import { z } from "zod";
import { assessContext } from "../src/domain/context";
import { CURATED_MODEL_PROFILES, createCustomProfile } from "../src/domain/profiles";
import { resolveSettings } from "../src/domain/settings";
import { classifyStandaloneTextName, sourceExtension } from "../src/domain/sourceText";
import { buildPromptPackage } from "../src/export/package";
import type { DocumentWorkbook, ExportDocumentInput, PromptPackageManifest } from "../src/export/contracts";
import { renderPromptBundle } from "../src/prompting/renderPromptSet";

export const PACKAGE_LIMITS = Object.freeze({
  archiveBytes: 8 * 1024 * 1024,
  expandedBytes: 32 * 1024 * 1024,
  entryBytes: 8 * 1024 * 1024,
  entries: 64,
  sourceBytes: 256 * 1024,
  manifestBytes: 256 * 1024,
});

export class PackageValidationError extends Error {
  override readonly name = "PackageValidationError";
}

export interface LoadedPackage {
  workbook: DocumentWorkbook;
  manifest: PromptPackageManifest;
  sourceText: string;
  packageSha256: string;
  sourceSha256: string;
  documentKey: string;
  documentName: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
function fail(message: string): never { throw new PackageValidationError(message); }
const string = z.string().max(16_384);
const nonblank = string.refine((value) => value.trim().length > 0);
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const finiteNumber = z.number().finite().nonnegative();
const contextLimit = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable();
const originalSchema = z.object({ path: string, byteCount: z.number().int().nonnegative(), sha256: digest }).strict();

// Fields consumed before reconstruction are validated here. The complete original
// manifest is subsequently compared with a fresh canonical exporter manifest.
const inputSchema = z.object({
  schemaVersion: z.literal(6),
  package: z.object({
    name: z.literal("reword-nerd"), version: z.literal("0.8.0"), format: z.literal("dual-mode-prompt-package"),
  }).strict(),
  documents: z.array(z.object({
    key: nonblank,
    exportOrdinal: z.literal(0),
    originalDisplayName: nonblank.max(1024),
    format: z.enum(["text", "markdown"]),
    source: z.object({ kind: z.literal("file"), original: originalSchema }).strict(),
    original: originalSchema,
    reviewedExtraction: z.object({
      path: string, sha256: digest, unicodeCodePointCount: z.number().int().nonnegative(),
      warnings: z.array(string).max(100),
    }).strict(),
    settings: z.object({
      tone: z.enum(["preserve", "academic", "professional", "technical", "plain"]),
      formality: z.enum(["preserve", "standard", "formal"]),
      length: z.enum(["preserve", "concise", "expanded"]),
      outputLanguage: nonblank,
      customRequirements: string.refine((value) => Array.from(value).length <= 2000),
    }).strict(),
    model: z.object({
      id: nonblank, family: nonblank, label: nonblank, contextWindowTokens: contextLimit,
      lastReviewed: nonblank, workflowNote: nonblank,
      promptStrategy: z.object({ id: nonblank, version: nonblank, referenceModel: nonblank, reviewedAt: nonblank }).strict(),
    }).strict(),
    contextAssessment: z.object({
      estimateLabel: z.literal("Estimated tokens"),
      sourceTokens: finiteNumber.int(), oneShotWorkflowTokens: finiteNumber.int(), manualWorkflowTokens: finiteNumber.int(),
      oneShotRatio: finiteNumber.nullable(), manualRatio: finiteNumber.nullable(),
      oneShotOversized: z.boolean(), manualOversized: z.boolean(), oneShotWarning: z.boolean(),
      workflowTokens: finiteNumber.int(), contextWindowTokens: contextLimit, ratio: finiteNumber.nullable(),
      oversized: z.boolean(), acknowledgmentRequired: z.boolean(),
      includedFileCount: finiteNumber.int().optional(), amberRisk: z.boolean().optional(),
      amberRiskReasons: z.array(z.enum(["included-file-count", "one-shot-ratio"])).optional(),
      inspectDiffsAndRunTestsWarning: z.literal("Inspect the generated diffs and run your normal tests/build after applying changes.").optional(),
    }).strict(),
    contextWarningAcknowledged: z.boolean(),
    processing: z.object({
      pageCount: z.null(),
      options: z.object({
        extractEmbeddedImages: z.boolean(), capturePageVisuals: z.literal(false), pageSelection: string,
        pageCaptureQuality: z.enum(["standard", "high"]), ocrMode: z.literal("off"), ocrExtractedAssets: z.literal(false),
        ocrLanguage: z.object({ kind: z.literal("bundled"), code: z.literal("eng"), label: z.literal("English") }).strict(),
        excludeDecorativeImages: z.boolean(),
      }).strict(),
    }).strict(),
    visualAssets: z.object({ records: z.array(z.never()).length(0) }).passthrough(),
    ocr: z.object({ records: z.array(z.never()).length(0) }).passthrough(),
    latexProject: z.never().optional(),
  }).passthrough()).length(1),
}).passthrough();

interface ZipEntry {
  path: string;
  compressedSize: number;
  expandedSize: number;
  compression: number;
  crc: number;
  start: number;
  end: number;
  offset: number;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function utf8(bytes: Uint8Array, label: string): string {
  try { return decoder.decode(bytes); } catch { return fail(`${label} is not valid UTF-8.`); }
}

function safePath(path: string): boolean {
  // The canonical exporter produces ASCII paths. Reject aliases across POSIX,
  // Windows and URL decoders rather than normalizing untrusted archive names.
  return /^[a-zA-Z0-9_./-]+$/u.test(path)
    && !path.startsWith("/") && !path.endsWith("/")
    && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function validateExtra(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 4 > bytes.length) fail("Malformed ZIP extra field.");
    const id = view.getUint16(offset, true);
    const size = view.getUint16(offset + 2, true);
    if (id === 0x0001) fail("ZIP64 packages are not supported in this bounded text runner.");
    if (id === 0x7075 || id === 0x6375) fail("ZIP Unicode filename aliases are not supported.");
    offset += 4 + size;
    if (offset > bytes.length) fail("Malformed ZIP extra field length.");
  }
}

/** Read the ZIP directory before inflation; no filesystem paths are extracted. */
function readArchive(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.length > PACKAGE_LIMITS.archiveBytes) fail("Package exceeds the 8 MiB compressed archive limit.");
  if (bytes.length < 22) fail("Package is not a complete ZIP archive.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  // Canonical exports have no ZIP comment or trailing data. Requiring the EOCD
  // at the end avoids ambiguous embedded directory signatures.
  const eocd = bytes.length - 22;
  if (u32(eocd) !== 0x06054b50 || u16(eocd + 20) !== 0) fail("Unsupported ZIP comment, trailing data, or missing end directory.");
  if (u16(eocd + 4) !== 0 || u16(eocd + 6) !== 0) fail("Multi-disk ZIP archives are not supported.");
  const count = u16(eocd + 10);
  const directorySize = u32(eocd + 12);
  const directoryOffset = u32(eocd + 16);
  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) fail("ZIP64 packages are not supported.");
  if (!count || count > PACKAGE_LIMITS.entries || u16(eocd + 8) !== count) fail("ZIP entry count exceeds the supported bound or is inconsistent.");
  if (directoryOffset + directorySize !== eocd) fail("ZIP central directory bounds do not match the archive.");
  let cursor = directoryOffset;
  let expandedTotal = 0;
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  const aliases = new Set<string>();
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > eocd || u32(cursor) !== 0x02014b50) fail("Malformed ZIP central directory entry.");
    const flags = u16(cursor + 8);
    const compression = u16(cursor + 10);
    const crc = u32(cursor + 16);
    const compressedSize = u32(cursor + 20);
    const expandedSize = u32(cursor + 24);
    const nameLength = u16(cursor + 28);
    const extraLength = u16(cursor + 30);
    const commentLength = u16(cursor + 32);
    const attributes = u32(cursor + 38);
    const offset = u32(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > eocd || !nameLength) fail("ZIP entry name or metadata exceeds directory bounds.");
    if (flags & 1) fail("Encrypted ZIP entries are not supported.");
    if (flags & ~0x0806) fail("Unsupported ZIP flags or data descriptors.");
    if (compression !== 0 && compression !== 8) fail("Unsupported ZIP compression method.");
    if (u16(cursor + 34) !== 0) fail("Multi-disk ZIP entries are not supported.");
    const mode = (attributes >>> 16) & 0xf000;
    if ((attributes & 0x10) || (mode !== 0 && mode !== 0x8000)) fail("ZIP directories, symlinks and special files are not supported.");
    if (compressedSize === 0xffffffff || expandedSize === 0xffffffff || offset === 0xffffffff) fail("ZIP64 entries are not supported.");
    if (expandedSize > PACKAGE_LIMITS.entryBytes || compressedSize > PACKAGE_LIMITS.archiveBytes) fail("ZIP entry exceeds the 8 MiB entry limit.");
    expandedTotal += expandedSize;
    if (expandedTotal > PACKAGE_LIMITS.expandedBytes) fail("ZIP exceeds the 32 MiB expanded-byte limit.");
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const path = utf8(rawName, "ZIP filename");
    if (!safePath(path)) fail("ZIP contains an unsafe or unsupported archive path.");
    if (names.has(path) || aliases.has(path.toLowerCase())) fail("ZIP contains duplicate or aliased entry paths.");
    names.add(path); aliases.add(path.toLowerCase());
    validateExtra(bytes.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength));
    if (offset + 30 > directoryOffset || u32(offset) !== 0x04034b50) fail("ZIP local header is missing or out of bounds.");
    const localNameLength = u16(offset + 26);
    const localExtraLength = u16(offset + 28);
    const start = offset + 30 + localNameLength + localExtraLength;
    const end = start + compressedSize;
    if (end > directoryOffset || start > directoryOffset) fail("ZIP entry payload overlaps the central directory.");
    if (u16(offset + 6) !== flags || u16(offset + 8) !== compression || u32(offset + 14) !== crc
      || u32(offset + 18) !== compressedSize || u32(offset + 22) !== expandedSize
      || localNameLength !== nameLength
      || !Buffer.from(bytes.subarray(offset + 30, offset + 30 + localNameLength)).equals(Buffer.from(rawName))) {
      fail("ZIP local and central headers disagree.");
    }
    validateExtra(bytes.subarray(offset + 30 + localNameLength, start));
    entries.push({ path, compressedSize, expandedSize, compression, crc, start, end, offset });
    cursor = next;
  }
  if (cursor !== eocd) fail("ZIP directory includes undeclared records.");
  let nextOffset = 0;
  for (const entry of [...entries].sort((a, b) => a.offset - b.offset)) {
    if (entry.offset !== nextOffset) fail("ZIP has overlapping entries, hidden payloads, or a prefixed container.");
    nextOffset = entry.end;
  }
  if (nextOffset !== directoryOffset) fail("ZIP has unclaimed data before its directory.");
  const files = new Map<string, Uint8Array>();
  for (const entry of entries) {
    const compressed = bytes.subarray(entry.start, entry.end);
    let data: Uint8Array;
    try {
      data = entry.compression === 0 ? compressed.slice() : inflateRawSync(compressed, {
        maxOutputLength: Math.max(1, entry.expandedSize),
      });
    } catch { return fail("ZIP payload is corrupt or exceeds its declared expanded size."); }
    if (data.length !== entry.expandedSize || crc32(data) !== entry.crc) fail("ZIP entry expanded size or CRC integrity check failed.");
    files.set(entry.path, Uint8Array.from(data));
  }
  return files;
}

function requireFile(files: Map<string, Uint8Array>, path: string): Uint8Array {
  return files.get(path) ?? fail("Manifest refers to a missing artifact.");
}

function exactBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && Buffer.from(left).equals(Buffer.from(right));
}

function differingPath(left: unknown, right: unknown, path = "manifest", depth = 0): string {
  if (depth > 20 || left === null || right === null || typeof left !== "object" || typeof right !== "object") return path;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  if (Object.keys(a).some((key) => !Object.hasOwn(b, key))) return `${path}.[unexpected-field]`;
  for (const key of Object.keys(b)) {
    if (!isDeepStrictEqual(a[key], b[key])) return differingPath(a[key], b[key], `${path}.${key}`, depth + 1);
  }
  return path;
}

/** Loads only canonical v0.8 schema-6, single-file TXT/Markdown exports. */
export async function loadPackage(input: Uint8Array): Promise<LoadedPackage> {
  if (!(input instanceof Uint8Array)) fail("Package input must be bytes.");
  if (input.length > PACKAGE_LIMITS.archiveBytes) fail("Package exceeds the 8 MiB compressed archive limit.");
  // Buffer.slice() creates a view, unlike Uint8Array.slice(). Normalize first so
  // callers using fs.readFile also receive an owned, exact-length snapshot.
  const bytes = Uint8Array.from(input);
  try {
    const files = readArchive(bytes);
    const manifestBytes = requireFile(files, "manifest.json");
    if (manifestBytes.length > PACKAGE_LIMITS.manifestBytes) fail("Manifest exceeds the 256 KiB limit.");
    let rawManifest: unknown;
    try { rawManifest = JSON.parse(utf8(manifestBytes, "Manifest")); } catch { return fail("Manifest is not valid UTF-8 JSON."); }
    const parsed = inputSchema.safeParse(rawManifest);
    if (!parsed.success) fail("Unsupported or invalid manifest: require schema 6, one TXT/Markdown file, and no projects, assets, OCR or LaTeX.");
    const document = parsed.data.documents[0];
    if (![".txt", ".md", ".markdown"].includes(sourceExtension(document.originalDisplayName))
      || classifyStandaloneTextName(document.originalDisplayName)?.format !== document.format) {
      fail("Original filename must have a TXT or Markdown extension matching the declared document format.");
    }
    if (!isDeepStrictEqual(document.source.original, document.original)) fail("Original-source compatibility records disagree.");
    const original = requireFile(files, document.original.path);
    const source = requireFile(files, document.reviewedExtraction.path);
    if (original.length > PACKAGE_LIMITS.sourceBytes || source.length > PACKAGE_LIMITS.sourceBytes) fail("Original and reviewed source must each fit the 256 KiB text limit.");
    // Original bytes remain opaque provenance: TXT/Markdown can originate in a
    // non-UTF-8 encoding. The reviewed extraction alone must be exact UTF-8.
    if (original.length !== document.original.byteCount || sha256(original) !== document.original.sha256) fail("Original source hash or byte count does not match its manifest.");
    const sourceSha256 = sha256(source);
    if (sourceSha256 !== document.reviewedExtraction.sha256) fail("Reviewed source hash does not match its manifest.");
    const sourceText = utf8(source, "Reviewed source");
    if (!sourceText.trim() || Array.from(sourceText).length !== document.reviewedExtraction.unicodeCodePointCount) fail("Reviewed source is blank or its Unicode count is inconsistent.");
    resolveSettings(document.settings); // Validate without changing stored strings.
    const profile = document.model.id === "custom"
      ? createCustomProfile(document.model.label, document.model.contextWindowTokens)
      : CURATED_MODEL_PROFILES.find((candidate) => candidate.id === document.model.id);
    if (!profile) fail("Package model strategy is unsupported by this runner version.");
    const assessed = assessContext(sourceText, profile.contextWindowTokens);
    for (const [key, value] of Object.entries(document.contextAssessment)) {
      if (!isDeepStrictEqual(value, assessed[key as keyof typeof assessed])) fail("Context assessment does not match reviewed source and model profile.");
    }
    if (assessed.acknowledgmentRequired && !document.contextWarningAcknowledged) fail("Package context warning has not been acknowledged.");
    // Both are public canonical renderer contracts. Studio exports include an
    // empty asset context; direct engine exports may omit that optional context.
    const candidates = [
      renderPromptBundle(sourceText, document.settings, profile, { format: document.format, assets: [] }),
      renderPromptBundle(sourceText, document.settings, profile),
    ];
    const root = `documents/${document.key}`;
    const promptPaths = {
      oneShot: `${root}/one-shot/00-one-shot.md`,
      decompose: `${root}/manual-prompts/01-decompose.md`, rewrite: `${root}/manual-prompts/02-rewrite.md`,
      verify: `${root}/manual-prompts/03-verify.md`, final: `${root}/manual-prompts/04-final.md`,
    };
    const promptBundle = candidates.find((candidate) => Object.entries(promptPaths).every(([stage, path]) => {
      const text = stage === "oneShot" ? candidate.oneShot : candidate.manual[stage as keyof typeof candidate.manual];
      return exactBytes(requireFile(files, path), encoder.encode(text));
    }));
    if (!promptBundle) fail("Packaged prompts do not match the canonical source/settings/model rendering.");
    const generated = new Map<string, Uint8Array>();
    const exportInput: ExportDocumentInput = {
      kind: "document", documentId: document.key, documentName: document.originalDisplayName,
      documentFormat: document.format,
      original: { name: document.originalDisplayName, size: original.length, type: "text/plain", arrayBuffer: async () => original.slice().buffer } as File,
      reviewedExtractedText: sourceText, resolvedSettings: document.settings, chosenProfile: profile, promptBundle,
      warnings: document.reviewedExtraction.warnings, contextAssessment: document.contextAssessment,
      reviewed: true, contextWarningAcknowledged: document.contextWarningAcknowledged, uploadOrdinal: 0,
      pageCount: null, extractionOptions: document.processing.options, visualAssets: [], ocrCandidates: [],
    };
    const reconstruct = async (legacyWorkbookHydration = false) => {
      generated.clear();
      return buildPromptPackage([exportInput], {
      legacyWorkbookHydration,
      // Capture canonical artifacts; this reuses all export/hash/runbook/workbook
      // contracts without recompressing or interpreting any imported HTML.
      hasher: { digest: async (buffer) => {
        const digest = createHash("sha256").update(new Uint8Array(buffer)).digest();
        return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength) as ArrayBuffer;
      } },
      createArchive: () => ({
        file: (path, data) => { generated.set(path, typeof data === "string" ? encoder.encode(data) : data.slice()); },
        generateAsync: async () => new Blob([]),
      }),
    });
    };
    let rebuilt = await reconstruct();
    if (rebuilt.ok && !isDeepStrictEqual(rawManifest, rebuilt.manifest)) {
      if (hasHydrationMarkerCollision(promptBundle)) fail("Ambiguous legacy hydration markers; export again from reviewed source with the corrected renderer.");
      rebuilt = await reconstruct(true);
    }
    if (!rebuilt.ok) fail(`Canonical workbook reconstruction failed: ${rebuilt.error.code}.`);
    if (files.size !== generated.size) fail("ZIP contains undeclared or missing artifacts.");
    if (!isDeepStrictEqual(rawManifest, rebuilt.manifest)) fail(`Manifest identity, paths, artifact hashes or metadata do not match canonical reconstruction (${differingPath(rawManifest, rebuilt.manifest)}).`);
    for (const [path, expected] of generated) {
      if (path !== "manifest.json" && !exactBytes(requireFile(files, path), expected)) fail("Artifact hash or canonical workbook content does not match the package manifest.");
    }
    return {
      workbook: rebuilt.workbooks[0], manifest: rebuilt.manifest, sourceText,
      packageSha256: sha256(bytes), sourceSha256, documentKey: document.key, documentName: document.originalDisplayName,
    };
  } catch (error) {
    if (error instanceof PackageValidationError) throw error;
    return fail("Package could not be validated safely; the archive or manifest is invalid.");
  }
}
