import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import {
  isImageOcrTextWithinLimit,
  isImagePromptSettings,
  type ImagePortalItem,
  type ImageProvenance,
} from "../contracts";
import {
  createBrowserImageDecodeAdapter,
  prepareImageInput,
  validatePreparedImage,
} from "../imageValidation";
import {
  ImageIntakeFailure,
  MAX_IMAGE_AXIS,
  MAX_IMAGE_INPUT_BYTES,
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_SESSION_BYTES,
  MAX_IMAGE_SESSION_COUNT,
} from "../intakeContracts";
import { IMAGE_PROMPT_PROFILES } from "../profiles";
import {
  renderImageFullHtml,
  renderImagePairHtml,
  renderImageRootHtml,
  type ImageHtmlPair,
} from "./html";
import {
  assertUniquePortableImageArchivePaths,
  imagePairKey,
  imagePairPaths,
  isSafeImageArchivePath,
  stableImageArchiveCompare,
} from "./paths";
import {
  IMAGE_FULL_HTML_MAX_BYTES,
  IMAGE_PACKAGE_FILENAME,
  IMAGE_PACKAGE_FIXED_TIMESTAMP,
  IMAGE_PACKAGE_FORMAT,
  IMAGE_PACKAGE_SCHEMA_VERSION,
  type ImageArtifactRecord,
  type ImageBuiltPairPreview,
  type ImageFullHtmlRecord,
  type ImagePackageBuildOptions,
  type ImagePackageBuildResult,
  type ImagePackageFailure,
  type ImagePackageManifestV1,
  type ImagePackagePairManifestV1,
  type ImagePackageSnapshot,
  type ImagePackageSnapshotItem,
} from "./contracts";

const SNAPSHOT_KEYS = [
  "sessionGeneration",
  "reviewGeneration",
  "confirmedReviewGeneration",
  "items",
] as const;
const ITEM_KEYS = [
  "occurrenceId",
  "incarnation",
  "sourceBytes",
  "byteCount",
  "sourceHash",
  "mimeType",
  "fileExtension",
  "dimensions",
  "provenance",
  "settings",
  "ocr",
  "warnings",
  "reviewRevision",
  "expectedProfileVersion",
  "expectedProfileVerifiedAt",
] as const;
const DIMENSION_KEYS = ["width", "height", "megapixels"] as const;
const SETTINGS_KEYS = [
  "modelFamily",
  "aspectRatio",
  "sizeIntent",
  "preserveVisibleText",
  "backgroundBehavior",
  "requestedChanges",
  "mustPreserve",
] as const;
const OCR_KEYS = ["status", "detectedText", "reviewedText", "operationGeneration", "reviewRevision"] as const;
const PROVENANCE_KEYS = [
  "intakeKind",
  "sourceName",
  "sourcePath",
  "containerChain",
  "containerName",
  "containerHash",
  "containerPath",
  "pageNumber",
  "relationshipId",
] as const;
const CONTAINER_KEYS = ["kind", "name", "sha256", "path", "byteCount"] as const;
const MIME_EXTENSION = Object.freeze({
  "image/png": Object.freeze(["png"]),
  "image/jpeg": Object.freeze(["jpg", "jpeg"]),
  "image/webp": Object.freeze(["webp"]),
  "image/avif": Object.freeze(["avif"]),
} as const);

const FAILURE_MESSAGES: Readonly<Record<ImagePackageFailure["code"], string>> = Object.freeze({
  IMAGE_SET_NOT_CONFIRMED: "Confirm the current image set before building a package.",
  INVALID_SNAPSHOT: "The confirmed image set no longer meets package safety requirements.",
  SOURCE_REVALIDATION_FAILED: "A source image did not pass package revalidation.",
  PROFILE_VERSION_MISMATCH: "A selected prompt profile changed after image-set confirmation.",
  HASH_UNAVAILABLE: "A source image could not be hashed for the local package.",
  ARCHIVE_GENERATION_FAILED: "The local package archive could not be created.",
});

