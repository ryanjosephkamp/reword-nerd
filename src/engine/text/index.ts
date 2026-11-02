// The text engine: reads text, code, Markdown, LaTeX, Word, and PDF files, plus folders and
// ZIPs of them, into TextSources and TextProjects for review. Converters load on first use.
//
// Word and Markdown pictures become assets, and the text refers to each as `asset:<id>`.
// PDF text has one `--- Page N ---` section per page; OCR passages stay separate until accepted.
import { readFiles, readFolder, type ReadTextOptions, type ReadTextResult } from "./read";

export type { ReadTextOptions, ReadTextResult } from "./read";
export { isSupportedTextName } from "./formats";
export { addAcceptedOcr } from "./pdfText";

/** Standalone files. A .zip becomes a project: LaTeX if it has a .tex main file, otherwise general. */
export function readTextFiles(files: File[], options: ReadTextOptions): Promise<ReadTextResult> {
  return readFiles(files, options);
}

/**
 * Files from <input webkitdirectory> or a dropped folder. Each path starts with the folder's
 * name (as in webkitRelativePath); an empty path falls back to webkitRelativePath.
 */
export function readTextFolder(
  files: { file: File; path: string }[],
  options: ReadTextOptions,
): Promise<ReadTextResult> {
  return readFolder(files, options);
}

/** A rough token count for sizing a job: one token per four characters, rounded up. */
export function estimateTokens(text: string): number {
  let characters = text.length;
  // A surrogate pair (most emoji) is one character, not two.
  for (let i = 0; i < text.length - 1; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        characters -= 1;
        i += 1;
      }
    }
  }
  return Math.ceil(characters / 4);
}
