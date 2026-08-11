import type { DownloadResult } from "./contracts";

export function initiatePromptPackageDownload(blob: Blob): DownloadResult {
  let url: string | undefined;
  let anchor: HTMLAnchorElement | undefined;
  try {
    url = URL.createObjectURL(blob);
    anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "reword-nerd-prompt-package.zip";
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
