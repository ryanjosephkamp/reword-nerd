// Which files the text engine reads, how each is shown, and how raw bytes become text safely.
import type { DocumentFormat, PreviewKind } from "../types";

export interface TextKind {
  format: DocumentFormat;
  languageId: string;
  previewKind: PreviewKind;
}

export const PLAIN_TEXT: Readonly<TextKind> = Object.freeze({
  format: "text",
  languageId: "plaintext",
  previewKind: "plain-text",
});

const MARKDOWN: TextKind = { format: "markdown", languageId: "markdown", previewKind: "markdown" };
const HTML: TextKind = { format: "html", languageId: "html", previewKind: "markup" };
const YAML: TextKind = { format: "yaml", languageId: "yaml", previewKind: "structured-data" };
const CONFIG: TextKind = { format: "config", languageId: "ini", previewKind: "structured-data" };
const LATEX: TextKind = { format: "latex", languageId: "latex", previewKind: "latex" };

const TEXT_EXTENSIONS: Readonly<Record<string, TextKind>> = {
  ".txt": PLAIN_TEXT,
  ".md": MARKDOWN,
  ".markdown": MARKDOWN,
  ".html": HTML,
  ".htm": HTML,
  ".xhtml": HTML,
  ".xml": { format: "xml", languageId: "xml", previewKind: "markup" },
  ".json": { format: "json", languageId: "json", previewKind: "structured-data" },
  ".jsonl": { format: "jsonl", languageId: "jsonl", previewKind: "structured-data" },
  ".ndjson": { format: "ndjson", languageId: "jsonl", previewKind: "structured-data" },
  ".csv": { format: "csv", languageId: "csv", previewKind: "table" },
  ".tsv": { format: "tsv", languageId: "tsv", previewKind: "table" },
  ".yaml": YAML,
  ".yml": YAML,
  ".toml": { format: "toml", languageId: "toml", previewKind: "structured-data" },
  ".ini": { format: "ini", languageId: "ini", previewKind: "structured-data" },
  ".config": CONFIG,
  ".conf": CONFIG,
  ".css": { format: "css", languageId: "css", previewKind: "code" },
  ".scss": { format: "code", languageId: "scss", previewKind: "code" },
  ".sass": { format: "code", languageId: "sass", previewKind: "code" },
  ".less": { format: "code", languageId: "less", previewKind: "code" },
  ".sql": { format: "sql", languageId: "sql", previewKind: "code" },
  ".tex": LATEX,
  ".ltx": LATEX,
};

const CODE_LANGUAGES: Readonly<Record<string, string>> = {
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".mts": "typescript",
  ".cts": "typescript",
  ".py": "python",
  ".pyw": "python",
  ".rb": "ruby",
  ".php": "php",
  ".java": "java",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".go": "go",
  ".rs": "rust",
  ".swift": "swift",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".scala": "scala",
  ".sh": "shellscript",
  ".bash": "shellscript",
  ".zsh": "shellscript",
  ".fish": "shellscript",
  ".ps1": "powershell",
  ".r": "r",
  ".lua": "lua",
  ".pl": "perl",
  ".pm": "perl",
  ".dart": "dart",
  ".vue": "vue",
  ".svelte": "svelte",
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".fs": "fsharp",
  ".fsx": "fsharp",
  ".hs": "haskell",
  ".clj": "clojure",
  ".cljs": "clojure",
  ".sol": "solidity",
};

/** Word, PDF, and ZIP files, which have readers of their own. */
const DOCUMENT_EXTENSIONS = new Set([".docx", ".pdf", ".zip"]);

function unsupported(extensions: string[], reason: string): [string, string][] {
  return extensions.map((extension) => [extension, reason]);
}

const UNSUPPORTED: ReadonlyMap<string, string> = new Map([
  ...unsupported(
    [".doc"],
    "Older Word files (.doc) can't be read. Save it as .docx in Word and add it again.",
  ),
  ...unsupported(
    [".rtf"],
    "Rich Text files (.rtf) can't be read. Save it as .docx or plain text and add it again.",
  ),
  ...unsupported(
    [".odt", ".pages"],
    "This kind of document can't be read. Save it as a Word file (.docx) and add it again.",
  ),
  ...unsupported(
    [".xls", ".xlsx", ".ods", ".numbers"],
    "Spreadsheets can't be read. Save the sheet as CSV and add that instead.",
  ),
  ...unsupported(
    [".ppt", ".pptx", ".odp"],
    "Presentations can't be read. Export the slides as a PDF and add that instead.",
  ),
  ...unsupported(
    [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".avif", ".ico"],
    "This is an image, not a text document.",
  ),
  ...unsupported(
    [".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".mp4", ".mov", ".avi", ".mkv", ".webm"],
    "Audio and video files can't be read as text.",
  ),
  ...unsupported(
    [".exe", ".dll", ".dylib", ".so", ".dmg", ".msi"],
    "Programs and system files can't be read as text.",
  ),
  ...unsupported([".ttf", ".otf", ".woff", ".woff2"], "Font files can't be read as text."),
  ...unsupported(
    [".tar", ".gz", ".tgz", ".bz2", ".xz", ".rar", ".7z"],
    "Only .zip archives can be opened. Unpack this one and add the folder, or make a .zip of it.",
  ),
]);

export function baseName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
}

