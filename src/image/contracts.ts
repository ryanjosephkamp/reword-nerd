export type ImageModelFamilyId =
  | "openai-gpt-image"
  | "google-nano-banana"
  | "xai-grok-imagine"
  | "bfl-flux"
  | "adobe-firefly"
  | "ideogram"
  | "midjourney"
  | "stability-ai"
  | "other-custom";

export type ImageAspectRatio =
  | "match-source"
  | "provider-default"
  | "1:1"
  | "4:3"
  | "3:4"
  | "16:9"
  | "9:16";

export type ImageSizeIntent =
  | "match-source-where-supported"
  | "highest-practical-quality";

export type ImageBackgroundBehavior = "preserve-source" | "provider-default";

export interface ImagePromptSettings {
  readonly modelFamily: ImageModelFamilyId;
  readonly aspectRatio: ImageAspectRatio;
  readonly sizeIntent: ImageSizeIntent;
  readonly preserveVisibleText: boolean;
  readonly backgroundBehavior: ImageBackgroundBehavior;
  readonly requestedChanges: string;
  readonly mustPreserve: string;
}

export const MAX_IMAGE_PROMPT_TEXT_LENGTH = 2_000;
export const MAX_IMAGE_OCR_TEXT_LENGTH = 20_000;

export function isImageOcrTextWithinLimit(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const iterator = value[Symbol.iterator]();
  let codePoints = 0;
  while (!iterator.next().done) {
    codePoints += 1;
    if (codePoints > MAX_IMAGE_OCR_TEXT_LENGTH) return false;
  }
  return true;
}

const IMAGE_MODEL_FAMILY_IDS: readonly ImageModelFamilyId[] = Object.freeze([
  "openai-gpt-image",
  "google-nano-banana",
  "xai-grok-imagine",
  "bfl-flux",
  "adobe-firefly",
  "ideogram",
  "midjourney",
  "stability-ai",
  "other-custom",
]);
const IMAGE_ASPECT_RATIOS: readonly ImageAspectRatio[] = Object.freeze([
  "match-source",
  "provider-default",
  "1:1",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
]);
const IMAGE_SIZE_INTENTS: readonly ImageSizeIntent[] = Object.freeze([
  "match-source-where-supported",
  "highest-practical-quality",
]);
const IMAGE_BACKGROUND_BEHAVIORS: readonly ImageBackgroundBehavior[] = Object.freeze([
  "preserve-source",
  "provider-default",
]);

function supported<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === "string" && choices.includes(value as T);
}

export function isImagePromptSettingValue<Field extends keyof ImagePromptSettings>(
  field: Field,
  value: unknown,
): value is ImagePromptSettings[Field] {
  switch (field) {
    case "modelFamily": return supported(value, IMAGE_MODEL_FAMILY_IDS);
    case "aspectRatio": return supported(value, IMAGE_ASPECT_RATIOS);
    case "sizeIntent": return supported(value, IMAGE_SIZE_INTENTS);
    case "preserveVisibleText": return typeof value === "boolean";
    case "backgroundBehavior": return supported(value, IMAGE_BACKGROUND_BEHAVIORS);
    case "requestedChanges":
    case "mustPreserve":
      return typeof value === "string" && Array.from(value).length <= MAX_IMAGE_PROMPT_TEXT_LENGTH;
  }
}

export function isImagePromptSettings(value: unknown): value is ImagePromptSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  return (Object.keys(DEFAULT_IMAGE_PROMPT_SETTINGS) as (keyof ImagePromptSettings)[]).every(
    (field) => Object.hasOwn(settings, field) && isImagePromptSettingValue(field, settings[field]),
  );
}

export const DEFAULT_IMAGE_PROMPT_SETTINGS: Readonly<ImagePromptSettings> = Object.freeze({
  modelFamily: "openai-gpt-image",
  aspectRatio: "match-source",
  sizeIntent: "match-source-where-supported",
  preserveVisibleText: true,
  backgroundBehavior: "preserve-source",
  requestedChanges: "",
  mustPreserve: "",
});

export function cloneImagePromptSettings(settings: Readonly<ImagePromptSettings>): ImagePromptSettings {
  return { ...settings };
}

export type ImmutableImageBytes = Blob;

export function ownImageBytes(bytes: Uint8Array, mimeType = "application/octet-stream"): ImmutableImageBytes {
  return new Blob([Uint8Array.from(bytes)], { type: mimeType });
}

export async function copyImageBytes(
  bytes: ImmutableImageBytes,
  maximumByteLength: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maximumByteLength)
    || maximumByteLength < 0
    || bytes.size > maximumByteLength) {
    throw new Error("IMAGE_BYTES_LIMIT_EXCEEDED");
  }
  return new Uint8Array(await bytes.arrayBuffer());
}

export type ImageMimeType = "image/png" | "image/jpeg" | "image/webp" | "image/avif";
export type ImageFileExtension = "png" | "jpg" | "jpeg" | "webp" | "avif";
export type ImageIntakeKind = "direct" | "folder" | "zip" | "pdf-extracted" | "docx-extracted";

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
  readonly megapixels: number;
}

export type ImageContainerKind = "folder" | "zip" | "pdf" | "docx";

export interface ImageContainerProvenanceNode {
  readonly kind: ImageContainerKind;
  readonly name: string;
  readonly sha256: string | null;
  readonly path: string | null;
  readonly byteCount: number | null;
}