function failure(code: ImagePackageFailure["code"]): ImagePackageBuildResult {
  return { ok: false, error: { code, message: FAILURE_MESSAGES[code] } };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function safeInteger(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function validSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function boundedControlFree(value: unknown, maximumCodePoints = 1_024): value is string {
  if (typeof value !== "string") return false;
  const characters = Array.from(value);
  return characters.length >= 1
    && characters.length <= maximumCodePoints
    && !characters.some((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point <= 31 || point === 127;
    });
}

function nullableSafePath(value: unknown): value is string | null {
  return value === null || typeof value === "string" && isSafeImageArchivePath(value);
}

function validProvenance(value: unknown): value is ImageProvenance {
  if (!exactKeys(value, PROVENANCE_KEYS)
    || !boundedControlFree(value.sourceName)
    || !nullableSafePath(value.sourcePath)
    || !Array.isArray(value.containerChain)
    || value.containerChain.length > 2) return false;

  const chain = value.containerChain;
  for (const candidate of chain) {
    if (!exactKeys(candidate, CONTAINER_KEYS)
      || !["folder", "zip", "pdf", "docx"].includes(candidate.kind as string)
      || !boundedControlFree(candidate.name)
      || !nullableSafePath(candidate.path)) return false;
    if (candidate.kind === "folder") {
      if (candidate.sha256 !== null || candidate.byteCount !== null) return false;
    } else if (!validSha256(candidate.sha256) || !safeInteger(candidate.byteCount, 1)) {
      return false;
    }
  }

  const innermost = chain.at(-1) as Record<string, unknown> | undefined;
  if ((innermost?.name ?? null) !== value.containerName
    || (innermost?.sha256 ?? null) !== value.containerHash
    || (innermost?.path ?? null) !== value.containerPath) return false;
  if (value.containerName !== null && !boundedControlFree(value.containerName)) return false;
  if (value.containerHash !== null && !validSha256(value.containerHash)) return false;
  if (!nullableSafePath(value.containerPath)) return false;
  if (value.relationshipId !== null && !boundedControlFree(value.relationshipId, 512)) return false;

  const kinds = chain.map((node) => node.kind);
  const isSingle = (kind: string) => kinds.length === 1 && kinds[0] === kind;
  const isExtracted = (kind: "pdf" | "docx") => (kinds.length === 1 && kinds[0] === kind)
    || (kinds.length === 2 && (kinds[0] === "folder" || kinds[0] === "zip") && kinds[1] === kind);
  const outer = chain[0] as Record<string, unknown> | undefined;
  if (outer?.kind === "folder"
    && (outer.sha256 !== null || outer.path !== null || outer.byteCount !== null)) return false;
  if (outer?.kind === "zip" && outer.path !== null) return false;
  if (kinds.length === 2 && (innermost?.path === null || value.containerPath === null)) return false;
  if (kinds.length === 1 && (kinds[0] === "pdf" || kinds[0] === "docx")
    && (innermost?.path !== null || value.containerPath !== null)) return false;

  switch (value.intakeKind) {
    case "direct":
      return chain.length === 0
        && value.sourcePath === null
        && value.pageNumber === null
        && value.relationshipId === null;
    case "folder":
      return isSingle("folder")
        && value.sourcePath !== null
        && value.pageNumber === null
        && value.relationshipId === null;
    case "zip":
      return isSingle("zip")
        && value.sourcePath !== null
        && value.pageNumber === null
        && value.relationshipId === null;
    case "pdf-extracted":
      return isExtracted("pdf")
        && value.sourcePath === null
        && safeInteger(value.pageNumber, 1)
        && value.relationshipId === null;
    case "docx-extracted":
      return isExtracted("docx")
        && value.sourcePath === null
        && value.pageNumber === null;
    default:
      return false;
  }
}

function validOcr(value: unknown): boolean {
  if (!exactKeys(value, OCR_KEYS)
    || !["off", "processing", "needs-review", "accepted", "rejected", "failed"].includes(value.status as string)
    || !safeInteger(value.operationGeneration)
    || !safeInteger(value.reviewRevision)
    || value.detectedText !== null && !isImageOcrTextWithinLimit(value.detectedText)
    || value.reviewedText !== null && !isImageOcrTextWithinLimit(value.reviewedText)) return false;
  if (value.status === "processing" || value.status === "needs-review") return false;
  if (value.status === "accepted") return typeof value.reviewedText === "string";
  return value.reviewedText === null;
}

function validWarnings(value: unknown): value is readonly string[] {
  return Array.isArray(value)
    && value.length <= 100
    && value.every((warning) => boundedControlFree(warning, 2_000));
}

function basicItemValidity(item: unknown): item is ImagePackageSnapshotItem {
  if (!exactKeys(item, ITEM_KEYS)
    || !boundedControlFree(item.occurrenceId, 512)
    || !safeInteger(item.incarnation, 1)
    || !(item.sourceBytes instanceof Blob)
    || !safeInteger(item.byteCount, 1)
    || item.byteCount > MAX_IMAGE_INPUT_BYTES
    || !validSha256(item.sourceHash)
    || !Object.hasOwn(MIME_EXTENSION, item.mimeType as string)
    || typeof item.fileExtension !== "string"
    || !["png", "jpg", "jpeg", "webp", "avif"].includes(item.fileExtension)
    || !exactKeys(item.dimensions, DIMENSION_KEYS)
    || !safeInteger(item.dimensions.width, 1)
    || !safeInteger(item.dimensions.height, 1)
    || item.dimensions.width > MAX_IMAGE_AXIS
    || item.dimensions.height > MAX_IMAGE_AXIS
    || item.dimensions.width * item.dimensions.height > MAX_IMAGE_PIXELS
    || typeof item.dimensions.megapixels !== "number"
    || !Number.isFinite(item.dimensions.megapixels)
    || item.dimensions.megapixels !== item.dimensions.width * item.dimensions.height / 1_000_000
    || !exactKeys(item.settings, SETTINGS_KEYS)
    || !isImagePromptSettings(item.settings)
    || !validOcr(item.ocr)
    || !validWarnings(item.warnings)
    || !safeInteger(item.reviewRevision)
    || !boundedControlFree(item.expectedProfileVersion, 128)
    || !boundedControlFree(item.expectedProfileVerifiedAt, 64)
    || !validProvenance(item.provenance)) return false;
  return true;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Image package build cancelled.", "AbortError");
}

function snapshotItems(snapshot: unknown): readonly ImagePackageSnapshotItem[] | null {
  if (!exactKeys(snapshot, SNAPSHOT_KEYS)
    || !safeInteger(snapshot.sessionGeneration)
    || !safeInteger(snapshot.reviewGeneration)
    || !safeInteger(snapshot.confirmedReviewGeneration)
    || snapshot.confirmedReviewGeneration !== snapshot.reviewGeneration
    || !Array.isArray(snapshot.items)
    || snapshot.items.length < 1
    || snapshot.items.length > MAX_IMAGE_SESSION_COUNT) return null;
  let totalBytes = 0;
  for (const item of snapshot.items) {
    if (!basicItemValidity(item)) return null;
    totalBytes += item.byteCount;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_IMAGE_SESSION_BYTES) return null;
  }
  return snapshot.items;
}

function profileFor(item: ImagePackageSnapshotItem) {
  return IMAGE_PROMPT_PROFILES.find((profile) => profile.id === item.settings.modelFamily) ?? null;
}

function cloneBuildItem(item: ImagePackageSnapshotItem): ImagePackageSnapshotItem {
  return {
    ...item,
    sourceBytes: item.sourceBytes.slice(0, item.byteCount, item.mimeType),
    dimensions: { ...item.dimensions },
    provenance: {
      ...item.provenance,
      containerChain: item.provenance.containerChain.map((node) => ({ ...node })),
    },
    settings: { ...item.settings },
    ocr: { ...item.ocr },
    warnings: [...item.warnings],
  };
}

function promptItem(item: ImagePackageSnapshotItem): ImagePortalItem {
  return {
    id: item.occurrenceId,
    incarnation: item.incarnation,
    sourceBytes: item.sourceBytes,
    byteCount: item.byteCount,
    sourceHash: item.sourceHash,
    mimeType: item.mimeType,
    fileExtension: item.fileExtension,
    dimensions: item.dimensions,
    provenance: item.provenance,
    included: true,
    bulkSelected: false,
    ocr: item.ocr,
    settings: item.settings,
    warnings: item.warnings,
    reviewRevision: item.reviewRevision,
  };
}

interface RevalidatedPair {
  readonly item: ImagePackageSnapshotItem;
  readonly ordinal: number;
  readonly key: string;
  readonly paths: ReturnType<typeof imagePairPaths>;
  readonly sourceData: Uint8Array;
  readonly profile: (typeof IMAGE_PROMPT_PROFILES)[number];
  readonly prompt: string;
  readonly runCard: string;
}

interface MaterializedEntry {
  readonly path: string;
  readonly data: string | Uint8Array;
  readonly compression: "STORE" | "DEFLATE";
  readonly mediaType: string;
}

const textEncoder = new TextEncoder();

function withFinalLf(value: string): string {
  return `${value.replace(/\n*$/u, "")}\n`;
}

function dataBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === "string" ? textEncoder.encode(data) : data;
}

