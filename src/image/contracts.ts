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

export interface ImmutableImageBytes {
  readonly byteLength: number;
  copy(): Uint8Array;
}

export function ownImageBytes(bytes: Uint8Array): ImmutableImageBytes {
  const owned = Uint8Array.from(bytes);
  return Object.freeze({
    byteLength: owned.byteLength,
    copy: () => Uint8Array.from(owned),
  });
}

export type ImageMimeType = "image/png" | "image/jpeg" | "image/webp" | "image/avif";
export type ImageFileExtension = "png" | "jpg" | "jpeg" | "webp" | "avif";
export type ImageIntakeKind = "direct" | "folder" | "zip" | "pdf-extracted" | "docx-extracted";

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
  readonly megapixels: number;
}

export interface ImageProvenance {
  readonly intakeKind: ImageIntakeKind;
  readonly sourceName: string;
  readonly sourcePath: string | null;
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
  readonly sourceBytes: ImmutableImageBytes;
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
  readonly bytes: Uint8Array;
  readonly sourceHash: string;
  readonly mimeType: ImageMimeType;
  readonly fileExtension: ImageFileExtension;
  readonly width: number;
  readonly height: number;
  readonly provenance: ImageProvenance;
  readonly settings: ImagePromptSettings;
  readonly warnings?: readonly string[];
}

export function createImagePortalItem(input: CreateImagePortalItemInput): ImagePortalItem {
  return {
    id: input.id,
    sourceBytes: ownImageBytes(input.bytes),
    sourceHash: input.sourceHash,
    mimeType: input.mimeType,
    fileExtension: input.fileExtension,
    dimensions: Object.freeze({
      width: input.width,
      height: input.height,
      megapixels: (input.width * input.height) / 1_000_000,
    }),
    provenance: Object.freeze({ ...input.provenance }),
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
