import type { ImageContainerProvenanceNode, ImageProvenance } from "./contracts";
import {
  MAX_IMAGE_INPUT_BYTES,
  ImageIntakeFailure,
  failImageIntake,
  imageIntakeIssue,
  type ExtractedImageCandidate,
  type ExtractedImageCandidateValidator,
  type ImageAdmission,
  type ImageInputFile,
  type ImageIntakeIssue,
  type ImageIntakeResult,
} from "./intakeContracts";
import {
  prepareImageInput,
  validatePreparedImage,
  type ImageDecodeAdapter,
} from "./imageValidation";
import {
  extractDocxImages,
  type DocxConverterAdapter,
} from "./docxIntake";
import {
  extractPdfImages,
  type ImagePdfCaptureChoice,
  type ImagePdfAdapter,
} from "./pdfIntake";
import {
  createExpandedByteBudget,
  normalizeImageArchivePath,
  readSafeArchive,
  type ArchiveReaderAdapter,
  type ExpandedByteBudget,
} from "./safeArchive";
import {
  createImageIntakeCapacityCoordinator,
  type ImageCapacitySnapshot,
  type ImageIntakeCapacityCoordinator,
  type ImageIntakeCapacityScope,
  type ImagePublicationAcknowledgement,
} from "./intakeCapacity";

const PDF_MIME_TYPES = new Set(["application/pdf"]);
const DOCX_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const ZIP_MIME_TYPES = new Set(["application/zip", "application/x-zip-compressed"]);
const REMOTE_DOCUMENT_EXTENSIONS = new Set(["html", "htm", "md", "markdown"]);
const SUPPORTED_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "avif"]);
const UNSUPPORTED_IMAGE_EXTENSIONS = new Set(["svg", "gif", "bmp", "tif", "tiff", "heic", "heif"]);

export interface FolderImageCandidate {
  readonly inputName: string;
  readonly inputPath: string;
  readonly candidate: ExtractedImageCandidate;
}

export interface FolderImageRejection {
  readonly inputName: string;
  readonly inputPath: string;
  readonly issue: ImageIntakeIssue;
}

export interface ImageFolderIntakeResult {
  readonly folderName: string;
  readonly candidates: readonly FolderImageCandidate[];
  readonly rejections: readonly FolderImageRejection[];
  readonly warnings: readonly string[];
}

export interface ImageFolderIntakeOptions {
  readonly decoder: ImageDecodeAdapter;
  readonly hash?: (source: Blob) => Promise<string>;
  readonly pdfAdapter?: ImagePdfAdapter;
  readonly docxConverter?: DocxConverterAdapter;
  readonly docxArchiveOpen?: (source: Blob) => Promise<ArchiveReaderAdapter>;
  readonly signal?: AbortSignal;
  readonly validateCandidate?: ExtractedImageCandidateValidator;
  readonly resolvePdfCapture?: (
    context: ImageIntakePdfCaptureContext,
  ) => ImagePdfCaptureChoice | Promise<ImagePdfCaptureChoice>;
  readonly onInputRejected?: (inputPath: string) => void;
}

type ContainerKind = "pdf" | "docx" | "zip";

interface AuditedFolderFile {
  readonly input: ImageInputFile;
  readonly folderName: string;
  readonly relativePath: string;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function portablePath(path: string): string {
  return path.normalize("NFKC").toLowerCase();
}

function validateInputSize(input: ImageInputFile): void {
  if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > MAX_IMAGE_INPUT_BYTES) {
    failImageIntake("INPUT_SIZE_INVALID");
  }
}

function hasZipSignature(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && ((bytes[2] === 0x03 && bytes[3] === 0x04)
      || (bytes[2] === 0x05 && bytes[3] === 0x06)
      || (bytes[2] === 0x07 && bytes[3] === 0x08));
}

function hasPdfSignature(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 5
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
    && bytes[4] === 0x2d;
}

