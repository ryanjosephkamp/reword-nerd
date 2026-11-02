// Pictures found inside a document (Word media, Markdown data URIs) become DocumentAssets. The
// text refers to each one as `asset:<id>`, where the id comes from the picture's SHA-256.
import type { DocumentAsset } from "../types";
import { sha256Hex } from "./util";

export const MAX_ASSETS_PER_DOCUMENT = 200;
export const MAX_ASSET_BYTES_PER_DOCUMENT = 100 * 1024 * 1024;

const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/tiff": "tiff",
  "image/x-emf": "emf",
  "image/x-wmf": "wmf",
};

export function imageExtension(mimeType: string): string {
  return IMAGE_EXTENSIONS[mimeType.toLowerCase()] ?? "bin";
}

export function assetReference(id: string): string {
  return `asset:${id}`;
}

/** Collects pictures for one document, skipping repeats and stopping at the size limits. */
export class AssetCollector {
  readonly assets: DocumentAsset[] = [];
  private readonly byHash = new Map<string, DocumentAsset>();
  private totalBytes = 0;

  /** Returns the asset for these bytes, or null when the document's limits are reached. */
  async add(
    bytes: Uint8Array<ArrayBuffer>,
    mimeType: string,
    altText?: string,
  ): Promise<DocumentAsset | null> {
    const sha256 = await sha256Hex(bytes);
    const existing = this.byHash.get(sha256);
    if (existing) return existing;
    if (
      this.assets.length >= MAX_ASSETS_PER_DOCUMENT ||
      this.totalBytes + bytes.byteLength > MAX_ASSET_BYTES_PER_DOCUMENT
    ) {
      return null;
    }
    const type = mimeType.toLowerCase() || "application/octet-stream";
    const asset: DocumentAsset = {
      id: `asset-${sha256.slice(0, 12)}`,
      filename: `image-${this.assets.length + 1}.${imageExtension(type)}`,
      mimeType: type,
      bytes: new Blob([bytes], { type }),
      ...(altText?.trim() ? { altText: altText.trim() } : {}),
    };
    this.byHash.set(sha256, asset);
    this.assets.push(asset);
    this.totalBytes += bytes.byteLength;
    return asset;
  }
}
