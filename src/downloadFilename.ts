function formatDownloadTimestamp(instant: Date): string {
  return instant.toISOString()
    .replace(/\.\d{3}Z$/u, "Z")
    .replaceAll(":", "-");
}

export function createTimestampedZipFilename(stem: string, instant = new Date()): string {
  return `${stem}-${formatDownloadTimestamp(instant)}.zip`;
}