async function readContainerInput(input: ImageInputFile, kind: ContainerKind): Promise<Blob> {
  validateInputSize(input);
  const mime = input.type.toLowerCase();
  const allowed = kind === "pdf" ? PDF_MIME_TYPES : kind === "docx" ? DOCX_MIME_TYPES : ZIP_MIME_TYPES;
  if (mime && !allowed.has(mime)) failImageIntake("MIME_MISMATCH");
  let selected: Uint8Array;
  try {
    selected = new Uint8Array(await input.arrayBuffer());
  } catch {
    failImageIntake("READ_FAILED");
  }
  if (selected.byteLength !== input.size) failImageIntake("READ_FAILED");
  if (kind === "pdf" ? !hasPdfSignature(selected) : !hasZipSignature(selected)) {
    failImageIntake("SIGNATURE_MISMATCH");
  }
  const owned = Uint8Array.from(selected);
  const ownedMime = kind === "pdf"
    ? "application/pdf"
    : kind === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : "application/zip";
  return new Blob([owned], { type: ownedMime });
}

async function hashContainer(
  source: Blob,
  injected?: (source: Blob) => Promise<string>,
): Promise<string> {
  let value: string;
  try {
    if (injected) value = await injected(source);
    else {
      const digest = await crypto.subtle.digest("SHA-256", await source.arrayBuffer());
      value = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    failImageIntake("HASH_FAILED");
  }
  if (!/^[a-f0-9]{64}$/iu.test(value)) failImageIntake("HASH_FAILED");
  return value.toLowerCase();
}

function folderChain(folderName: string): readonly ImageContainerProvenanceNode[] {
  return Object.freeze([Object.freeze({
    kind: "folder" as const,
    name: folderName,
    sha256: null,
    path: null,
    byteCount: null,
  })]);
}

function folderProvenance(folderName: string, sourceName: string, sourcePath: string): ImageProvenance {
  const chain = folderChain(folderName);
  return Object.freeze({
    intakeKind: "folder",
    sourceName,
    sourcePath,
    containerChain: chain,
    containerName: folderName,
    containerHash: null,
    containerPath: null,
    pageNumber: null,
    relationshipId: null,
  });
}

function auditFolderFiles(inputs: readonly ImageInputFile[]): readonly AuditedFolderFile[] {
  if (inputs.length === 0) failImageIntake("UNSAFE_PATH");
  const audited: AuditedFolderFile[] = [];
  const seen = new Set<string>();
  let commonFolder: string | null = null;
  for (const input of inputs) {
    const fullPath = normalizeImageArchivePath(input.webkitRelativePath ?? "");
    const separator = fullPath.indexOf("/");
    if (separator < 1 || separator === fullPath.length - 1) failImageIntake("UNSAFE_PATH");
    const folderName = fullPath.slice(0, separator);
    const relativePath = fullPath.slice(separator + 1);
    if (commonFolder === null) commonFolder = folderName;
    if (portablePath(folderName) !== portablePath(commonFolder)) failImageIntake("UNSAFE_PATH");
    const key = portablePath(relativePath);
    if (seen.has(key)) failImageIntake("PATH_COLLISION", relativePath);
    for (const existing of seen) {
      if (key.startsWith(`${existing}/`) || existing.startsWith(`${key}/`)) {
        failImageIntake("PATH_COLLISION", relativePath);
      }
    }
    seen.add(key);
    audited.push({ input, folderName: commonFolder, relativePath });
  }
  return Object.freeze(audited.sort((left, right) => left.relativePath < right.relativePath
    ? -1
    : left.relativePath > right.relativePath ? 1 : 0));
}

function rejection(
  item: AuditedFolderFile,
  error: unknown,
): FolderImageRejection {
  return Object.freeze({
    inputName: item.input.name,
    inputPath: item.relativePath,
    issue: error instanceof ImageIntakeFailure ? error.issue : imageIntakeIssue("READ_FAILED"),
  });
}

function inputKind(input: ImageInputFile): "image" | "pdf" | "docx" {
  validateInputSize(input);
  const extension = extensionOf(input.name);
  if (REMOTE_DOCUMENT_EXTENSIONS.has(extension)) failImageIntake("REMOTE_DOCUMENT_UNSUPPORTED");
  if (UNSUPPORTED_IMAGE_EXTENSIONS.has(extension)) failImageIntake("UNSUPPORTED_FORMAT");
  if (extension === "zip") {
    const mime = input.type.toLowerCase();
    if (mime && !ZIP_MIME_TYPES.has(mime)) failImageIntake("MIME_MISMATCH");
    failImageIntake("NESTED_ARCHIVE");
  }
  if (SUPPORTED_IMAGE_EXTENSIONS.has(extension)) return "image";
  if (extension === "pdf") return "pdf";
  if (extension === "docx") return "docx";
  failImageIntake("UNSUPPORTED_EXTENSION");
}

export async function intakeImageFolder(
  inputs: readonly ImageInputFile[],
  options: ImageFolderIntakeOptions,
): Promise<ImageFolderIntakeResult> {
  const audited = auditFolderFiles(inputs);
  const candidates: FolderImageCandidate[] = [];
  const rejections: FolderImageRejection[] = [];
  const expandedBudget = createExpandedByteBudget();
  for (const item of audited) {
    try {
      if (options.signal?.aborted) throw new DOMException("Folder intake cancelled.", "AbortError");
      const kind = inputKind(item.input);
      if (kind === "image") {
        const prepared = await prepareImageInput(item.input);
        const imageProvenance = folderProvenance(item.folderName, baseName(item.relativePath), item.relativePath);
        const validated = options.validateCandidate
          ? await options.validateCandidate(prepared, imageProvenance)
          : Object.freeze({
            ...await validatePreparedImage(prepared, {
              decoder: options.decoder,
              hash: options.hash,
              signal: options.signal,
            }),
            provenance: imageProvenance,
          });
        candidates.push(Object.freeze({
          inputName: item.input.name,
          inputPath: item.relativePath,
          candidate: validated,
        }));
        continue;
      }
      const source = await readContainerInput(item.input, kind);
      const containerHash = await hashContainer(source, options.hash);
      const extracted = kind === "pdf"
        ? await extractPdfImages(source, {
          containerName: item.input.name,
          containerHash,
          containerPath: item.relativePath,
          parentContainerChain: folderChain(item.folderName),
          adapter: options.pdfAdapter,
          decoder: options.decoder,
          hash: options.hash,
          resolveCapture: options.resolvePdfCapture
            ? ({ pageCount, signal }) => options.resolvePdfCapture!({
              inputName: item.folderName,
              path: item.relativePath,
              pageCount,
              signal,
            })
            : undefined,
          signal: options.signal,
          validateCandidate: options.validateCandidate,
        })
        : await extractDocxImages(source, {
          containerName: item.input.name,
          containerHash,
          containerPath: item.relativePath,
          parentContainerChain: folderChain(item.folderName),
          converter: options.docxConverter,
          decoder: options.decoder,
          hash: options.hash,
          archiveOpen: options.docxArchiveOpen,
          budget: expandedBudget,
          signal: options.signal,
          validateCandidate: options.validateCandidate,
        });
      for (const candidate of extracted.images) {
        candidates.push(Object.freeze({ inputName: item.input.name, inputPath: item.relativePath, candidate }));
      }
      for (const issue of extracted.issues) {
        rejections.push(Object.freeze({ inputName: item.input.name, inputPath: item.relativePath, issue }));
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      options.onInputRejected?.(item.relativePath);
      rejections.push(rejection(item, error));
    }
  }
  return Object.freeze({
    folderName: audited[0].folderName,
    candidates: Object.freeze(candidates),
    rejections: Object.freeze(rejections),
    warnings: Object.freeze([
      "Browser folder selection cannot independently verify original filesystem symlink identity.",
    ]),
  });
}

export interface ImageIntakeServiceOptions extends ImageFolderIntakeOptions {
  readonly idFactory: () => string;
  readonly publish: (
    admission: ImageAdmission,
    sessionEpoch: number,
  ) => ImagePublicationAcknowledgement;
  readonly archiveOpen?: (source: Blob) => Promise<ArchiveReaderAdapter>;
}


export interface ImageIntakePdfCaptureContext {
  readonly inputName: string;
  readonly path: string | null;
  readonly pageCount: number;
  readonly signal: AbortSignal;
}

export interface ImageIntakeService {
  intake(inputs: readonly ImageInputFile[]): Promise<ImageIntakeResult>;
  intakeFolder(inputs: readonly ImageInputFile[]): Promise<ImageIntakeResult>;
  reconcile(items: readonly Pick<ImageAdmission, "id" | "sourceBytes">[]): void;
  reset(): void;
  snapshot(): ImageCapacitySnapshot;
}

interface MutableIntakeResult {
  admissions: ImageAdmission[];
  ledger: ImageIntakeResult["ledger"] extends readonly (infer Entry)[] ? Entry[] : never;
}

type ImageCapacityLease = ReturnType<ImageIntakeCapacityScope["reserve"]>;
interface StagedImageLease {
  readonly lease: ImageCapacityLease;
  readonly inputPath: string | null;
}
type StagedImageLeases = Map<Blob, StagedImageLease>;

function directProvenance(sourceName: string): ImageProvenance {
  return Object.freeze({
    intakeKind: "direct",
    sourceName,
    sourcePath: null,
    containerChain: Object.freeze([]),
    containerName: null,
    containerHash: null,
    containerPath: null,
    pageNumber: null,
    relationshipId: null,
  });
}

function zipChain(name: string, hash: string, byteCount: number): readonly ImageContainerProvenanceNode[] {
  return Object.freeze([Object.freeze({
    kind: "zip" as const,
    name,
    sha256: hash,
    path: null,
    byteCount,
  })]);
}

function zipProvenance(
  zipName: string,
  zipHash: string,
  zipByteCount: number,
  sourceName: string,
  path: string,
): ImageProvenance {
  const chain = zipChain(zipName, zipHash, zipByteCount);
  return Object.freeze({
    intakeKind: "zip",
    sourceName,
    sourcePath: path,
    containerChain: chain,
    containerName: zipName,
    containerHash: zipHash,
    containerPath: null,
    pageNumber: null,
    relationshipId: null,
  });
}

function classifyTopLevel(input: ImageInputFile): "image" | ContainerKind {
  validateInputSize(input);
  const extension = extensionOf(input.name);
  if (REMOTE_DOCUMENT_EXTENSIONS.has(extension)) failImageIntake("REMOTE_DOCUMENT_UNSUPPORTED");
  if (UNSUPPORTED_IMAGE_EXTENSIONS.has(extension)) failImageIntake("UNSUPPORTED_FORMAT");
  if (SUPPORTED_IMAGE_EXTENSIONS.has(extension)) return "image";
  if (extension === "pdf" || extension === "docx" || extension === "zip") return extension;
  failImageIntake("UNSUPPORTED_EXTENSION");
}

function admissionFromCandidate(
  candidate: ExtractedImageCandidate,
  occurrenceId: string,
  ordinal: number,
): ImageAdmission {
  return Object.freeze({
    id: occurrenceId,
    ordinal,
    sourceBytes: candidate.sourceBytes,
    byteCount: candidate.byteCount,
    mimeType: candidate.mimeType,
    fileExtension: candidate.fileExtension,
    sourceHash: candidate.sourceHash,
    width: candidate.width,
    height: candidate.height,
    warnings: candidate.warnings,
    provenance: candidate.provenance,
  });
}

function acceptedLedger(
  inputName: string,
  path: string | null,
  occurrenceId: string,
): ImageIntakeResult["ledger"][number] {
  return Object.freeze({ inputName, path, status: "accepted", occurrenceId, issue: null });
}

function rejectedLedger(
  inputName: string,
  path: string | null,
  issue: ImageIntakeIssue,
): ImageIntakeResult["ledger"][number] {
  return Object.freeze({ inputName, path, status: "rejected", occurrenceId: null, issue });
}

function errorIssue(error: unknown): ImageIntakeIssue {
  return error instanceof ImageIntakeFailure ? error.issue : imageIntakeIssue("READ_FAILED");
}

function freezeResult(result: MutableIntakeResult): ImageIntakeResult {
  return Object.freeze({
    admissions: Object.freeze(result.admissions),
    ledger: Object.freeze(result.ledger),
  });
}

export function createImageIntakeService(options: ImageIntakeServiceOptions): ImageIntakeService {
  const capacity: ImageIntakeCapacityCoordinator = createImageIntakeCapacityCoordinator({
    idFactory: options.idFactory,
  });

  const publishCandidate = (
    scope: ImageIntakeCapacityScope,
    candidate: ExtractedImageCandidate,
    inputName: string,
    path: string | null,
    result: MutableIntakeResult,
    existingLease?: ImageCapacityLease,
  ) => {
    const lease = existingLease ?? scope.reserve(candidate.byteCount);
    const admission = lease.publish(
      (occurrenceId, ordinal) => admissionFromCandidate(candidate, occurrenceId, ordinal),
      (value) => options.publish(value, scope.sessionEpoch),
    );
    if (!admission) failImageIntake("STALE_SESSION", path);
    result.admissions.push(admission);
    result.ledger.push(acceptedLedger(inputName, path, admission.id));
  };

  const createStagingValidator = (
    scope: ImageIntakeCapacityScope,
    staged: StagedImageLeases,
  ): ExtractedImageCandidateValidator => async (prepared, provenance) => {
    const lease = scope.reserve(prepared.byteCount);
    try {
      const candidate = Object.freeze({
        ...await validatePreparedImage(prepared, {
          decoder: options.decoder,
          hash: options.hash,
          signal: scope.signal,
        }),
        provenance,
      });
      staged.set(candidate.sourceBytes, {
        lease,
        inputPath: provenance.sourcePath ?? provenance.containerChain.at(-1)?.path ?? null,
      });
      return candidate;
    } catch (error) {
      lease.release();
      throw error;
    }
  };

  const validateAndPublishDirect = async (
    input: ImageInputFile,
    provenance: ImageProvenance,
    path: string | null,
    scope: ImageIntakeCapacityScope,
    result: MutableIntakeResult,
    ledgerInputName = input.name,
  ) => {
    const prepared = await prepareImageInput(input);
    const lease = scope.reserve(prepared.byteCount);
    try {
      const validated = await validatePreparedImage(prepared, {
        decoder: options.decoder,
        hash: options.hash,
        signal: scope.signal,
      });
      publishCandidate(scope, Object.freeze({ ...validated, provenance }), ledgerInputName, path, result, lease);
    } catch (error) {
      lease.release();
      throw error;
    }
  };

  const publishExtracted = (
    scope: ImageIntakeCapacityScope,
    inputName: string,
    path: string | null,
    images: readonly ExtractedImageCandidate[],
    issues: readonly ImageIntakeIssue[],
    result: MutableIntakeResult,
    staged: StagedImageLeases,
  ) => {
    for (const candidate of images) {
      try {
        const stagedLease = staged.get(candidate.sourceBytes);
        if (!stagedLease) failImageIntake("READ_FAILED", path);
        publishCandidate(scope, candidate, inputName, path, result, stagedLease.lease);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        result.ledger.push(rejectedLedger(inputName, path, errorIssue(error)));
      }
    }
    for (const issue of issues) result.ledger.push(rejectedLedger(inputName, path, issue));
  };

  const extractDocument = async (
    kind: "pdf" | "docx",
    source: Blob,
    containerName: string,
    containerHash: string,
    containerPath: string | null,
    parentContainerChain: readonly ImageContainerProvenanceNode[],
    scope: ImageIntakeCapacityScope,
    budget?: ExpandedByteBudget,
    captureInputName = containerName,
  ) => {
    const staged: StagedImageLeases = new Map();
    const validateCandidate = createStagingValidator(scope, staged);
    try {
      const extracted = kind === "pdf"
        ? await extractPdfImages(source, {
      containerName,
      containerHash,
      containerPath,
      parentContainerChain,
      adapter: options.pdfAdapter,
      decoder: options.decoder,
      hash: options.hash,
      resolveCapture: options.resolvePdfCapture
        ? ({ pageCount, signal }) => options.resolvePdfCapture!({
          inputName: captureInputName,
          path: containerPath,
          pageCount,
          signal,
        })
        : undefined,
      validateCandidate,
      signal: scope.signal,
    })
        : await extractDocxImages(source, {
      containerName,
      containerHash,
      containerPath,
      parentContainerChain,
      converter: options.docxConverter,
      decoder: options.decoder,
      hash: options.hash,
      archiveOpen: options.docxArchiveOpen ?? options.archiveOpen,
      budget,
      validateCandidate,
      signal: scope.signal,
    });
      return { extracted, staged };
    } catch (error) {
      for (const { lease } of staged.values()) lease.release();
      throw error;
    }
  };

  const processZip = async (
    source: Blob,
    inputName: string,
    containerHash: string,
    scope: ImageIntakeCapacityScope,
    result: MutableIntakeResult,
  ) => {
    const budget = createExpandedByteBudget();
    const archive = await readSafeArchive(source, {
      open: options.archiveOpen,
      budget,
      signal: scope.signal,
    });
    const chain = zipChain(inputName, containerHash, source.size);
    for (const entry of archive.entries) {
      const child = fileFromArchiveEntry(entry.path, entry.bytes);
      try {
        const kind = inputKind(child);
        if (kind === "image") {
          await validateAndPublishDirect(
            child,
            zipProvenance(inputName, containerHash, source.size, child.name, entry.path),
            entry.path,
            scope,
            result,
            inputName,
          );
          continue;
        }
        const childSource = await readContainerInput(child, kind);
        const childHash = await hashContainer(childSource, options.hash);
        const documentBatch = await extractDocument(
          kind,
          childSource,
          child.name,
          childHash,
          entry.path,
          chain,
          scope,
          budget,
          inputName,
        );
        publishExtracted(
          scope,
          inputName,
          entry.path,
          documentBatch.extracted.images,
          documentBatch.extracted.issues,
          result,
          documentBatch.staged,
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        result.ledger.push(rejectedLedger(inputName, entry.path, errorIssue(error)));
      }
    }
  };

  const processTopLevel = async (
    input: ImageInputFile,
    scope: ImageIntakeCapacityScope,
    result: MutableIntakeResult,
  ) => {
    const kind = classifyTopLevel(input);
    if (kind === "image") {
      await validateAndPublishDirect(input, directProvenance(input.name), null, scope, result);
      return;
    }
    const source = await readContainerInput(input, kind);
    const containerHash = await hashContainer(source, options.hash);
    if (kind === "zip") {
      await processZip(source, input.name, containerHash, scope, result);
      return;
    }
    const documentBatch = await extractDocument(
      kind,
      source,
      input.name,
      containerHash,
      null,
      Object.freeze([]),
      scope,
      kind === "docx" ? createExpandedByteBudget() : undefined,
    );
    publishExtracted(
      scope,
      input.name,
      null,
      documentBatch.extracted.images,
      documentBatch.extracted.issues,
      result,
      documentBatch.staged,
    );
  };

  const intake = (inputs: readonly ImageInputFile[]): Promise<ImageIntakeResult> => capacity.run(async (scope) => {
    const result: MutableIntakeResult = { admissions: [], ledger: [] };
    for (const input of inputs) {
      try {
        await processTopLevel(input, scope, result);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        if (error instanceof ImageIntakeFailure && error.issue.code === "STALE_SESSION") throw error;
        result.ledger.push(rejectedLedger(input.name, null, errorIssue(error)));
      }
    }
    return freezeResult(result);
  });

  const intakeFolder = (inputs: readonly ImageInputFile[]): Promise<ImageIntakeResult> => capacity.run(async (scope) => {
    const staged: StagedImageLeases = new Map();
    const extracted = await intakeImageFolder(inputs, {
      ...options,
      signal: scope.signal,
      validateCandidate: createStagingValidator(scope, staged),
      onInputRejected: (inputPath) => {
        for (const [sourceBytes, stagedLease] of staged) {
          if (stagedLease.inputPath !== inputPath) continue;
          stagedLease.lease.release();
          staged.delete(sourceBytes);
        }
      },
    });
    const result: MutableIntakeResult = { admissions: [], ledger: [] };
    const returnedSources = new Set(extracted.candidates.map(({ candidate }) => candidate.sourceBytes));
    for (const [sourceBytes, stagedLease] of staged) {
      if (!returnedSources.has(sourceBytes)) stagedLease.lease.release();
    }
    for (const entry of extracted.candidates) {
      try {
        const stagedLease = staged.get(entry.candidate.sourceBytes);
        if (!stagedLease) failImageIntake("READ_FAILED", entry.inputPath);
        publishCandidate(scope, entry.candidate, entry.inputName, entry.inputPath, result, stagedLease.lease);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        if (error instanceof ImageIntakeFailure && error.issue.code === "STALE_SESSION") throw error;
        result.ledger.push(rejectedLedger(entry.inputName, entry.inputPath, errorIssue(error)));
      }
    }
    for (const entry of extracted.rejections) {
      result.ledger.push(rejectedLedger(entry.inputName, entry.inputPath, entry.issue));
    }
    result.ledger.sort((left, right) => {
      const leftPath = left.path ?? "";
      const rightPath = right.path ?? "";
      return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
    });
    return freezeResult(result);
  });

  return {
    intake,
    intakeFolder,
    reconcile: (items) => capacity.reconcile(items),
    reset: () => capacity.reset(),
    snapshot: () => capacity.snapshot(),
  };
}

function fileFromArchiveEntry(path: string, bytes: Uint8Array): ImageInputFile {
  const name = baseName(path);
  return Object.freeze({
    name,
    type: "",
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.slice().buffer,
  });
}
