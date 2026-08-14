import { createTimestampedZipFilename } from "../../downloadFilename";
import type { ImageDownloadResult } from "./contracts";

const UNAVAILABLE_MESSAGE = "The local Image package is not available for download.";
const FAILED_MESSAGE = "The Image package download could not be started safely.";

export function initiateImagePackageDownload(blob: Blob): ImageDownloadResult {
  if (!(blob instanceof Blob) || blob.size < 1 || blob.type !== "application/zip") {
    return { ok: false, message: UNAVAILABLE_MESSAGE };
  }
  let url: string | null = null;
  let anchor: HTMLAnchorElement | null = null;
  try {
    url = URL.createObjectURL(blob);
    anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = createTimestampedZipFilename("reword-nerd-image-prompt-package");
    anchor.rel = "noopener";
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    const ownedUrl = url;
    window.setTimeout(() => URL.revokeObjectURL(ownedUrl), 100);
    return { ok: true };
  } catch {
    anchor?.remove();
    if (url) URL.revokeObjectURL(url);
    return { ok: false, message: FAILED_MESSAGE };
  }
}
