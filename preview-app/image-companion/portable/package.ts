import { z } from "zod";
import { isImagePromptSettings, type ImageProvenance, type ImagePromptSettings } from "../../src/image/contracts";
import { IMAGE_PROMPT_PROFILES } from "../../src/image/profiles";
import { buildImagePromptPackage } from "../../src/image/export/package";
import type { ImagePackageManifestV1, ImagePackagePairManifestV1 } from "../../src/image/export/contracts";
import { crc32, createPngInspector, PNG_LIMITS, PngValidationError } from "./png";
import { equalBytes, equalData as isDeepStrictEqual, type ReviewRuntime } from "./runtime";

export const IMAGE_LIMITS = Object.freeze({
  archiveBytes: 24 * 1024 * 1024,
  expandedBytes: 48 * 1024 * 1024,
  entryBytes: 24 * 1024 * 1024,
  entries: 16,
  manifestBytes: 256 * 1024,
  referenceBytes: PNG_LIMITS.bytes,
  promptBytes: 64 * 1024,
  pngAxis: PNG_LIMITS.axis,
  pngPixels: PNG_LIMITS.pixels,
  pngInflatedBytes: PNG_LIMITS.inflatedBytes,
});

export class ImagePackageValidationError extends Error {
  override readonly name = "ImagePackageValidationError";
}
export interface ValidatedImagePackage {
  packageSha256: string;
  referenceSha256: string;
  referenceBytes: Uint8Array;
  prompt: string;
  promptSha256: string;
  pairKey: string;
  displayName: string;
  configuration: ImagePackagePairManifestV1["configuration"];
  manifest: ImagePackageManifestV1;
}
export function createPackageValidator(runtime:ReviewRuntime){
const inspectPng=createPngInspector(runtime);
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();
const sha256 = runtime.hash;
function fail(message: string): never { throw new ImagePackageValidationError(message); }

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
    if (id === 0x0001) fail("ZIP64 packages are not supported in this bounded image companion.");
    if (id === 0x7075 || id === 0x6375) fail("ZIP Unicode filename aliases are not supported.");
    offset += 4 + size;
    if (offset > bytes.length) fail("Malformed ZIP extra field length.");
  }
}

/** Read the ZIP directory before inflation; no filesystem paths are extracted. */
function readArchive(bytes: Uint8Array, limits: { archiveBytes: number; expandedBytes: number; entryBytes: number; entries: number } = IMAGE_LIMITS, pathPolicy: (path: string) => boolean = safePath): Map<string, Uint8Array> {
  if (bytes.length > limits.archiveBytes) fail("Package exceeds the compressed archive limit.");
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
  if (!count || count > limits.entries || u16(eocd + 8) !== count) fail("ZIP entry count exceeds the supported bound or is inconsistent.");
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
    if (commentLength) fail("ZIP entry comments are unsupported.");
    if (flags & 1) fail("Encrypted ZIP entries are not supported.");
    if (flags & ~0x0806) fail("Unsupported ZIP flags or data descriptors.");
    if (compression !== 0 && compression !== 8) fail("Unsupported ZIP compression method.");
    if (compression === 0 && (flags & 6)) fail("Stored ZIP entries cannot declare DEFLATE options.");
    if (u16(cursor + 34) !== 0) fail("Multi-disk ZIP entries are not supported.");
    const mode = (attributes >>> 16) & 0xf000;
    if ((attributes & 0x10) || (mode !== 0 && mode !== 0x8000)) fail("ZIP directories, symlinks and special files are not supported.");
    if (compressedSize === 0xffffffff || expandedSize === 0xffffffff || offset === 0xffffffff) fail("ZIP64 entries are not supported.");
    if (expandedSize > limits.entryBytes || compressedSize > limits.archiveBytes) fail("ZIP entry exceeds the entry byte limit.");
    expandedTotal += expandedSize;
    if (expandedTotal > limits.expandedBytes) fail("ZIP exceeds the expanded-byte limit.");
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const path = utf8(rawName, "ZIP filename");
    if (!pathPolicy(path)) fail("ZIP contains an unsafe or unsupported archive path.");
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
      || !equalBytes(bytes.subarray(offset + 30, offset + 30 + localNameLength), rawName)) {
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
      if (entry.compression === 0) data = compressed.slice();
      else {
        const result = runtime.inflate(compressed, Math.max(1, entry.expandedSize), true);
        if (result.consumed !== compressed.length) fail("ZIP entry has trailing compressed payload.");
        data = result.buffer;
      }
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
  return left.length === right.length && equalBytes(left,right);
}

