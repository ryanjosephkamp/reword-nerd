// Markdown files sometimes embed pictures as base64 data URIs. Those pictures become assets and
// the text gets a short `asset:` reference in their place, so the text stays readable and small.
import type { DocumentAsset } from "../types";
import { AssetCollector, assetReference } from "./assets";
import { base64ToBytes, plural } from "./util";

const DATA_IMAGE = /!\[([^\]]*)\]\(data:([^;,\s)]+);base64,([A-Za-z0-9+/=\s]+)\)/g;

export interface MarkdownPictures {
  text: string;
  assets: DocumentAsset[];
  notes: string[];
}

export async function extractMarkdownPictures(source: string): Promise<MarkdownPictures> {
  const matches = [...source.matchAll(DATA_IMAGE)];
  if (matches.length === 0) return { text: source, assets: [], notes: [] };

  const collector = new AssetCollector();
  const parts: string[] = [];
  let cursor = 0;
  let omitted = 0;
  for (const match of matches) {
    const [whole, alt, mimeType, base64] = match;
    const altText = alt.trim();
    let replacement: string;
    let asset: DocumentAsset | null = null;
    if (mimeType.toLowerCase().startsWith("image/")) {
      try {
        asset = await collector.add(base64ToBytes(base64.replace(/\s+/g, "")), mimeType, altText);
      } catch {
        asset = null;
      }
    }
    if (asset) {
      replacement = `![${altText}](${assetReference(asset.id)})`;
    } else {
      omitted += 1;
      replacement = `[Picture left out: ${altText || "untitled"}]`;
    }
    parts.push(source.slice(cursor, match.index), replacement);
    cursor = match.index + whole.length;
  }
  parts.push(source.slice(cursor));

  const notes: string[] = [];
  if (collector.assets.length > 0) {
    notes.push(
      "Pictures embedded in this file are kept separately, and the text marks where each one goes.",
    );
  }
  if (omitted > 0) {
    notes.push(
      omitted === 1
        ? "1 embedded picture couldn't be read and was replaced with a placeholder."
        : `${plural(omitted, "embedded picture", "embedded pictures")} couldn't be read and were replaced with placeholders.`,
    );
  }
  return { text: parts.join(""), assets: collector.assets, notes };
}
