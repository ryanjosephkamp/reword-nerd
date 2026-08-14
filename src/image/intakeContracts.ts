import type {
  ImageFileExtension,
  ImageMimeType,
  ImageProvenance,
} from "./contracts";

export const MAX_IMAGE_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_SESSION_COUNT = 100;
export const MAX_IMAGE_SESSION_BYTES = 100 * 1024 * 1024;
export const MAX_IMAGE_AXIS = 16_384;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MAX_IMAGE_ARCHIVE_ENTRIES = 500;
export const MAX_IMAGE_ARCHIVE_EXPANDED_BYTES = 100 * 1024 * 1024;
export const MAX_IMAGE_ARCHIVE_RATIO = 100;
export const MAX_IMAGE_PATH_BYTES = 1_024;
export const MAX_IMAGE_PATH_SEGMENT_BYTES = 255;
export const MAX_IMAGE_PDF_PAGES = 500;

export type ImageInputKind = "image" | "pdf" | "docx" | "zip";

export type ImageIntakeIssueCode =
  | "INPUT_SIZE_INVALID"
  | "SESSION_COUNT_EXCEEDED"
  | "SESSION_BYTES_EXCEEDED"
  | "UNSUPPORTED_EXTENSION"
  | "UNSUPPORTED_FORMAT"
  | "REMOTE_DOCUMENT_UNSUPPORTED"
  | "MIME_MISMATCH"
  | "SIGNATURE_MISMATCH"
  | "READ_FAILED"
  | "HASH_FAILED"
  | "DECODE_FAILED"
  | "DIMENSIONS_INVALID"
  | "DIMENSIONS_LIMIT_EXCEEDED"
  | "UNSAFE_PATH"
  | "PATH_COLLISION"
  | "LINK_ENTRY_UNSUPPORTED"
  | "ENCRYPTED_ENTRY"
  | "NESTED_ARCHIVE"
  | "ARCHIVE_ENTRY_COUNT_EXCEEDED"
  | "ARCHIVE_ENTRY_SIZE_EXCEEDED"
  | "ARCHIVE_EXPANDED_SIZE_EXCEEDED"
  | "ARCHIVE_COMPRESSION_RATIO_EXCEEDED"
  | "ARCHIVE_LENGTH_MISMATCH"
  | "MALFORMED_ZIP"
  | "MALFORMED_PDF"
  | "MALFORMED_DOCX"
  | "PDF_PASSWORD_PROTECTED"
  | "PDF_PAGE_LIMIT_EXCEEDED"
  | "PDF_CAPTURE_SELECTION_INVALID"
  | "PDF_NO_SUPPORTED_IMAGES"
  | "OCR_TEXT_LIMIT_EXCEEDED"
  | "OCR_FAILED"
  | "PUBLICATION_REENTRANT"
  | "STALE_SESSION";

