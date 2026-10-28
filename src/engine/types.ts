// Shared shapes for everything reword_nerd reads, prepares, and hands off.

export type DocumentFormat =
  | "text"
  | "markdown"
  | "html"
  | "xml"
  | "json"
  | "jsonl"
  | "ndjson"
  | "csv"
  | "tsv"
  | "yaml"
  | "toml"
  | "ini"
  | "config"
  | "css"
  | "sql"
  | "code"
  | "latex"
  | "docx"
  | "pdf";

/** How the reviewed text should be displayed. */
export type PreviewKind =
  "plain-text" | "markdown" | "markup" | "structured-data" | "table" | "code" | "latex";

/** A figure or picture found inside a document (Word media, PDF images, embedded data URIs). */
export interface DocumentAsset {
  id: string;
  filename: string;
  mimeType: string;
  bytes: Blob;
  pageNumber?: number;
  caption?: string;
  altText?: string;
}

/** OCR text recognized on a page or picture, kept separate until the user accepts it. */
export interface OcrPassage {
  id: string;
  label: string;
  /** The PDF page the text came from, so accepted text lands in the right place. */
  pageNumber?: number;
  text: string;
  confidence: number;
  accepted: boolean;
}

/** One readable text file, on its own or inside a project. */
export interface TextSource {
  id: string;
  kind: "text";
  /** Path inside its project, or the file name for a standalone file. */
  path: string;
  /** Project this file belongs to, or null for a standalone file. */
  projectId: string | null;
  format: DocumentFormat;
  languageId: string;
  previewKind: PreviewKind;
  /** The file exactly as it was added. */
  original: Blob;
  byteCount: number;
  /** SHA-256 of the original bytes, used to spot duplicates. */
  sha256: string;
  /** Text as first read from the file, including any accepted OCR. */
  extractedText: string;
  /** Text after the user's edits. This is what gets rewritten. */
  text: string;
  /** Whether this file is part of the job. */
  included: boolean;
  /** Plain-language notes about how the file was read. */
  notes: string[];
  assets: DocumentAsset[];
  ocr: OcrPassage[];
}

export type ProjectExclusion =
  | "dependency-or-build-output"
  | "lock-file"
  | "binary"
  | "too-large"
  | "credentials"
  | "ignored-by-gitignore"
  | "unreadable-text"
  | "nested-archive";

/** A folder or ZIP of files added together. */
export interface TextProject {
  id: string;
  name: string;
  from: "folder" | "zip";
  /** LaTeX projects get a main-file choice and LaTeX-aware instructions. */
  classification: "latex" | "general";
  mainFile: string | null;
  /**
   * Files left out automatically, with the reason, so the user can see what was skipped.
   * A path ending in "/" stands for a whole folder.
   */
  excluded: { path: string; reason: ProjectExclusion }[];
  /** Non-text files kept for the agent package (images, fonts, PDFs referenced by the project). */
  assets: { path: string; bytes: Blob }[];
}

export type ImageMimeType = "image/png" | "image/jpeg" | "image/webp" | "image/avif";

export type AspectRatio = "match-source" | "1:1" | "4:3" | "3:4" | "16:9" | "9:16";

export interface ImageSettings {
  aspectRatio: AspectRatio;
  keepVisibleText: boolean;
  keepBackground: boolean;
  /** What should change, in the user's words. Empty means a faithful re-render. */
  changes: string;
  /** What must not change, in the user's words. */
  mustKeep: string;
}

/** One image to regenerate. */
export interface ImageSource {
  id: string;
  kind: "image";
  name: string;
  /** Where the image came from when it was found inside another file. */
  from: { container: string; pageNumber?: number } | null;
  original: Blob;
  mimeType: ImageMimeType;
  width: number;
  height: number;
  byteCount: number;
  sha256: string;
  included: boolean;
  /** Text recognized in the image, editable; used when keepVisibleText is on. */
  visibleText: string;
  /** Settings for this image; null means it follows the shared defaults. */
  settings: ImageSettings | null;
  notes: string[];
}

/** A file that could not be added, with a reason written for the user. */
export interface Rejection {
  name: string;
  reason: string;
}

export interface Progress {
  label: string;
  completed: number;
  total: number;
}