/** Lowercase extension with its dot, or "" for names like "README" and ".gitignore". */
export function extensionOf(name: string): string {
  const base = baseName(name);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

/** How a file with this name is shown, or undefined when the name alone doesn't say. */
export function textKindForName(name: string): TextKind | undefined {
  const extension = extensionOf(name);
  const known = TEXT_EXTENSIONS[extension];
  if (known) return { ...known };
  const languageId = CODE_LANGUAGES[extension];
  return languageId ? { format: "code", languageId, previewKind: "code" } : undefined;
}

/**
 * True when the name alone shows the text engine can read the file: a known text, code, Word,
 * PDF, or ZIP file, or a name with no extension (README, Makefile, .gitignore). Other files are
 * still accepted when their contents turn out to be plain text.
 */
export function isSupportedTextName(name: string): boolean {
  const extension = extensionOf(name);
  return (
    extension === "" ||
    extension in TEXT_EXTENSIONS ||
    extension in CODE_LANGUAGES ||
    DOCUMENT_EXTENSIONS.has(extension)
  );
}

/** A plain-language reason when the extension is one the engine never reads. */
export function unsupportedReason(name: string): string | undefined {
  return UNSUPPORTED.get(extensionOf(name));
}

export type DecodeProblem = "binary" | "utf16" | "not-utf8" | "control-characters" | "empty";

export type DecodeResult = { ok: true; text: string } | { ok: false; problem: DecodeProblem };

export const DECODE_PROBLEM_REASONS: Readonly<Record<DecodeProblem, string>> = {
  binary: "This file isn't text. It looks like an image, a program, or another binary file.",
  utf16:
    "This file is saved as UTF-16 text. Open it in a text editor, save it as UTF-8, and add it again.",
  "not-utf8":
    "This file isn't saved as UTF-8 text. Open it in a text editor, save it as UTF-8, and add it again.",
  "control-characters":
    "This file contains hidden control characters that text files don't normally have, so it can't be read as text.",
  empty: "This file has no text in it.",
};

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.length >= signature.length && signature.every((byte, i) => bytes[i] === byte);
}

const ascii = (text: string) => Array.from(text, (character) => character.charCodeAt(0));

// Full signatures only: a two-byte check like "PK" would reject a CSV whose header starts "PK,".
const BINARY_SIGNATURES: readonly (readonly number[])[] = [
  [0x89, 0x50, 0x4e, 0x47],
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
  [0x7f, 0x45, 0x4c, 0x46],
  ascii("%PDF-"),
  [0xff, 0xd8, 0xff],
  ascii("GIF87a"),
  ascii("GIF89a"),
];

export function hasBinarySignature(bytes: Uint8Array): boolean {
  return BINARY_SIGNATURES.some((signature) => startsWith(bytes, signature));
}

export function hasZipSignature(bytes: Uint8Array): boolean {
  return BINARY_SIGNATURES.slice(1, 4).some((signature) => startsWith(bytes, signature));
}

// Tab, line feed, carriage return, and form feed are allowed; other C0 and C1 controls are not.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0001-\u0008\u000b\u000e-\u001f\u007f-\u009f]/;

/** Decodes strict UTF-8, refusing binary data, control characters, and blank files. */
export function decodeText(bytes: Uint8Array): DecodeResult {
  if (hasBinarySignature(bytes)) return { ok: false, problem: "binary" };
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) {
    return { ok: false, problem: "utf16" };
  }
  let text: string;
  try {
    // A leading byte-order mark is dropped from the text; the original bytes keep it.
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, problem: "not-utf8" };
  }
  if (text.includes("\0")) return { ok: false, problem: "binary" };
  if (CONTROL_CHARACTERS.test(text)) return { ok: false, problem: "control-characters" };
  if (text.trim().length === 0) return { ok: false, problem: "empty" };
  return { ok: true, text };
}
