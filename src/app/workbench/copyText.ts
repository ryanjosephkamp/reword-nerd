export type CopyTextResult = "copied" | "select-manually";

export async function copyText(text: string): Promise<CopyTextResult> {
  if (globalThis.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return "copied";
    } catch {
      // Continue to the browser-compatible selection fallback.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  try {
    if (typeof document.execCommand === "function" && document.execCommand("copy")) {
      return "copied";
    }
  } catch {
    // Leave the visible prompt available for manual selection.
  } finally {
    textarea.remove();
  }
  return "select-manually";
}
