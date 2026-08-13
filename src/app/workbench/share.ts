import { copyText, type CopyTextResult } from "./copyText";

export const CANONICAL_WORKBENCH_URL = "https://ryanjosephkamp.github.io/reword-nerd/";

export type ShareResult = "shared" | "cancelled" | "copied" | "manual";

interface ShareCanonicalUrlOptions {
  nativeShare?: (data: ShareData) => Promise<void>;
  copy?: (url: string) => Promise<CopyTextResult>;
}

function isCancelled(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

export async function shareCanonicalUrl({ nativeShare, copy = copyText }: ShareCanonicalUrlOptions = {}): Promise<ShareResult> {
  const share = nativeShare ?? navigator.share?.bind(navigator);
  if (share) {
    try {
      await share({ title: "reword-nerd", url: CANONICAL_WORKBENCH_URL });
      return "shared";
    } catch (error) {
      if (isCancelled(error)) return "cancelled";
    }
  }
  return (await copy(CANONICAL_WORKBENCH_URL)) === "copied" ? "copied" : "manual";
}