const ISSUE_MESSAGES: Readonly<Record<ImageIntakeIssueCode, string>> = Object.freeze({
  INPUT_SIZE_INVALID: "The selected input has an invalid or unsupported byte size.",
  SESSION_COUNT_EXCEEDED: "The 100-image session limit would be exceeded.",
  SESSION_BYTES_EXCEEDED: "The 100 MiB retained-image limit would be exceeded.",
  UNSUPPORTED_EXTENSION: "This file extension is not supported for Image intake.",
  UNSUPPORTED_FORMAT: "This image format is not supported in this release.",
  REMOTE_DOCUMENT_UNSUPPORTED: "Remote HTML or Markdown image sources are not supported.",
  MIME_MISMATCH: "The browser-reported file type does not match the selected extension.",
  SIGNATURE_MISMATCH: "The file signature does not match the selected extension.",
  READ_FAILED: "The selected input could not be read safely.",
  HASH_FAILED: "The selected image could not be hashed safely.",
  DECODE_FAILED: "The selected image could not be decoded safely.",
  DIMENSIONS_INVALID: "The decoded image dimensions are invalid.",
  DIMENSIONS_LIMIT_EXCEEDED: "The decoded image exceeds the supported dimension limit.",
  UNSAFE_PATH: "The selected container contains an unsafe path.",
  PATH_COLLISION: "The selected container contains paths that collide across common filesystems.",
  LINK_ENTRY_UNSUPPORTED: "Links inside selected containers are not supported.",
  ENCRYPTED_ENTRY: "Encrypted container entries are not supported.",
  NESTED_ARCHIVE: "Nested ZIP archives are not supported.",
  ARCHIVE_ENTRY_COUNT_EXCEEDED: "The container exceeds the 500-entry safety limit.",
  ARCHIVE_ENTRY_SIZE_EXCEEDED: "A container entry exceeds the 20 MiB safety limit.",
  ARCHIVE_EXPANDED_SIZE_EXCEEDED: "The container exceeds the 100 MiB expanded-byte limit.",
  ARCHIVE_COMPRESSION_RATIO_EXCEEDED: "A container entry exceeds the supported compression ratio.",
  ARCHIVE_LENGTH_MISMATCH: "A container entry did not match its audited expanded size.",
  MALFORMED_ZIP: "The ZIP container could not be read safely.",
  MALFORMED_PDF: "The PDF container could not be read safely.",
  MALFORMED_DOCX: "The DOCX container could not be read safely.",
  PDF_PASSWORD_PROTECTED: "Password-protected PDFs are not supported.",
  PDF_PAGE_LIMIT_EXCEEDED: "The PDF exceeds the 500-page safety limit.",
  PDF_CAPTURE_SELECTION_INVALID: "The selected PDF capture pages or quality are invalid.",
  PDF_NO_SUPPORTED_IMAGES: "The PDF contains no recoverable supported visuals.",
  OCR_TEXT_LIMIT_EXCEEDED: "OCR text exceeded the 20,000-code-point limit and was not retained.",
  OCR_FAILED: "Local OCR could not be completed for this image.",
  PUBLICATION_REENTRANT: "Image publication cannot be nested inside another publication.",
  STALE_SESSION: "The intake result belongs to a session that is no longer current.",
});

export interface ImageIntakeIssue {
  readonly code: ImageIntakeIssueCode;
  readonly message: string;
  readonly path: string | null;
}

export function imageIntakeIssue(code: ImageIntakeIssueCode, path: string | null = null): ImageIntakeIssue {
  return Object.freeze({ code, message: ISSUE_MESSAGES[code], path });
}

export class ImageIntakeFailure extends Error {
  constructor(readonly issue: ImageIntakeIssue) {
    super(issue.message);
    this.name = "ImageIntakeFailure";
  }
}

export function failImageIntake(code: ImageIntakeIssueCode, path: string | null = null): never {
  throw new ImageIntakeFailure(imageIntakeIssue(code, path));
}

export interface ImageInputFile {
  readonly name: string;
  readonly type: string;
  readonly size: number;
  readonly webkitRelativePath?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface PreparedImageSource {
  readonly sourceName: string;
  readonly sourceBytes: Blob;
  readonly byteCount: number;
  readonly mimeType: ImageMimeType;
  readonly fileExtension: ImageFileExtension;
}

export interface ValidatedImageSource extends PreparedImageSource {
  readonly sourceHash: string;
  readonly width: number;
  readonly height: number;
  readonly warnings: readonly string[];
}

export interface ImageAdmission extends Omit<ValidatedImageSource, "sourceName"> {
  readonly id: string;
  readonly ordinal: number;
  readonly provenance: ImageProvenance;
}

export interface ExtractedImageCandidate extends ValidatedImageSource {
  readonly provenance: ImageProvenance;
}

export type ExtractedImageCandidateValidator = (
  prepared: PreparedImageSource,
  provenance: ImageProvenance,
) => Promise<ExtractedImageCandidate>;

export interface ImageIntakeLedgerEntry {
  readonly inputName: string;
  readonly path: string | null;
  readonly status: "accepted" | "rejected";
  readonly occurrenceId: string | null;
  readonly issue: ImageIntakeIssue | null;
}

export interface ImageIntakeResult {
  readonly admissions: readonly ImageAdmission[];
  readonly ledger: readonly ImageIntakeLedgerEntry[];
}
