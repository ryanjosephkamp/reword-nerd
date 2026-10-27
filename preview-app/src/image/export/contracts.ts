import type {
  ImageDimensions,
  ImageFileExtension,
  ImageMimeType,
  ImageModelFamilyId,
  ImageOcrState,
  ImagePromptSettings,
  ImageProvenance,
} from "../contracts";
import type { ImageDecodeAdapter } from "../imageValidation";

export const IMAGE_PACKAGE_FORMAT = "image-reference-prompt-package" as const;
export const IMAGE_PACKAGE_SCHEMA_VERSION = 1 as const;
export const IMAGE_PACKAGE_FILENAME = "reword-nerd-image-prompt-package.zip" as const;
export const IMAGE_FULL_HTML_MAX_BYTES = 32 * 1024 * 1024;
export const IMAGE_PACKAGE_FIXED_DATE = new Date(Date.UTC(1980, 0, 1));
export const IMAGE_PACKAGE_FIXED_TIMESTAMP = "1980-01-01T00:00:00.000Z" as const;

export interface ImageArtifactRecord {
  readonly path: string;
  readonly byteCount: number;
  readonly sha256: string;
  readonly mediaType: string;
}

export type ImageFullHtmlRecord =
  | {
      readonly status: "generated";
      readonly path: "OPEN-ME-FULL.html";
      readonly byteCount: number;
      readonly sha256: string;
      readonly limitBytes: 33554432;
    }
  | {
      readonly status: "omitted";
      readonly path: null;
      readonly byteCount: null;
      readonly sha256: null;
      readonly limitBytes: 33554432;
      readonly reason: "encoded-size-limit";
    };

export interface ImagePackagePairManifestV1 {
  readonly ordinal: number;
  readonly key: string;
  readonly displayName: string;
  readonly source: {
    readonly path: string;
    readonly mediaType: ImageMimeType;
    readonly extension: ImageFileExtension;
    readonly byteCount: number;
    readonly sha256: string;
    readonly width: number;
    readonly height: number;
    readonly provenance: ImageProvenance;
  };
  readonly configuration: {
    readonly settings: ImagePromptSettings;
    readonly profile: {
      readonly id: ImageModelFamilyId;
      readonly label: string;
      readonly referenceModel: string;
      readonly profileVersion: string;
      readonly lastVerifiedAt: string;
      readonly officialSourceUrls: readonly string[];
      readonly capabilityNotes: readonly string[];
    };
  };
  readonly ocr: {
    readonly accepted: boolean;
    readonly acceptedTextSha256: string | null;
    readonly acceptedCodePoints: number | null;
  };
  readonly warnings: readonly string[];
  readonly artifacts: {
    readonly source: ImageArtifactRecord;
    readonly prompt: ImageArtifactRecord;
    readonly runCard: ImageArtifactRecord;
    readonly metadata: ImageArtifactRecord;
    readonly openMe: ImageArtifactRecord;
  };
}

export interface ImagePackageManifestV1 {
  readonly schemaVersion: 1;
  readonly package: {
    readonly name: "reword-nerd";
    readonly format: "image-reference-prompt-package";
    readonly filename: "reword-nerd-image-prompt-package.zip";
    readonly fixedTimestamp: "1980-01-01T00:00:00.000Z";
    readonly pairCount: number;
    readonly pairOrder: "confirmed-queue-order";
  };
  readonly privacy: {
    readonly generatedLocally: true;
    readonly automaticUploads: false;
    readonly networkRequests: false;
    readonly sourceBytesMayRetainExifOrLocation: true;
    readonly originalContainersIncluded: false;
  };
  readonly rootArtifacts: {
    readonly readme: ImageArtifactRecord;
    readonly openMe: ImageArtifactRecord;
    readonly fullOpenMe: ImageFullHtmlRecord;
  };
  readonly pairs: readonly ImagePackagePairManifestV1[];
  readonly artifactInventory: readonly ImageArtifactRecord[];
  readonly manifestSelfRecord: {
    readonly path: "manifest.json";
    readonly sha256: null;
    readonly reason: "self-referential-artifact";
  };
}

