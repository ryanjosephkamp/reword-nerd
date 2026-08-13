import type { DocumentFormat } from "./contracts";

export type SourcePreviewKind = "plain-text" | "markdown" | "markup" | "structured-data" | "table" | "code" | "latex";

export interface TextSourceClassification {
  format: DocumentFormat;
  languageId: string;
  previewKind: SourcePreviewKind;
}

export type SafeTextIssue = "INVALID_UTF8" | "EMPTY_CONTENT" | "UNSAFE_TEXT_CONTROLS" | "UNSUPPORTED_BINARY";

export type SafeTextDecodeResult =
  | { ok: true; text: string }
  | { ok: false; issue: SafeTextIssue };

const genericText = Object.freeze<TextSourceClassification>({
  format: "text",
  languageId: "plaintext",
  previewKind: "plain-text",
});

const textExtensions: Readonly<Record<string, TextSourceClassification>> = Object.freeze({
  ".txt": genericText,
  ".md": { format: "markdown", languageId: "markdown", previewKind: "markdown" },
  ".markdown": { format: "markdown", languageId: "markdown", previewKind: "markdown" },
  ".html": { format: "html", languageId: "html", previewKind: "markup" },
  ".htm": { format: "html", languageId: "html", previewKind: "markup" },
  ".xhtml": { format: "html", languageId: "html", previewKind: "markup" },
  ".xml": { format: "xml", languageId: "xml", previewKind: "markup" },
  ".json": { format: "json", languageId: "json", previewKind: "structured-data" },
  ".jsonl": { format: "jsonl", languageId: "jsonl", previewKind: "structured-data" },
  ".ndjson": { format: "ndjson", languageId: "jsonl", previewKind: "structured-data" },
  ".csv": { format: "csv", languageId: "csv", previewKind: "table" },
  ".tsv": { format: "tsv", languageId: "tsv", previewKind: "table" },
  ".yaml": { format: "yaml", languageId: "yaml", previewKind: "structured-data" },
  ".yml": { format: "yaml", languageId: "yaml", previewKind: "structured-data" },
  ".toml": { format: "toml", languageId: "toml", previewKind: "structured-data" },
  ".ini": { format: "ini", languageId: "ini", previewKind: "structured-data" },
  ".config": { format: "config", languageId: "ini", previewKind: "structured-data" },
  ".conf": { format: "config", languageId: "ini", previewKind: "structured-data" },
  ".css": { format: "css", languageId: "css", previewKind: "code" },
  ".scss": { format: "code", languageId: "scss", previewKind: "code" },
  ".sass": { format: "code", languageId: "sass", previewKind: "code" },
  ".less": { format: "code", languageId: "less", previewKind: "code" },
  ".sql": { format: "sql", languageId: "sql", previewKind: "code" },
  ".tex": { format: "latex", languageId: "latex", previewKind: "latex" },
  ".ltx": { format: "latex", languageId: "latex", previewKind: "latex" },
});

const codeLanguages: Readonly<Record<string, string>> = Object.freeze({
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
});

const explicitlyUnsupportedExtensions = new Set([
  ".rtf", ".doc", ".xls", ".xlsx", ".ppt", ".pptx",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff",
  ".mp3", ".wav", ".mp4", ".mov", ".avi", ".exe", ".dll", ".dylib", ".so",
  ".tar", ".gz", ".tgz", ".rar", ".7z",
]);

export function sourceExtension(name: string): string {
  const basename = name.slice(Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) + 1);
  const dot = basename.lastIndexOf(".");
  return dot <= 0 ? "" : basename.slice(dot).toLowerCase();
}

export function classifyStandaloneTextName(name: string): TextSourceClassification | undefined {
  const extension = sourceExtension(name);
  const known = textExtensions[extension];
  if (known) return { ...known };
  const languageId = codeLanguages[extension];
  return languageId ? { format: "code", languageId, previewKind: "code" } : undefined;
}

export function genericTextClassification(): TextSourceClassification {
  return { ...genericText };
}

export function isExplicitlyUnsupportedName(name: string): boolean {
  return explicitlyUnsupportedExtensions.has(sourceExtension(name));
}

export function isTextDocumentFormat(format: DocumentFormat): boolean {
  return !new Set<DocumentFormat>(["docx", "pdf", "latex-project"]).has(format);
}

function hasBinarySignature(bytes: Uint8Array): boolean {
  if (bytes.length >= 4) {
    const four = Array.from(bytes.slice(0, 4));
    if ((four[0] === 0x89 && four[1] === 0x50 && four[2] === 0x4e && four[3] === 0x47)
      || (four[0] === 0x50 && four[1] === 0x4b)
      || (four[0] === 0x7f && four[1] === 0x45 && four[2] === 0x4c && four[3] === 0x46)
      || (four[0] === 0x25 && four[1] === 0x50 && four[2] === 0x44 && four[3] === 0x46)) return true;
  }
  return (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a)
    || (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    || (bytes.length >= 6 && new TextDecoder().decode(bytes.slice(0, 6)) === "GIF89a")
    || (bytes.length >= 6 && new TextDecoder().decode(bytes.slice(0, 6)) === "GIF87a");
}

export function decodeSafeStandaloneText(bytes: Uint8Array): SafeTextDecodeResult {
  if (hasBinarySignature(bytes)) return { ok: false, issue: "UNSUPPORTED_BINARY" };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, issue: "INVALID_UTF8" };
  }
  if (text.includes("\0")) return { ok: false, issue: "EMPTY_CONTENT" };
  const hasUnsupportedControl = Array.from(text).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (codePoint >= 1 && codePoint <= 8)
      || codePoint === 11
      || codePoint === 12
      || (codePoint >= 14 && codePoint <= 31)
      || (codePoint >= 127 && codePoint <= 159);
  });
  if (hasUnsupportedControl) {
    return { ok: false, issue: "UNSAFE_TEXT_CONTROLS" };
  }
  if (text.trim().length === 0) return { ok: false, issue: "EMPTY_CONTENT" };
  return { ok: true, text };
}
