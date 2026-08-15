import { copyText, type CopyTextResult } from "../app/workbench/copyText";
import { canonicalPortalUrl } from "../app/portal/portalUrls";

export const CANONICAL_IMAGE_URL = canonicalPortalUrl("image");

export type ImageShareResult = "shared" | "cancelled" | "copied" | "manual";

interface ShareImageCanonicalUrlOptions {
  nativeShare?: (data: ShareData) => Promise<void>;
  copy?: (url: string) => Promise<CopyTextResult>;
}

function isCancelled(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

export async function shareImageCanonicalUrl({ nativeShare, copy = copyText }: ShareImageCanonicalUrlOptions = {}): Promise<ImageShareResult> {
  const share = nativeShare ?? navigator.share?.bind(navigator);
  if (share) {
    try {
      await share({ title: "reword-nerd Image", url: CANONICAL_IMAGE_URL });
      return "shared";
    } catch (error) {
      if (isCancelled(error)) return "cancelled";
    }
  }
  return (await copy(CANONICAL_IMAGE_URL)) === "copied" ? "copied" : "manual";
}
