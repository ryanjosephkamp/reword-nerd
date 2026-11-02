// Turns a batch of files into images: plain images, the pictures inside Word files and PDFs,
// and the contents of ZIPs, each checked, deduplicated, and kept within the batch limits.
import type { ImageMimeType, ImageSource, Progress, Rejection } from "../types";
import { compareText, type ZipBudget, type ZipOpener } from "../zip";
import { createUnpackBudget, readImageArchive } from "./archive";
import { readDocxPictures } from "./docx";
import { ImageReadError, reasonFor, rethrowIfAborted } from "./errors";
import {
  baseName,
  hasPdfSignature,
  hasZipSignature,
  inputKind,
  isSystemFile,
  unsupportedReason,
  type InputKind,
} from "./formats";
import { LeftOut, whyForProblem } from "./leftOut";
import { IMAGE_LIMITS, SMALL_PICTURE_SIDE } from "./limits";
import { readPdfPictures, type PdfImageEncoder, type PdfMode, type PdfOpener } from "./pdfImages";
import { sha256Hex, tooLargeFileReason, validateImage, type ImageDecoder } from "./validate";

export interface ReadImagesOptions {
  /** What to take from PDFs: the pictures embedded in them, a capture of each page, or both. */
  pdf: PdfMode;
  onProgress?: (progress: Progress) => void;
  signal?: AbortSignal;
}

export interface ReadImagesResult {
  images: ImageSource[];
  rejected: Rejection[];
}

export interface ImageInput {
  /** The file name, or its path inside a folder. */
  name: string;
  file: Blob;
}

/** Browser-only steps, swappable so tests can run without image decoding, canvas, or pdf.js. */
export interface ImageReaderAdapters {
  decode: ImageDecoder;
  openZip: ZipOpener;
  openPdf: PdfOpener;
  encodePdfImage: PdfImageEncoder;
  createId: () => string;
}

const SMALL_PICTURE_NOTE = "This picture is small and may be decorative.";
const PAGE_CAPTURE_NOTE = "A capture of the whole page.";

interface Candidate {
  name: string;
  from: ImageSource["from"];
  original: Blob;
  mimeType: ImageMimeType;
  width: number;
  height: number;
  sha256: string;
  notes: string[];
}

type AddOutcome = { added: ImageSource } | "repeat" | "full";

/** Collects the images of one call, setting aside repeats and stopping at the batch limits. */
class Batch {
  readonly images: ImageSource[] = [];
  readonly rejected: Rejection[] = [];
  /** Why nothing more can be added, once the batch is full. */
  fullReason: string | null = null;
  readonly #byHash = new Map<string, { image: ImageSource; copies: string[] }>();
  readonly #hashes = new WeakMap<Blob, Promise<string>>();
  #bytes = 0;

  constructor(private readonly createId: () => string) {}

  /** Hashes a blob once, even when the same picture is reported several times. */
  hash(blob: Blob): Promise<string> {
    let hash = this.#hashes.get(blob);
    if (!hash) {
      hash = sha256Hex(blob);
      this.#hashes.set(blob, hash);
    }
    return hash;
  }

  add(candidate: Candidate): AddOutcome {
    const existing = this.#byHash.get(candidate.sha256);
    if (existing) {
      existing.copies.push(locationOf(candidate.name, candidate.from));
      return "repeat";
    }
    if (this.fullReason) return "full";
    const { maxImagesPerBatch, maxBatchBytes } = IMAGE_LIMITS;
    if (this.images.length >= maxImagesPerBatch) {
      this.fullReason = `the limit of ${maxImagesPerBatch} images at a time was reached`;
      return "full";
    }
    if (this.#bytes + candidate.original.size > maxBatchBytes) {
      this.fullReason = `the limit of ${toMb(maxBatchBytes)} MB of images at a time was reached`;
      return "full";
    }
    const image: ImageSource = {
      id: this.createId(),
      kind: "image",
      name: candidate.name,
      from: candidate.from,
      original: candidate.original,
      mimeType: candidate.mimeType,
      width: candidate.width,
      height: candidate.height,
      byteCount: candidate.original.size,
      sha256: candidate.sha256,
      included: true,
      visibleText: "",
      settings: null,
      notes: candidate.notes,
    };
    this.images.push(image);
    this.#byHash.set(candidate.sha256, { image, copies: [] });
    this.#bytes += image.byteCount;
    return { added: image };
  }

