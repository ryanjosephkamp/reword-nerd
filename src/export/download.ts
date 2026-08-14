import type { DownloadResult } from "./contracts";
import { createTimestampedZipFilename } from "../downloadFilename";

function initiateDownload(blob: Blob, filename: string): DownloadResult {
  let url: string | undefined;
  let anchor: HTMLAnchorElement | undefined;
  try {
    url = URL.createObjectURL(blob);
    anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url!), 100);
    return { ok: true };
  } catch {
    anchor?.remove();
    if (url) URL.revokeObjectURL(url);
    return { ok: false, error: { code: "ARCHIVE_GENERATION_FAILED", message: "The download could not be initiated safely." } };
  }
}

export function initiatePromptPackageDownload(blob: Blob): DownloadResult {
  return initiateDownload(blob, createTimestampedZipFilename("reword-nerd-text-prompt-package"));
}

export function initiateWorkbookProgressDownload(html: string, filename: string): DownloadResult {
  return initiateDownload(new Blob([html], { type: "text/html;charset=utf-8" }), filename);
}
