export const stableCompare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

export function normalizeDocumentBase(name: string): string {
  const normalized = name.normalize("NFKD").replace(/\p{M}/gu, "");
  let output = "";
  let previousWasSeparator = false;
  for (const character of normalized) {
    if ((character >= "A" && character <= "Z") || (character >= "a" && character <= "z") || (character >= "0" && character <= "9")) {
      output += character.toLowerCase();
      previousWasSeparator = false;
    } else if (!previousWasSeparator && output.length > 0) {
      output += "-";
      previousWasSeparator = true;
    }
  }
  const capped = Array.from(output.replace(/-+$/u, "")).slice(0, 48).join("").replace(/-+$/u, "");
  return capped || "document";
}

export function extensionForFormat(format: unknown): string | undefined {
  switch (format) {
    case "text": return "txt";
    case "markdown": return "md";
    case "html": return "html";
    case "xml": return "xml";
    case "json": return "json";
    case "jsonl": return "jsonl";
    case "ndjson": return "ndjson";
    case "csv": return "csv";
    case "tsv": return "tsv";
    case "yaml": return "yaml";
    case "toml": return "toml";
    case "ini": return "ini";
    case "config": return "conf";
    case "css": return "css";
    case "sql": return "sql";
    case "code": return "txt";
    case "docx": return "docx";
    case "pdf": return "pdf";
    case "latex": return "tex";
    case "latex-project": return "zip";
  }
}

export function isSafeArchivePath(path: string): boolean {
  return path.length > 0
    && !path.startsWith("/")
    && !path.includes("\\")
    && !path.split("/").some((part) => part === "" || part === "." || part === "..")
    && Array.from(path).every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 0x20 && codePoint !== 0x7f;
    });
}