export interface ImageProvenance {
  readonly intakeKind: ImageIntakeKind;
  readonly sourceName: string;
  readonly sourcePath: string | null;
  readonly containerChain: readonly ImageContainerProvenanceNode[];
  /** Derived compatibility fields for the innermost container node. */
  readonly containerName: string | null;
  readonly containerHash: string | null;
  readonly containerPath: string | null;
  readonly pageNumber: number | null;
  readonly relationshipId: string | null;
}

export type ImageOcrStatus = "off" | "processing" | "needs-review" | "accepted" | "rejected" | "failed";

export interface ImageOcrState {
  readonly status: ImageOcrStatus;
  readonly detectedText: string | null;
  readonly reviewedText: string | null;
  readonly operationGeneration: number;
  readonly reviewRevision: number;
}

export interface ImagePortalItem {
  readonly id: string;
  readonly incarnation: number;
  readonly sourceBytes: ImmutableImageBytes;
  readonly byteCount: number;
  readonly sourceHash: string;
  readonly mimeType: ImageMimeType;
  readonly fileExtension: ImageFileExtension;
  readonly dimensions: Readonly<ImageDimensions>;
  readonly provenance: Readonly<ImageProvenance>;
  readonly included: boolean;
  readonly bulkSelected: boolean;
  readonly ocr: Readonly<ImageOcrState>;
  readonly settings: Readonly<ImagePromptSettings>;
  readonly warnings: readonly string[];
  readonly reviewRevision: number;
}

export interface CreateImagePortalItemInput {
  readonly id: string;
  readonly incarnation: number;
  readonly sourceBytes: ImmutableImageBytes;
  readonly byteCount: number;
  readonly sourceHash: string;
  readonly mimeType: ImageMimeType;
  readonly fileExtension: ImageFileExtension;
  readonly width: number;
  readonly height: number;
  readonly provenance: ImageProvenance;
  readonly settings: ImagePromptSettings;
  readonly warnings?: readonly string[];
}

function cloneContainerChain(
  chain: readonly ImageContainerProvenanceNode[],
): readonly ImageContainerProvenanceNode[] {
  return Object.freeze(chain.map((node) => {
    const safePath = node.path === null || (() => {
      const normalized = node.path.normalize("NFC");
      return normalized === node.path
        && normalized.length > 0
        && !normalized.includes("\\")
        && !normalized.startsWith("/")
        && !/^[A-Za-z]:/u.test(normalized)
        && normalized.split("/").every((segment) => segment.length > 0
          && segment !== "."
          && segment !== ".."
          && !Array.from(segment).some((character) => (character.codePointAt(0) ?? 0) <= 31));
    })();
    const validFolder = node.kind === "folder"
      && node.sha256 === null
      && node.byteCount === null;
    const validContainer = node.kind !== "folder"
      && typeof node.sha256 === "string"
      && /^[a-f0-9]{64}$/iu.test(node.sha256)
      && Number.isSafeInteger(node.byteCount)
      && (node.byteCount ?? 0) > 0;
    if (!node.name || !safePath || (!validFolder && !validContainer)) {
      throw new Error("IMAGE_PROVENANCE_CONTAINER_INVALID");
    }
    return Object.freeze({
      kind: node.kind,
      name: node.name,
      sha256: node.sha256,
      path: node.path,
      byteCount: node.byteCount,
    });
  }));
}

function cloneImageProvenance(provenance: ImageProvenance): Readonly<ImageProvenance> {
  const containerChain = cloneContainerChain(provenance.containerChain);
  const innermost = containerChain.at(-1);
  return Object.freeze({
    intakeKind: provenance.intakeKind,
    sourceName: provenance.sourceName,
    sourcePath: provenance.sourcePath,
    containerChain,
    containerName: innermost?.name ?? null,
    containerHash: innermost?.sha256 ?? null,
    containerPath: innermost?.path ?? null,
    pageNumber: provenance.pageNumber,
    relationshipId: provenance.relationshipId,
  });
}

export function createImagePortalItem(input: CreateImagePortalItemInput): ImagePortalItem {
  if (!Number.isSafeInteger(input.incarnation) || input.incarnation < 1) {
    throw new Error("IMAGE_ITEM_INCARNATION_INVALID");
  }
  if (!Number.isSafeInteger(input.byteCount)
    || input.byteCount < 1
    || input.sourceBytes.size !== input.byteCount) {
    throw new Error("IMAGE_ITEM_BYTE_COUNT_MISMATCH");
  }
  return {
    id: input.id,
    incarnation: input.incarnation,
    sourceBytes: input.sourceBytes,
    byteCount: input.byteCount,
    sourceHash: input.sourceHash,
    mimeType: input.mimeType,
    fileExtension: input.fileExtension,
    dimensions: Object.freeze({
      width: input.width,
      height: input.height,
      megapixels: (input.width * input.height) / 1_000_000,
    }),
    provenance: cloneImageProvenance(input.provenance),
    included: true,
    bulkSelected: false,
    ocr: Object.freeze({
      status: "off",
      detectedText: null,
      reviewedText: null,
      operationGeneration: 0,
      reviewRevision: 0,
    }),
    settings: Object.freeze(cloneImagePromptSettings(input.settings)),
    warnings: Object.freeze([...(input.warnings ?? [])]),
    reviewRevision: 0,
  };
}
