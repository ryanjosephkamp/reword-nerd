import type { ImageClipboardResult } from "./contracts";

export async function copyImagePrompt(text: string): Promise<ImageClipboardResult> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    await navigator.clipboard.writeText(text);
    return { ok: true };
  } catch {
    return { ok: false, reason: "denied" };
  }
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export async function copyImageSource(
  source: Blob,
  rendered: HTMLImageElement,
): Promise<ImageClipboardResult> {
  if (source.size < 1
    || !source.type.startsWith("image/")
    || typeof navigator === "undefined"
    || !navigator.clipboard?.write
    || typeof ClipboardItem === "undefined"
    || typeof location !== "undefined" && location.protocol === "file:") {
    return { ok: false, reason: "unavailable" };
  }
  if (rendered.naturalWidth < 1 || rendered.naturalHeight < 1) {
    return { ok: false, reason: "conversion-failed" };
  }
  const canvas = document.createElement("canvas");
  canvas.width = rendered.naturalWidth;
  canvas.height = rendered.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) return { ok: false, reason: "conversion-failed" };
  try {
    context.drawImage(rendered, 0, 0, canvas.width, canvas.height);
    const png = await canvasPng(canvas);
    if (!png) return { ok: false, reason: "conversion-failed" };
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return { ok: true };
  } catch (error) {
    return error instanceof DOMException && error.name === "NotAllowedError"
      ? { ok: false, reason: "denied" }
      : { ok: false, reason: "conversion-failed" };
  }
}