const boundedString = z.string().max(16_384);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const artifactSchema = z.object({ path: boundedString, byteCount: integer, sha256: digest, mediaType: boundedString }).strict();
const provenanceSchema = z.object({
  intakeKind: z.enum(["direct", "folder", "zip", "pdf-extracted", "docx-extracted"]),
  sourceName: z.string().min(1).max(2048), sourcePath: boundedString.nullable(),
  containerChain: z.array(z.object({ kind: z.enum(["folder", "zip", "pdf", "docx"]), name: boundedString, sha256: digest.nullable(), path: boundedString.nullable(), byteCount: integer.nullable() }).strict()).max(2),
  containerName: boundedString.nullable(), containerHash: digest.nullable(), containerPath: boundedString.nullable(),
  pageNumber: integer.nullable(), relationshipId: boundedString.nullable(),
}).strict();
const inputSchema = z.object({
  schemaVersion: z.literal(1),
  package: z.object({ name: z.literal("reword-nerd"), format: z.literal("image-reference-prompt-package"), filename: z.literal("reword-nerd-image-prompt-package.zip"), fixedTimestamp: z.literal("1980-01-01T00:00:00.000Z"), pairCount: z.literal(1), pairOrder: z.literal("confirmed-queue-order") }).strict(),
  pairs: z.array(z.object({
    ordinal: z.literal(1), key: z.string().min(1).max(128), displayName: z.string().min(1).max(2048),
    source: z.object({ path: boundedString, mediaType: z.literal("image/png"), extension: z.literal("png"), byteCount: integer.max(IMAGE_LIMITS.referenceBytes), sha256: digest, width: integer.positive().max(PNG_LIMITS.axis), height: integer.positive().max(PNG_LIMITS.axis), provenance: provenanceSchema }).strict(),
    configuration: z.object({
      settings: z.custom<ImagePromptSettings>(isImagePromptSettings),
      profile: z.object({ id: boundedString, label: boundedString, referenceModel: boundedString, profileVersion: boundedString, lastVerifiedAt: boundedString, officialSourceUrls: z.array(boundedString).max(20), capabilityNotes: z.array(boundedString).max(20) }).strict(),
    }).strict(),
    ocr: z.object({ accepted: z.literal(false), acceptedTextSha256: z.null(), acceptedCodePoints: z.null() }).strict(),
    warnings: z.array(boundedString).max(100),
    artifacts: z.object({ source: artifactSchema, prompt: artifactSchema, runCard: artifactSchema, metadata: artifactSchema, openMe: artifactSchema }).strict(),
  }).strict()).length(1),
  artifactInventory: z.array(artifactSchema).min(1).max(IMAGE_LIMITS.entries - 1),
}).passthrough();

/** Import one current canonical image-reference package. Hashes establish local
 * byte consistency, not authorship, provenance truth, or model execution.
 * HTML is compared as bytes and never opened or executed.
 */