export async function hashImagePackageBlob(source: Blob, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  let buffer: ArrayBuffer;
  try {
    buffer = await source.arrayBuffer();
  } catch (error) {
    throwIfAborted(signal);
    throw error;
  }
  throwIfAborted(signal);
  let digest: ArrayBuffer;
  try {
    digest = await crypto.subtle.digest("SHA-256", buffer);
  } catch (error) {
    throwIfAborted(signal);
    throw error;
  }
  throwIfAborted(signal);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashBlob(
  source: Blob,
  options: ImagePackageBuildOptions,
): Promise<string> {
  throwIfAborted(options.signal);
  let value: string;
  try {
    value = options.hash
      ? await options.hash(source)
      : await hashImagePackageBlob(source, options.signal);
  } catch (error) {
    throwIfAborted(options.signal);
    throw error;
  }
  throwIfAborted(options.signal);
  if (!validSha256(value)) throw new Error("IMAGE_PACKAGE_HASH_INVALID");
  return value;
}

async function artifactRecord(
  entry: MaterializedEntry,
  options: ImagePackageBuildOptions,
): Promise<ImageArtifactRecord> {
  throwIfAborted(options.signal);
  const bytes = dataBytes(entry.data);
  const sha256 = await hashBlob(new Blob([bytes.slice().buffer]), options);
  throwIfAborted(options.signal);
  return Object.freeze({ path: entry.path, byteCount: bytes.byteLength, sha256, mediaType: entry.mediaType });
}

function provenanceLabel(provenance: ImageProvenance): string {
  const origin = provenance.sourcePath
    ?? provenance.containerChain.at(-1)?.path
    ?? provenance.containerChain.at(-1)?.name
    ?? "Direct image";
  return `${provenance.intakeKind}: ${origin}`;
}

function htmlPair(pair: RevalidatedPair, sourceReference: string): ImageHtmlPair {
  return {
    ordinal: pair.ordinal,
    key: pair.key,
    displayName: pair.item.provenance.sourceName,
    sourceReference,
    sourceBytes: pair.item.sourceBytes,
    mimeType: pair.item.mimeType,
    provenanceLabel: provenanceLabel(pair.item.provenance),
    profileLabel: pair.profile.label,
    prompt: pair.prompt,
    runCard: pair.runCard,
    warnings: pair.item.warnings,
    officialSourceUrls: pair.profile.officialSourceUrls,
  };
}

function metadataText(pair: RevalidatedPair, ocr: ImagePackagePairManifestV1["ocr"]): string {
  return `${JSON.stringify({
    ordinal: pair.ordinal,
    key: pair.key,
    displayName: pair.item.provenance.sourceName,
    source: {
      path: pair.paths.source,
      mediaType: pair.item.mimeType,
      extension: pair.item.fileExtension,
      byteCount: pair.item.byteCount,
      sha256: pair.item.sourceHash,
      width: pair.item.dimensions.width,
      height: pair.item.dimensions.height,
      provenance: pair.item.provenance,
    },
    configuration: {
      settings: pair.item.settings,
      profile: {
        id: pair.profile.id,
        label: pair.profile.label,
        referenceModel: pair.profile.referenceModel,
        profileVersion: pair.profile.profileVersion,
        lastVerifiedAt: pair.profile.lastVerifiedAt,
        officialSourceUrls: pair.profile.officialSourceUrls,
        capabilityNotes: pair.profile.capabilityNotes,
      },
    },
    ocr,
    warnings: pair.item.warnings,
    paths: {
      source: pair.paths.source,
      prompt: pair.paths.prompt,
      runCard: pair.paths.runCard,
    },
  }, null, 2)}\n`;
}

function readmeText(full: ImageFullHtmlRecord): string {
  const fullStatus = full.status === "generated"
    ? `OPEN-ME-FULL.html was generated (${full.byteCount} bytes).`
    : `OPEN-ME-FULL.html was omitted because its encoded size would exceed ${full.limitBytes} bytes.`;
  return withFinalLf([
    "# ReWord Nerd Image prompt package",
    "",
    "This local package contains one source image and one exact prompt per pair, plus a provider run card.",
    "Extract the ZIP before opening OPEN-ME.html so sibling image paths remain available.",
    "Use COPY PROMPT and COPY IMAGE where supported. OPEN IMAGE, DOWNLOAD IMAGE, and image dragging remain available fallbacks.",
    "Image generation is stochastic. Review faces, text, logos, fine geometry, and structured layouts before use.",
    "Confirm ownership or permission for each source and review the selected provider's current policies; this is informational, not legal advice.",
    "No model is executed, no image is uploaded, and no network request is made by these HTML files.",
    "Direct-image and recoverable DOCX-media bytes are preserved exactly and may retain EXIF or location metadata.",
    "PDF visuals are locally rasterized PNG recovery output, not original PDF image-stream bytes.",
    "Original PDF, DOCX, and ZIP containers are not included.",
    fullStatus,
  ].join("\n"));
}

function createDefaultImageArchive(signal?: AbortSignal): import("./contracts").ImagePackageArchiveWriter {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { bufferedWrite: true, dataDescriptor: false });
  return {
    async add(path, data, options) {
      throwIfAborted(signal);
      const bytes = dataBytes(typeof data === "string" ? data : data.slice());
      try {
        await writer.add(path, new Uint8ArrayReader(bytes), {
          level: options.compression === "STORE" ? 0 : 9,
          lastModDate: new Date(Date.UTC(1980, 0, 1)),
          extendedTimestamp: true,
          externalFileAttributes: 0o100644 << 16,
          dataDescriptor: false,
          comment: "",
        });
      } catch (error) {
        throwIfAborted(signal);
        throw error;
      }
      throwIfAborted(signal);
    },
    async close() {
      throwIfAborted(signal);
      let bytes: Uint8Array;
      try {
        bytes = await writer.close(new Uint8Array());
      } catch (error) {
        throwIfAborted(signal);
        throw error;
      }
      throwIfAborted(signal);
      return new Blob([bytes.slice()], { type: "application/zip" });
    },
  };
}

