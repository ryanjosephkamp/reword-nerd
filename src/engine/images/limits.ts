// Limits that keep one batch of images within what a browser tab can hold comfortably.

const MB = 1024 * 1024;

export const IMAGE_LIMITS = {
  /** Largest single image file. */
  maxImageBytes: 20 * MB,
  /** Largest PDF, Word, or ZIP file. */
  maxContainerBytes: 100 * MB,
  /** Longest side of an image, in pixels. */
  maxImageSide: 16_384,
  /** Largest image area, in pixels. */
  maxImagePixels: 40_000_000,
  /** Most images one call can add. */
  maxImagesPerBatch: 100,
  /** Most image bytes one call can add. */
  maxBatchBytes: 100 * MB,
  /** Most files one ZIP or Word file may contain. */
  maxArchiveEntries: 500,
  /** Most bytes one ZIP (including any Word file inside it) may unpack to. */
  maxArchiveExpandedBytes: 100 * MB,
  /** Largest unpacked-to-stored size ratio for a file inside a ZIP. */
  maxCompressionRatio: 100,
  /** Most PDF pages read from one file. */
  maxPdfPages: 500,
  /** Pictures inside a PDF smaller than this on either side are icons, rules, or dots. */
  minPdfPictureSide: 32,
  /** Page captures aim for this resolution. */
  pdfCaptureDpi: 150,
  /** Longest text kept from reading the words in an image. */
  maxVisibleTextCharacters: 20_000,
} as const;

/** Pictures smaller than this on either side are probably decorative. */
export const SMALL_PICTURE_SIDE = 64;