export interface ImagePackageSnapshotItem {
  readonly occurrenceId: string;
  readonly incarnation: number;
  readonly sourceBytes: Blob;
  readonly byteCount: number;
  readonly sourceHash: string;
  readonly mimeType: ImageMimeType;
  readonly fileExtension: ImageFileExtension;
  readonly dimensions: ImageDimensions;
  readonly provenance: ImageProvenance;
  readonly settings: ImagePromptSettings;
  readonly ocr: ImageOcrState;
  readonly warnings: readonly string[];
  readonly reviewRevision: number;
  readonly expectedProfileVersion: string;
  readonly expectedProfileVerifiedAt: string;
}

export interface ImagePackageSnapshot {
  readonly sessionGeneration: number;
  readonly reviewGeneration: number;
  readonly confirmedReviewGeneration: number;
  readonly items: readonly ImagePackageSnapshotItem[];
}

export interface ImageBuiltPairPreview {
  readonly occurrenceId: string;
  readonly sourceHash: string;
  readonly key: string;
  readonly displayName: string;
  readonly sourceFilename: string;
  readonly sourceBytes: Blob;
  readonly mimeType: ImageMimeType;
  readonly width: number;
  readonly height: number;
  readonly provenance: ImageProvenance;
  readonly profileLabel: string;
  readonly prompt: string;
  readonly runCard: string;
  readonly warnings: readonly string[];
}

export interface ImageBuiltOutput {
  readonly packageName: "reword-nerd-image-prompt-package.zip";
  readonly packageBytes: Blob;
  readonly packageByteCount: number;
  readonly packageSha256: string;
  readonly itemCount: number;
  readonly builtForSessionGeneration: number;
  readonly builtForReviewGeneration: number;
  readonly buildGeneration: number;
  readonly manifest: ImagePackageManifestV1;
  readonly previewPairs: readonly ImageBuiltPairPreview[];
}

export interface ImagePackageBuildPayload {
  readonly packageName: "reword-nerd-image-prompt-package.zip";
  readonly packageBytes: Blob;
  readonly packageByteCount: number;
  readonly packageSha256: string;
  readonly itemCount: number;
  readonly manifest: ImagePackageManifestV1;
  readonly previewPairs: readonly ImageBuiltPairPreview[];
}

export interface ImagePackageFailure {
  readonly code:
    | "IMAGE_SET_NOT_CONFIRMED"
    | "INVALID_SNAPSHOT"
    | "SOURCE_REVALIDATION_FAILED"
    | "PROFILE_VERSION_MISMATCH"
    | "HASH_UNAVAILABLE"
    | "ARCHIVE_GENERATION_FAILED";
  readonly message: string;
}

export type ImagePackageSnapshotResult =
  | { readonly ok: true; readonly snapshot: ImagePackageSnapshot }
  | { readonly ok: false; readonly error: ImagePackageFailure };

export type ImagePackageBuildResult =
  | { readonly ok: true; readonly output: ImagePackageBuildPayload }
  | { readonly ok: false; readonly error: ImagePackageFailure };

export type ImageDownloadResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export type ImageClipboardResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "unavailable" | "denied" | "conversion-failed" };

export interface ImagePackageArchiveWriter {
  add(
    path: string,
    data: string | Uint8Array,
    options: { readonly compression: "STORE" | "DEFLATE" },
  ): void | Promise<void>;
  close(): Promise<Blob>;
}

export interface ImagePackageBuildOptions {
  readonly signal?: AbortSignal;
  readonly decoder?: ImageDecodeAdapter;
  readonly hash?: (source: Blob) => Promise<string>;
  readonly createArchive?: () => ImagePackageArchiveWriter;
}