  notAddedReason(): string {
    return `Not added: ${this.fullReason}.`;
  }

  finish(): ReadImagesResult {
    for (const { image, copies } of this.#byHash.values()) {
      if (copies.length > 0) image.notes.push(copiesNote(copies));
    }
    return { images: this.images, rejected: this.rejected };
  }
}

function toMb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

function locationOf(name: string, from: ImageSource["from"]): string {
  if (!from) return name;
  if (from.pageNumber !== undefined) return `${from.container}, page ${from.pageNumber}`;
  return `${from.container}/${name}`;
}

function copiesNote(copies: string[]): string {
  const places = [...new Set(copies)];
  const shown = places.slice(0, 3);
  const more = places.length - shown.length;
  const list = more > 0 ? `${shown.join("; ")}; and ${more} more` : shown.join("; ");
  const count = copies.length === 1 ? "1 more copy" : `${copies.length} more copies`;
  return `Found ${count} of this picture (${list}); it was added once.`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Tracks what one PDF or Word file contributed, to write its summary note. */
interface ContainerTally {
  name: string;
  first: ImageSource | null;
  repeats: number;
  stopped: boolean;
}

function record(tally: ContainerTally, outcome: AddOutcome): boolean {
  if (outcome === "full") {
    tally.stopped = true;
    return false;
  }
  if (outcome === "repeat") tally.repeats += 1;
  else tally.first ??= outcome.added;
  return true;
}

/**
 * Puts a container's notes on the first image it added, or, when it added none, turns
 * them into the reason the whole file was rejected.
 */
function finishContainer(
  tally: ContainerTally,
  phrases: string[],
  nothingFound: string | null,
  batch: Batch,
): void {
  if (tally.first) {
    tally.first.notes.push(...phrases.map((phrase) => `${tally.name}: ${phrase}.`));
    return;
  }
  // The copies already added say where else they were found.
  if (tally.repeats > 0 && phrases.length === 0) return;
  if (tally.stopped && tally.repeats === 0) throw new ImageReadError(batch.notAddedReason());
  const opening =
    nothingFound ??
    (tally.repeats > 0
      ? "Its other pictures were already added from another file."
      : "No usable pictures were found.");
  throw new ImageReadError(
    [opening, ...phrases.map((phrase) => `${capitalize(phrase)}.`)].join(" "),
  );
}

interface Context {
  batch: Batch;
  adapters: ImageReaderAdapters;
  options: ReadImagesOptions;
  report: (label: string) => void;
}

export async function readImages(
  inputs: ImageInput[],
  options: ReadImagesOptions,
  adapters: ImageReaderAdapters,
): Promise<ReadImagesResult> {
  const batch = new Batch(adapters.createId);
  const total = inputs.length;
  for (const [index, input] of inputs.entries()) {
    options.signal?.throwIfAborted();
    if (isSystemFile(input.name)) continue;
    const report = (label: string) => options.onProgress?.({ label, completed: index, total });
    report(`Reading ${input.name}`);
    try {
      await readInput(input, { batch, adapters, options, report });
    } catch (error) {
      rethrowIfAborted(error, options.signal);
      batch.rejected.push({ name: input.name, reason: reasonFor(error, couldNotRead) });
    }
  }
  options.onProgress?.({ label: "Done", completed: total, total });
  return batch.finish();
}

const couldNotRead = "This file couldn't be read.";

/** Folder entries in a stable order, with paths in one standard form. */
export function folderInputs(files: { file: Blob; path: string }[]): ImageInput[] {
  return files
    .map(({ file, path }) => ({
      file,
      name: path.replaceAll("\\", "/").replace(/^(?:\.?\/)+/u, ""),
    }))
    .sort((left, right) => compareText(left.name, right.name));
}

async function readInput({ name, file }: ImageInput, context: Context): Promise<void> {
  const kind = inputKind(name);
  if (!kind) throw new ImageReadError(unsupportedReason(name), "unsupported");
  if (context.batch.fullReason) throw new ImageReadError(context.batch.notAddedReason());
  if (file.size === 0) throw new ImageReadError("This file is empty.");
  const limit = kind === "image" ? IMAGE_LIMITS.maxImageBytes : IMAGE_LIMITS.maxContainerBytes;
  if (file.size > limit) {
    throw new ImageReadError(tooLargeFileReason(file.size, limit), "too-large");
  }
  // ZIP and Word files are read from the file a piece at a time, never loaded whole.
  await readBytes(kind, file, { name, container: null }, context, createUnpackBudget());
}

interface Placement {
  /** Display name: a file name or path, or a path inside a ZIP. */
  name: string;
  /** The ZIP holding this file, if any. */
  container: string | null;
}

async function readBytes(
  kind: InputKind,
  data: Blob | Uint8Array<ArrayBuffer>,
  placement: Placement,
  context: Context,
  budget: ZipBudget,
): Promise<void> {
  const { batch, options } = context;
  if (batch.fullReason) throw new ImageReadError(batch.notAddedReason());
  options.signal?.throwIfAborted();
  // Pictures inside a PDF or Word file are named after the file's full location.
  const location = placement.container
    ? `${placement.container}/${placement.name}`
    : placement.name;
  if (kind === "image" || kind === "pdf") {
    const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
    if (kind === "pdf") {
      if (!hasPdfSignature(bytes)) throw new ImageReadError("This file isn't a valid PDF.");
      await readPdf(bytes, location, context);
      return;
    }
    const { adapters } = context;
    const valid = await validateImage(bytes, placement.name, adapters.decode, options.signal);
    const from = placement.container ? { container: placement.container } : null;
    if (batch.add({ ...valid, name: placement.name, from }) === "full") {
      throw new ImageReadError(batch.notAddedReason());
    }
    return;
  }
  const source = data instanceof Blob ? data : new Blob([data]);
  const head = new Uint8Array(await source.slice(0, 4).arrayBuffer());
  if (kind === "docx") {
    if (!hasZipSignature(head)) {
      throw new ImageReadError("This file isn't a valid Word (.docx) file.");
    }
    await readDocx(source, location, context, budget);
  } else {
    if (!hasZipSignature(head)) throw new ImageReadError("This file isn't a valid ZIP file.");
    await readZipContents(source, location, context, budget);
  }
}

async function readPdf(
  bytes: Uint8Array<ArrayBuffer>,
  container: string,
  context: Context,
): Promise<void> {
  const { batch, adapters, options } = context;
  const tally: ContainerTally = { name: container, first: null, repeats: 0, stopped: false };
  const summary = await readPdfPictures(bytes, {
    mode: options.pdf,
    open: adapters.openPdf,
    encode: adapters.encodePdfImage,
    signal: options.signal,
    onPage: (page, count) => context.report(`Reading ${container}, page ${page} of ${count}`),
    onPicture: async (picture) => {
      const small =
        !picture.capture && Math.min(picture.width, picture.height) < SMALL_PICTURE_SIDE;
      const outcome = batch.add({
        name: picture.name,
        from: { container, pageNumber: picture.pageNumber },
        original: picture.image,
        mimeType: "image/png",
        width: picture.width,
        height: picture.height,
        sha256: await batch.hash(picture.image),
        notes: picture.capture ? [PAGE_CAPTURE_NOTE] : small ? [SMALL_PICTURE_NOTE] : [],
      });
      return record(tally, outcome);
    },
  });
  const phrases = summary.leftOut.phrases();
  const { maxPdfPages } = IMAGE_LIMITS;
  if (summary.pageCount > maxPdfPages) {
    phrases.push(`only the first ${maxPdfPages} of ${summary.pageCount} pages were read`);
  }
  if (summary.stoppedAtPage !== null) {
    phrases.push(`stopped at page ${summary.stoppedAtPage} because ${batch.fullReason}`);
  }
  let nothingFound: string | null = null;
  if (summary.found === 0 && summary.leftOut.count === 0) {
    nothingFound =
      options.pdf === "embedded-images"
        ? "This PDF has no pictures to take out. Try capturing whole pages instead."
        : "No pages could be captured.";
  }
  finishContainer(tally, phrases, nothingFound, batch);
}

async function readDocx(
  source: Blob,
  container: string,
  context: Context,
  budget: ZipBudget,
): Promise<void> {
  const { batch, adapters, options } = context;
  const { pictures, skipped } = await readDocxPictures(source, {
    open: adapters.openZip,
    budget,
    signal: options.signal,
  });
  const tally: ContainerTally = { name: container, first: null, repeats: 0, stopped: false };
  const leftOut = new LeftOut();
  for (const skip of skipped) leftOut.add("picture", whyForProblem(skip.problem));
  let notAdded = 0;
  for (const picture of pictures) {
    if (tally.stopped) {
      notAdded += 1;
      continue;
    }
    try {
      const valid = await validateImage(
        picture.bytes,
        picture.path,
        adapters.decode,
        options.signal,
      );
      const small = Math.min(valid.width, valid.height) < SMALL_PICTURE_SIDE;
      const outcome = batch.add({
        ...valid,
        name: baseName(picture.path),
        from: { container },
        // Name-versus-content notes describe files the person chose, not parts of a document.
        notes: small ? [SMALL_PICTURE_NOTE] : [],
      });
      if (!record(tally, outcome)) notAdded += 1;
    } catch (error) {
      rethrowIfAborted(error, options.signal);
      const problem = error instanceof ImageReadError ? error.problem : "unreadable";
      const format = error instanceof ImageReadError ? error.format : undefined;
      leftOut.add(
        "picture",
        whyForProblem(problem),
        problem === "unsupported" ? format : undefined,
      );
    }
  }
  const phrases = leftOut.phrases();
  if (notAdded > 0) {
    const what = notAdded === 1 ? "1 picture wasn't" : `${notAdded} pictures weren't`;
    phrases.push(`${what} added because ${batch.fullReason}`);
  }
  const nothingFound =
    pictures.length === 0 && skipped.length === 0 ? "This Word file has no pictures." : null;
  finishContainer(tally, phrases, nothingFound, batch);
}

async function readZipContents(
  source: Blob,
  container: string,
  context: Context,
  budget: ZipBudget,
): Promise<void> {
  const { batch, adapters, options } = context;
  const rejected: Rejection[] = [];
  const nameOf = (path: string) => `${container}/${path}`;
  let unpacked = 0;
  // Each file is read as soon as it's unpacked and then let go, so only one is held at a time.
  const contents = await readImageArchive(
    source,
    {
      open: adapters.openZip,
      budget,
      signal: options.signal,
      label: "ZIP file",
      limitFor: (path) => {
        const kind = inputKind(path);
        if (isSystemFile(path) || !kind || kind === "zip") return null;
        return kind === "image" ? IMAGE_LIMITS.maxImageBytes : IMAGE_LIMITS.maxContainerBytes;
      },
    },
    async (file) => {
      unpacked += 1;
      // Only files with a known kind were unpacked.
      const kind = inputKind(file.path);
      if (!kind) return;
      context.report(`Reading ${nameOf(file.path)}`);
      try {
        await readBytes(kind, file.bytes, { name: file.path, container }, context, budget);
      } catch (error) {
        rethrowIfAborted(error, options.signal);
        rejected.push({ name: nameOf(file.path), reason: reasonFor(error, couldNotRead) });
      }
    },
  );
  for (const path of contents.others) {
    if (isSystemFile(path)) continue;
    const reason =
      inputKind(path) === "zip"
        ? "ZIP files inside a ZIP aren't opened. Unzip it and add its files instead."
        : unsupportedReason(path);
    rejected.push({ name: nameOf(path), reason });
  }
  for (const skip of contents.skipped) {
    rejected.push({ name: nameOf(skip.path), reason: skip.reason });
  }
  if (unpacked === 0 && rejected.length === 0) {
    throw new ImageReadError("This ZIP file has no files in it that can be added.");
  }
  batch.rejected.push(...rejected.sort((left, right) => compareText(left.name, right.name)));
}
