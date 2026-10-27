export const RESULT_PREVIEW_LIMIT = 50_000;

/** Canonical document response markers from prompts/00_one_shot.md. */
export const RESULT_MARKERS = {
  start: "<<<FINAL_DOCUMENT>>>",
  end: "<<<END_FINAL_DOCUMENT>>>",
  auditStart: "<<<FIDELITY_AUDIT>>>",
  auditEnd: "<<<END_FIDELITY_AUDIT>>>",
} as const;

export interface ParsedStudioResult {
  mode: "final-document" | "full-response";
  text: string;
  audit: string | null;
  note: string;
}

/**
 * Recognize the exact standalone marker contract, never instructions in the response.
 * Ambiguity, missing boundaries, or unrelated content preserves the complete input.
 */
export function parseStudioResult(response: string): ParsedStudioResult {
  const fullResponse = (note: string): ParsedStudioResult => ({
    mode: "full-response",
    text: response,
    audit: null,
    note,
  });
  const startCount = response.split(RESULT_MARKERS.start).length - 1;
  const endCount = response.split(RESULT_MARKERS.end).length - 1;
  if (startCount === 0 && endCount === 0) {
    return fullResponse(
      "No final-document markers found. Use Edit result to keep only the document you want.",
    );
  }
  if (startCount !== 1 || endCount !== 1) {
    return fullResponse(
      "The document boundaries are incomplete or repeated. Your full response is preserved for manual review.",
    );
  }
  const finalMatch = response
    .trim()
    .match(
      /^[\t ]*<<<FINAL_DOCUMENT>>>[\t ]*\r?\n([\s\S]*?)\r?\n[\t ]*<<<END_FINAL_DOCUMENT>>>[\t ]*(?:\r?\n|$)([\s\S]*)$/,
    );
  if (!finalMatch || !finalMatch[1].trim()) {
    return fullResponse(
      "A complete, standalone final-document block could not be identified. Edit the full response to choose your result.",
    );
  }
  const remainder = finalMatch[2].trim();
  let audit: string | null = null;
  if (remainder) {
    const auditStartCount =
      response.split(RESULT_MARKERS.auditStart).length - 1;
    const auditEndCount = response.split(RESULT_MARKERS.auditEnd).length - 1;
    const auditMatch = remainder.match(
      /^[\t ]*<<<FIDELITY_AUDIT>>>[\t ]*\r?\n([\s\S]*?)\r?\n[\t ]*<<<END_FIDELITY_AUDIT>>>[\t ]*$/,
    );
    if (auditStartCount !== 1 || auditEndCount !== 1 || !auditMatch) {
      return fullResponse(
        "There is additional content outside the document block. Your full response is preserved so you can choose what to keep.",
      );
    }
    audit = auditMatch[1];
  }
  return {
    mode: "final-document",
    text: finalMatch[1],
    audit,
    note: "The final-document block is separated from the pasted response. Review it against your source before using it.",
  };
}

/** Download a plain Markdown file; the content never becomes an HTML document. */
export function downloadStudioResult(text: string): boolean {
  let url: string | undefined;
  let anchor: HTMLAnchorElement | undefined;
  try {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    url = URL.createObjectURL(blob);
    anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "reword-nerd-result.md";
    anchor.rel = "noopener";
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url!), 100);
    return true;
  } catch {
    anchor?.remove();
    if (url) URL.revokeObjectURL(url);
    return false;
  }
}
