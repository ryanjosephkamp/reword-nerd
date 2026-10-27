import { hashBytes, type HashAdapter } from "./extraction";
import type { VisualAsset } from "./media";
import { MAX_VISUAL_ASSET_BYTES_PER_DOCUMENT, MAX_VISUAL_ASSETS_PER_DOCUMENT } from "./media";

const supportedDataImages: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export interface MarkdownMediaExtraction {
  text: string;
  assets: VisualAsset[];
  warnings: string[];
}

export async function extractMarkdownMedia(
  source: string,
  enabled: boolean,
  hasher?: HashAdapter | null,
): Promise<MarkdownMediaExtraction> {
  const pattern = /!\[([^\]]*)\]\(data:([^;,\s]+);base64,([A-Za-z0-9+/=\s]+)\)/g;
  const matches = [...source.matchAll(pattern)];
  if (matches.length === 0) return { text: source, assets: [], warnings: [] };
  if (!enabled) {
    return {
      text: source.replace(pattern, (_whole, alt: string) => `[Embedded image omitted: ${alt.trim() || "untitled image"}]`),
      assets: [],
      warnings: ["Embedded Markdown images were not extracted because image extraction is off."],
    };
  }

  const assetsByHash = new Map<string, VisualAsset>();
  const replacements = new Map<number, { length: number; text: string }>();
  const warnings: string[] = [];
  let totalBytes = 0;
  for (const [order, match] of matches.entries()) {
    const index = match.index ?? 0;
    const altText = match[1].trim();
    const mimeType = match[2].toLowerCase();
    const imageExtension = supportedDataImages[mimeType];
    if (!imageExtension) {
      replacements.set(index, { length: match[0].length, text: `[Embedded image omitted: ${altText || "unsupported image"}]` });
      warnings.push(`An embedded ${mimeType || "unknown"} Markdown image was not extracted.`);
      continue;
    }
    let bytes: Uint8Array;
    try {
      const normalized = match[3].replace(/\s+/g, "");
      bytes = Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
    } catch {
      replacements.set(index, { length: match[0].length, text: `[Embedded image omitted: ${altText || "invalid image"}]` });
      warnings.push("An invalid embedded Markdown image was omitted.");
      continue;
    }
    if (assetsByHash.size >= MAX_VISUAL_ASSETS_PER_DOCUMENT
      || totalBytes + bytes.byteLength > MAX_VISUAL_ASSET_BYTES_PER_DOCUMENT) {
      replacements.set(index, { length: match[0].length, text: `[Embedded image omitted: ${altText || "image limit reached"}]` });
      warnings.push("The visual-asset extraction limit was reached; additional Markdown images were omitted.");
      continue;
    }
    const sha256 = await hashBytes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), hasher);
    const id = `asset-${sha256.slice(0, 12)}`;
    if (!assetsByHash.has(sha256)) {
      assetsByHash.set(sha256, {
        id,
        kind: "markdown-data-image",
        filename: `${id}.${imageExtension}`,
        mimeType,
        bytes,
        byteCount: bytes.byteLength,
        sha256,
        order,
        altText: altText || undefined,
        included: true,
        decorative: false,
        warnings: [],
      });
      totalBytes += bytes.byteLength;
    }
    replacements.set(index, { length: match[0].length, text: `![${altText}](asset:${id})` });
  }
  let cursor = 0;
  const parts: string[] = [];
  for (const [index, replacement] of [...replacements].sort(([left], [right]) => left - right)) {
    parts.push(source.slice(cursor, index), replacement.text);
    cursor = index + replacement.length;
  }
  parts.push(source.slice(cursor));
  return { text: parts.join(""), assets: [...assetsByHash.values()], warnings: [...new Set(warnings)] };
}