async function loadImagePackage(input: Uint8Array): Promise<ValidatedImagePackage> {
  if (!(input instanceof Uint8Array) || input.length > IMAGE_LIMITS.archiveBytes) fail("Package input must be bytes within the 24 MiB archive limit.");
  const bytes = Uint8Array.from(input);
  try {
    const files = readArchive(bytes);
    const manifestBytes = requireFile(files, "manifest.json");
    if (manifestBytes.length > IMAGE_LIMITS.manifestBytes) fail("Image manifest exceeds the 256 KiB limit.");
    let rawManifest: unknown;
    try { rawManifest = JSON.parse(utf8(manifestBytes, "Image manifest")); } catch { return fail("Image manifest is not valid UTF-8 JSON."); }
    const parsed = inputSchema.safeParse(rawManifest);
    if (!parsed.success) fail("Unsupported image package: require schema 1, exactly one PNG reference, and no accepted OCR text.");
    const pair = parsed.data.pairs[0];
    if (!/\.png$/iu.test(pair.displayName) || pair.displayName !== pair.source.provenance.sourceName) fail("PNG display name and source identity do not agree.");
    const profile = IMAGE_PROMPT_PROFILES.find(candidate => candidate.id === pair.configuration.settings.modelFamily);
    if (!profile || profile.id !== pair.configuration.profile.id) fail("Image prompt profile identity is unsupported or inconsistent.");
    if (profile.profileVersion !== pair.configuration.profile.profileVersion || profile.lastVerifiedAt !== pair.configuration.profile.lastVerifiedAt) fail("Image prompt profile version is unsupported by this companion.");
    const inventory = new Set<string>();
    for (const artifact of parsed.data.artifactInventory) {
      if (!safePath(artifact.path) || artifact.path === "manifest.json" || inventory.has(artifact.path)) fail("Image artifact inventory has unsafe, self-referential or duplicate paths.");
      inventory.add(artifact.path);
      const artifactBytes = requireFile(files, artifact.path);
      if (artifactBytes.length !== artifact.byteCount || await sha256(artifactBytes) !== artifact.sha256) fail("Image artifact byte count or SHA-256 integrity check failed.");
    }
    if (files.size !== inventory.size + 1 || [...files.keys()].some(path => path !== "manifest.json" && !inventory.has(path))) fail("Image package contains unlisted artifacts.");
    const referenceBytes = requireFile(files, pair.source.path);
    const referenceSha256 = await sha256(referenceBytes);
    if (referenceBytes.length !== pair.source.byteCount || referenceSha256 !== pair.source.sha256) fail("Reference source hash or byte count disagrees with its manifest.");
    const dimensions = inspectPng(referenceBytes);
    if (dimensions.width !== pair.source.width || dimensions.height !== pair.source.height) fail("Reference PNG dimensions disagree with its manifest.");
    const promptBytes = requireFile(files, pair.artifacts.prompt.path);
    if (promptBytes.length > IMAGE_LIMITS.promptBytes) fail("Image prompt exceeds the 64 KiB limit.");
    const prompt = utf8(promptBytes, "Image prompt");
    const reconstructed = new Map<string, Uint8Array>();
    const built = await buildImagePromptPackage({
      sessionGeneration: 1, reviewGeneration: 1, confirmedReviewGeneration: 1,
      items: [{
        occurrenceId: "image-companion-reference", incarnation: 1,
        sourceBytes: new Blob([Uint8Array.from(referenceBytes)], { type: "image/png" }),
        byteCount: referenceBytes.length, sourceHash: referenceSha256, mimeType: "image/png", fileExtension: "png",
        dimensions: { width: dimensions.width, height: dimensions.height, megapixels: dimensions.width * dimensions.height / 1_000_000 },
        provenance: pair.source.provenance as ImageProvenance, settings: pair.configuration.settings,
        ocr: { status: "off", detectedText: null, reviewedText: null, operationGeneration: 0, reviewRevision: 0 },
        warnings: pair.warnings, reviewRevision: 0,
        expectedProfileVersion: profile.profileVersion, expectedProfileVerifiedAt: profile.lastVerifiedAt,
      }],
    }, {
      hash: async blob => sha256(new Uint8Array(await blob.arrayBuffer())),
      decoder: { decode: async blob => ({ ...inspectPng(new Uint8Array(await blob.arrayBuffer())), close() {} }) },
      createArchive: () => ({
        add(path, data) {
          if (reconstructed.has(path)) fail("Canonical exporter produced a duplicate path.");
          reconstructed.set(path, typeof data === "string" ? encoder.encode(data) : Uint8Array.from(data));
        },
        // The canonical exporter has already materialized every artifact. Its
        // archive writer is captured here to avoid a second compression pass.
        async close() { return new Blob([Uint8Array.of(0)], { type: "application/zip" }); },
      }),
    });
    if (!built.ok) fail(`Image package cannot be canonically reconstructed: ${built.error.code}.`);
    if (!isDeepStrictEqual(rawManifest, built.output.manifest)) fail("Image manifest does not match the canonical source, settings, profile and prompt binding.");
    if (files.size !== reconstructed.size) fail("Image package artifact set is not canonical.");
    for (const [path, expected] of reconstructed) if (!exactBytes(requireFile(files, path), expected)) fail("Image package artifact bytes differ from the canonical exporter.");
    return {
      packageSha256: await sha256(bytes), referenceSha256, referenceBytes: Uint8Array.from(referenceBytes),
      prompt, promptSha256: await sha256(promptBytes), pairKey: pair.key, displayName: pair.displayName,
      configuration: built.output.manifest.pairs[0].configuration, manifest: built.output.manifest,
    };
  } catch (error) {
    if (error instanceof ImagePackageValidationError) throw error;
    if (error instanceof PngValidationError) return fail(error.message);
    return fail("Image package is malformed or could not be validated.");
  }
}

return {readArchive,loadImagePackage};
}
