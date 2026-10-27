/** Byte limits are transport safeguards, not a claim about a host token window. */
export const COLLECTION_LIMITS = Object.freeze({
  textMembers: 8,
  imageMembers: 4,
  projectEntries: 64,
  includedProjectFiles: 32,
  transportBytes: 64 * 1024 * 1024,
  packageBytes: 24 * 1024 * 1024,
  totalPackageBytes: 32 * 1024 * 1024,
  expandedBytes: 64 * 1024 * 1024,
  archiveEntries: 512,
  archiveEntryBytes: 16 * 1024 * 1024,
  originalBytes: 8 * 1024 * 1024,
  totalOriginalBytes: 16 * 1024 * 1024,
  reviewedBytes: 64 * 1024,
  totalReviewedBytes: 128 * 1024,
  memberPromptBytes: 256 * 1024,
  initialPromptBytes: 512 * 1024,
  hydratedPromptBytes: 2 * 1024 * 1024,
  metadataBytes: 256 * 1024,
  instructionBytes: 8 * 1024,
  responseBytes: 256 * 1024,
  memberResponseBytes: 64 * 1024,
  imageBytes: 8 * 1024 * 1024,
  imageDimension: 2048,
  imagePromptBytes: 64 * 1024,
  history: 16,
});
export const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;
export function boundedCount(value: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw Error(`${label} exceeds the ${maximum} limit.`);
}
export function boundedText(value: string, maximum: number, label: string): void {
  if (typeof value !== "string" || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw Error(`${label} must be well-formed literal Unicode.`);
  boundedCount(utf8Bytes(value), maximum, label);
}
/** Reject aliases; never change a user's path to make it pass. */
export function collectionPath(value: string): string {
  boundedText(value, 1024, "Item path");
  if (!value || value.startsWith("/") || value.includes("\\") || /[:%?#]/u.test(value) || Array.from(value).some(c => c.codePointAt(0)! < 32 || (c.codePointAt(0)! >= 127 && c.codePointAt(0)! <= 159))
    || value.split("/").some(part => !part || part === "." || part === ".." || /[. ]$/u.test(part)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) throw Error("Unsafe collection path.");
  return value;
}
export function uniquePaths(paths: readonly string[]): void {
  const seen = new Set<string>();
  for (const path of paths) {
    // Upper/lower folding also rejects common multi-character and final-sigma aliases.
    const alias = collectionPath(path).normalize("NFKC").toUpperCase().toLowerCase();
    if ([...seen].some(prior => prior === alias || prior.startsWith(alias + "/") || alias.startsWith(prior + "/"))) throw Error("Duplicate, case or Unicode path collision.");
    seen.add(alias);
  }
}
export const COLLECTION_STAGES = ["decompose", "rewrite", "verify", "final"] as const;
export type CollectionStage = typeof COLLECTION_STAGES[number];
