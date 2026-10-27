export function sourceBoundaryToken(treeHash: string, files: readonly { text: string }[]): string {
  const canonicalHash = treeHash.replaceAll(/[^a-f0-9]/giu, "").toUpperCase();
  let length = Math.min(12, canonicalHash.length);
  let token = `SOURCE_BOUNDARY_${canonicalHash.slice(0, length)}`;
  const content = files.map((file) => file.text).join("\n");
  while (content.includes(token)) {
    if (length < canonicalHash.length) length = Math.min(canonicalHash.length, length + 4);
    else token += "_X";
    token = length < canonicalHash.length || !token.endsWith("_X")
      ? `SOURCE_BOUNDARY_${canonicalHash.slice(0, length)}`
      : token;
  }
  return token;
}
