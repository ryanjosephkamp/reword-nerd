// Image intake: turns image files, folders, ZIPs, Word files, and PDFs into images to
// regenerate. Heavy libraries (zip.js, pdf.js, Tesseract) load only when a file needs them.
import { recognizeText } from "../ocr";
import type { ImageSettings, ImageSource, Rejection } from "../types";
import { openZipArchive } from "../zip";
import { ImageReadError, rethrowIfAborted } from "./errors";
import { IMAGE_LIMITS } from "./limits";
import { openPdfFile } from "./pdfImages";
import { encodePdfImageAsPng } from "./pngEncoder";
import {
  folderInputs,
  readImages,
  type ImageReaderAdapters,
  type ReadImagesOptions,
} from "./reader";
import { decodeImageSize } from "./validate";

export type { ReadImagesOptions } from "./reader";
export { IMAGE_INPUT_ACCEPT, isSupportedImageInputName } from "./formats";
export { IMAGE_LIMITS } from "./limits";
export { ImageReadError } from "./errors";

export const DEFAULT_IMAGE_SETTINGS: ImageSettings = Object.freeze({
  aspectRatio: "match-source",
  keepVisibleText: true,
  keepBackground: true,
  changes: "",
  mustKeep: "",
});

const browserAdapters: ImageReaderAdapters = {
  decode: decodeImageSize,
  openZip: openZipArchive,
  openPdf: openPdfFile,
  encodePdfImage: encodePdfImageAsPng,
  createId: () => crypto.randomUUID(),
};

/** Reads chosen or dropped files. Images keep the order given; ZIP contents go by path. */
export function readImageFiles(
  files: File[],
  options: ReadImagesOptions,
): Promise<{ images: ImageSource[]; rejected: Rejection[] }> {
  const inputs = files.map((file) => ({ name: file.name, file }));
  return readImages(inputs, options, browserAdapters);
}

/** Reads a chosen or dropped folder, in path order. `path` includes the folder's own name. */
export function readImageFolder(
  files: { file: File; path: string }[],
  options: ReadImagesOptions,
): Promise<{ images: ImageSource[]; rejected: Rejection[] }> {
  return readImages(folderInputs(files), options, browserAdapters);
}

/** Reads the words shown in an image, for keeping them in the regenerated version. */
export async function readVisibleText(image: Blob, signal?: AbortSignal): Promise<string> {
  let text: string;
  try {
    ({ text } = await recognizeText(image, signal));
  } catch (error) {
    rethrowIfAborted(error, signal);
    throw new ImageReadError("Couldn't read the text in this image.");
  }
  const cleaned = text
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+$/gmu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  const limit = IMAGE_LIMITS.maxVisibleTextCharacters;
  if (Array.from(cleaned).length > limit) {
    throw new ImageReadError(
      `This image has more text than can be kept (over ${limit.toLocaleString("en-US")} ` +
        "characters).",
    );
  }
  return cleaned;
}