export async function buildImagePromptPackage(
  snapshot: Readonly<ImagePackageSnapshot>,
  options: ImagePackageBuildOptions = {},
): Promise<ImagePackageBuildResult> {
  throwIfAborted(options.signal);
  const untrustedItems = snapshotItems(snapshot);
  if (!untrustedItems) return failure("INVALID_SNAPSHOT");
  const items = untrustedItems.map(cloneBuildItem);
  const decoder = options.decoder ?? createBrowserImageDecodeAdapter();
  const pairs: RevalidatedPair[] = [];

  for (const [index, item] of items.entries()) {
    throwIfAborted(options.signal);
    if (item.sourceBytes.size !== item.byteCount
      || item.sourceBytes.type !== item.mimeType
      || !(MIME_EXTENSION[item.mimeType] as readonly string[]).includes(item.fileExtension)) {
      return failure("SOURCE_REVALIDATION_FAILED");
    }
    const profile = profileFor(item);
    if (!profile) return failure("INVALID_SNAPSHOT");
    if (profile.profileVersion !== item.expectedProfileVersion
      || profile.lastVerifiedAt !== item.expectedProfileVerifiedAt) return failure("PROFILE_VERSION_MISMATCH");

    try {
      const prepared = await prepareImageInput({
        name: `source.${item.fileExtension}`,
        type: item.mimeType,
        size: item.byteCount,
        arrayBuffer: () => item.sourceBytes.arrayBuffer(),
      });
      throwIfAborted(options.signal);
      const validated = await validatePreparedImage(prepared, {
        decoder,
        hash: options.hash,
        signal: options.signal,
      });
      throwIfAborted(options.signal);
      if (validated.byteCount !== item.byteCount
        || validated.mimeType !== item.mimeType
        || validated.fileExtension !== item.fileExtension
        || validated.sourceHash !== item.sourceHash
        || validated.width !== item.dimensions.width
        || validated.height !== item.dimensions.height) return failure("SOURCE_REVALIDATION_FAILED");
      const sourceData = new Uint8Array(await item.sourceBytes.arrayBuffer());
      throwIfAborted(options.signal);
      if (sourceData.byteLength !== item.byteCount) return failure("SOURCE_REVALIDATION_FAILED");
      const ordinal = index + 1;
      const key = imagePairKey(ordinal, item.provenance.sourceName);
      pairs.push({
        item,
        ordinal,
        key,
        paths: imagePairPaths(key, item.fileExtension),
        sourceData,
        profile,
        prompt: profile.promptBuilder(promptItem(item)),
        runCard: profile.runCardBuilder(promptItem(item)),
      });
    } catch (error) {
      throwIfAborted(options.signal);
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      if (error instanceof ImageIntakeFailure && error.issue.code === "HASH_FAILED") {
        return failure("HASH_UNAVAILABLE");
      }
      return failure("SOURCE_REVALIDATION_FAILED");
    }
  }

  throwIfAborted(options.signal);
  const entries: MaterializedEntry[] = [];
  const pairManifests: ImagePackagePairManifestV1[] = [];
  const previewPairs: ImageBuiltPairPreview[] = [];

  try {
    for (const pair of pairs) {
      throwIfAborted(options.signal);
      const acceptedOcr = pair.item.ocr.status === "accepted" ? pair.item.ocr.reviewedText : null;
      const ocr: ImagePackagePairManifestV1["ocr"] = acceptedOcr === null
        ? { accepted: false, acceptedTextSha256: null, acceptedCodePoints: null }
        : {
            accepted: true,
            acceptedTextSha256: await hashBlob(new Blob([textEncoder.encode(acceptedOcr)]), options),
            acceptedCodePoints: Array.from(acceptedOcr).length,
          };
      throwIfAborted(options.signal);

      const prompt = withFinalLf(pair.prompt);
      const runCard = withFinalLf(pair.runCard);
      const metadata = metadataText(pair, ocr);
      const openMe = renderImagePairHtml(htmlPair(pair, `./source.${pair.item.fileExtension}`));
      const pairEntries: Record<keyof ImagePackagePairManifestV1["artifacts"], MaterializedEntry> = {
        source: { path: pair.paths.source, data: pair.sourceData, compression: "STORE", mediaType: pair.item.mimeType },
        prompt: { path: pair.paths.prompt, data: prompt, compression: "DEFLATE", mediaType: "text/plain; charset=utf-8" },
        runCard: { path: pair.paths.runCard, data: runCard, compression: "DEFLATE", mediaType: "text/markdown; charset=utf-8" },
        metadata: { path: pair.paths.metadata, data: metadata, compression: "DEFLATE", mediaType: "application/json" },
        openMe: { path: pair.paths.openMe, data: openMe, compression: "DEFLATE", mediaType: "text/html; charset=utf-8" },
      };
      const artifacts = {
        source: await artifactRecord(pairEntries.source, options),
        prompt: await artifactRecord(pairEntries.prompt, options),
        runCard: await artifactRecord(pairEntries.runCard, options),
        metadata: await artifactRecord(pairEntries.metadata, options),
        openMe: await artifactRecord(pairEntries.openMe, options),
      };
      if (artifacts.source.sha256 !== pair.item.sourceHash) return failure("SOURCE_REVALIDATION_FAILED");
      entries.push(...Object.values(pairEntries));
      pairManifests.push({
        ordinal: pair.ordinal,
        key: pair.key,
        displayName: pair.item.provenance.sourceName,
        source: {
          path: pair.paths.source,
          mediaType: pair.item.mimeType,
          extension: pair.item.fileExtension,
          byteCount: pair.item.byteCount,
          sha256: pair.item.sourceHash,
          width: pair.item.dimensions.width,
          height: pair.item.dimensions.height,
          provenance: pair.item.provenance,
        },
        configuration: {
          settings: pair.item.settings,
          profile: {
            id: pair.profile.id,
            label: pair.profile.label,
            referenceModel: pair.profile.referenceModel,
            profileVersion: pair.profile.profileVersion,
            lastVerifiedAt: pair.profile.lastVerifiedAt,
            officialSourceUrls: pair.profile.officialSourceUrls,
            capabilityNotes: pair.profile.capabilityNotes,
          },
        },
        ocr,
        warnings: pair.item.warnings,
        artifacts,
      });
      previewPairs.push({
        occurrenceId: pair.item.occurrenceId,
        sourceHash: pair.item.sourceHash,
        key: pair.key,
        displayName: pair.item.provenance.sourceName,
        sourceFilename: `source.${pair.item.fileExtension}`,
        sourceBytes: pair.item.sourceBytes.slice(0, pair.item.byteCount, pair.item.mimeType),
        mimeType: pair.item.mimeType,
        width: pair.item.dimensions.width,
        height: pair.item.dimensions.height,
        provenance: pair.item.provenance,
        profileLabel: pair.profile.label,
        prompt: pair.prompt,
        runCard: pair.runCard,
        warnings: pair.item.warnings,
      });
    }

    const rootHtmlPairs = pairs.map((pair) => htmlPair(pair, pair.paths.source));
    const openMe = renderImageRootHtml(rootHtmlPairs);
    throwIfAborted(options.signal);
    const full = await renderImageFullHtml(rootHtmlPairs, options.signal);
    throwIfAborted(options.signal);
    let fullRecord: ImageFullHtmlRecord;
    if (full.status === "generated") {
      const fullEntry: MaterializedEntry = {
        path: "OPEN-ME-FULL.html",
        data: full.html,
        compression: "DEFLATE",
        mediaType: "text/html; charset=utf-8",
      };
      const record = await artifactRecord(fullEntry, options);
      entries.push(fullEntry);
      fullRecord = {
        status: "generated",
        path: "OPEN-ME-FULL.html",
        byteCount: record.byteCount,
        sha256: record.sha256,
        limitBytes: 33_554_432,
      };
    } else {
      fullRecord = {
        status: "omitted",
        path: null,
        byteCount: null,
        sha256: null,
        limitBytes: 33_554_432,
        reason: "encoded-size-limit",
      };
    }
    if (full.status === "generated" && full.byteCount > IMAGE_FULL_HTML_MAX_BYTES) {
      return failure("INVALID_SNAPSHOT");
    }
    const readme = readmeText(fullRecord);
    const readmeEntry: MaterializedEntry = {
      path: "README.md",
      data: readme,
      compression: "DEFLATE",
      mediaType: "text/markdown; charset=utf-8",
    };
    const openMeEntry: MaterializedEntry = {
      path: "OPEN-ME.html",
      data: openMe,
      compression: "DEFLATE",
      mediaType: "text/html; charset=utf-8",
    };
    const readmeRecord = await artifactRecord(readmeEntry, options);
    const openMeRecord = await artifactRecord(openMeEntry, options);
    entries.push(readmeEntry, openMeEntry);

    const pairArtifacts = pairManifests.flatMap((pair) => Object.values(pair.artifacts));
    const rootArtifacts = [readmeRecord, openMeRecord];
    if (fullRecord.status === "generated") {
      rootArtifacts.push({
        path: fullRecord.path,
        byteCount: fullRecord.byteCount,
        sha256: fullRecord.sha256,
        mediaType: "text/html; charset=utf-8",
      });
    }
    const artifactInventory = [...pairArtifacts, ...rootArtifacts]
      .sort((left, right) => stableImageArchiveCompare(left.path, right.path));
    const manifest: ImagePackageManifestV1 = {
      schemaVersion: IMAGE_PACKAGE_SCHEMA_VERSION,
      package: {
        name: "reword-nerd",
        format: IMAGE_PACKAGE_FORMAT,
        filename: IMAGE_PACKAGE_FILENAME,
        fixedTimestamp: IMAGE_PACKAGE_FIXED_TIMESTAMP,
        pairCount: pairManifests.length,
        pairOrder: "confirmed-queue-order",
      },
      privacy: {
        generatedLocally: true,
        automaticUploads: false,
        networkRequests: false,
        sourceBytesMayRetainExifOrLocation: true,
        originalContainersIncluded: false,
      },
      rootArtifacts: { readme: readmeRecord, openMe: openMeRecord, fullOpenMe: fullRecord },
      pairs: pairManifests,
      artifactInventory,
      manifestSelfRecord: { path: "manifest.json", sha256: null, reason: "self-referential-artifact" },
    };
    const manifestEntry: MaterializedEntry = {
      path: "manifest.json",
      data: `${JSON.stringify(manifest, null, 2)}\n`,
      compression: "DEFLATE",
      mediaType: "application/json",
    };
    entries.push(manifestEntry);

    const allPaths = entries.map((entry) => entry.path);
    assertUniquePortableImageArchivePaths(allPaths);
    const inventoryPaths = artifactInventory.map((artifact) => artifact.path);
    const nonManifestPaths = allPaths.filter((path) => path !== "manifest.json")
      .sort(stableImageArchiveCompare);
    if (JSON.stringify(inventoryPaths) !== JSON.stringify(nonManifestPaths)) {
      return failure("INVALID_SNAPSHOT");
    }

    const archive = options.createArchive?.() ?? createDefaultImageArchive(options.signal);
    for (const entry of [...entries].sort((left, right) => stableImageArchiveCompare(left.path, right.path))) {
      throwIfAborted(options.signal);
      await archive.add(entry.path, entry.data, { compression: entry.compression });
      throwIfAborted(options.signal);
    }
    throwIfAborted(options.signal);
    const packageBytes = await archive.close();
    throwIfAborted(options.signal);
    if (!(packageBytes instanceof Blob) || packageBytes.size < 1 || packageBytes.type !== "application/zip") {
      return failure("ARCHIVE_GENERATION_FAILED");
    }
    const packageSha256 = await hashBlob(packageBytes, options);
    throwIfAborted(options.signal);
    return {
      ok: true,
      output: {
        packageName: IMAGE_PACKAGE_FILENAME,
        packageBytes,
        packageByteCount: packageBytes.size,
        packageSha256,
        itemCount: pairs.length,
        manifest,
        previewPairs,
      },
    };
  } catch (error) {
    throwIfAborted(options.signal);
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof Error && error.message === "IMAGE_FULL_HTML_SIZE_MISMATCH") {
      return failure("INVALID_SNAPSHOT");
    }
    if (error instanceof Error && error.message === "IMAGE_PACKAGE_HASH_INVALID") {
      return failure("HASH_UNAVAILABLE");
    }
    return failure("ARCHIVE_GENERATION_FAILED");
  }
}
