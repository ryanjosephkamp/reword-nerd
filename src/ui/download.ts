/** Saves a Blob through the browser's normal download flow. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke after the click has been handled; revoking immediately can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
