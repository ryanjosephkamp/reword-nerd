import mammoth from "mammoth";

import type { ImageContainerProvenanceNode, ImageProvenance } from "./contracts";
import {
  ImageIntakeFailure,
  failImageIntake,
  imageIntakeIssue,
  type ExtractedImageCandidate,
  type ExtractedImageCandidateValidator,
  type ImageIntakeIssue,
} from "./intakeContracts";
import { prepareImageInput, validatePreparedImage, type ImageDecodeAdapter } from "./imageValidation";
import {
  createExpandedByteBudget,
  readSafeArchive,
  type ArchiveReaderAdapter,
  type ExpandedByteBudget,
} from "./safeArchive";

export interface DocxConverterImage {
  readonly contentType: string;
  readonly altText?: string;
  read(format: "base64"): Promise<string>;
}

export interface DocxConverterOptions {
  readonly styleMap: string[];
  readonly includeEmbeddedStyleMap: false;
  readonly externalFileAccess: false;
  readonly ignoreEmptyParagraphs: false;
  readonly convertImage: (image: DocxConverterImage) => Promise<{ src: string; alt?: string }>;
}

export interface DocxConverterResult {
  readonly value: string;
  readonly messages: readonly { readonly type: string; readonly message: string }[];
}

export interface DocxConverterAdapter {
  convertToHtml(
    input: { readonly arrayBuffer: ArrayBuffer },
    options: DocxConverterOptions,
  ): Promise<DocxConverterResult>;
}

export interface ExtractDocxOptions {
  readonly containerName: string;
  readonly containerHash: string;
  readonly containerPath?: string | null;
  readonly parentContainerChain?: readonly ImageContainerProvenanceNode[];
  readonly converter?: DocxConverterAdapter;
  readonly decoder: ImageDecodeAdapter;
  readonly hash?: (source: Blob) => Promise<string>;
  readonly archiveOpen?: (source: Blob) => Promise<ArchiveReaderAdapter>;
  readonly budget?: ExpandedByteBudget;
  readonly signal?: AbortSignal;
  readonly validateCandidate?: ExtractedImageCandidateValidator;
}

export interface DocxImageResult {
  readonly images: readonly ExtractedImageCandidate[];
  readonly issues: readonly ImageIntakeIssue[];
  readonly warnings: readonly string[];
}

const CONTENT_TYPE_EXTENSIONS: Readonly<Record<string, "png" | "jpg" | "webp" | "avif">> = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
});
const DOCX_DIAGNOSTIC_WARNING = "The DOCX converter reported a non-fatal diagnostic; review extracted images.";
const DOCX_DECORATIVE_WARNING = "This small DOCX visual may be decorative; review its inclusion.";

function decodeBase64(value: string): Uint8Array {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    failImageIntake("READ_FAILED");
  }
}

function ownedContainerChain(options: ExtractDocxOptions): readonly ImageContainerProvenanceNode[] {
  return Object.freeze([
    ...(options.parentContainerChain ?? []).map((node) => Object.freeze({ ...node })),
    Object.freeze({
      kind: "docx" as const,
      name: options.containerName,
      sha256: options.containerHash,
      path: options.containerPath ?? null,
      byteCount: null,
    }),
  ]);
}

function provenance(
  options: ExtractDocxOptions,
  sourceName: string,
  containerChain: readonly ImageContainerProvenanceNode[],
): ImageProvenance {
  const innermost = containerChain.at(-1)!;
  return Object.freeze({
    intakeKind: "docx-extracted",
    sourceName,
    sourcePath: null,
    containerChain,
    containerName: innermost.name,
    containerHash: innermost.sha256,
    containerPath: innermost.path,
    pageNumber: null,
    relationshipId: null,
  });
}

const browserDocxConverter: DocxConverterAdapter = {
  convertToHtml(input, options) {
    const { convertImage, ...safeOptions } = options;
    return mammoth.convertToHtml(input, {
      ...safeOptions,
      convertImage: mammoth.images.imgElement(async (image) => convertImage({
        contentType: image.contentType,
        altText: (image as unknown as { altText?: string }).altText,
        read: (format: "base64") => image.read(format),
      })),
    }) as Promise<DocxConverterResult>;
  },
};

function structurallyValidDocx(entries: readonly { path: string; bytes: Uint8Array }[]): boolean {
  const paths = new Set(entries.map(({ path }) => path));
  if (!paths.has("[Content_Types].xml")
    || !paths.has("_rels/.rels")
    || !paths.has("word/document.xml")) return false;
  for (const entry of entries) {
    const nestedZipSignature = entry.bytes.byteLength >= 4
      && entry.bytes[0] === 0x50
      && entry.bytes[1] === 0x4b
      && ((entry.bytes[2] === 0x03 && entry.bytes[3] === 0x04)
        || (entry.bytes[2] === 0x05 && entry.bytes[3] === 0x06)
        || (entry.bytes[2] === 0x07 && entry.bytes[3] === 0x08));
    if (entry.path.toLowerCase().endsWith(".docx") && nestedZipSignature) {
      failImageIntake("NESTED_ARCHIVE", entry.path);
    }
    if (!entry.path.toLowerCase().endsWith(".rels")) continue;
    let relationshipXml: string;
    try {
      relationshipXml = new TextDecoder("utf-8", { fatal: true }).decode(entry.bytes);
    } catch {
      return false;
    }
    if (/\bTargetMode\s*=\s*["']External["']/iu.test(relationshipXml)) {
      failImageIntake("LINK_ENTRY_UNSUPPORTED", entry.path);
    }
  }
  return true;
}

export async function extractDocxImages(source: Blob, options: ExtractDocxOptions): Promise<DocxImageResult> {
  const budget = options.budget ?? createExpandedByteBudget();
  let audited;
  try {
    audited = await readSafeArchive(source, {
      open: options.archiveOpen,
      budget,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof ImageIntakeFailure && error.issue.code !== "MALFORMED_ZIP") throw error;
    failImageIntake("MALFORMED_DOCX");
  }
  if (!structurallyValidDocx(audited.entries)) failImageIntake("MALFORMED_DOCX");

  const docxNodeIndex = (options.parentContainerChain?.length ?? 0);
  const chainWithPendingSize = ownedContainerChain(options);
  const containerChain = Object.freeze(chainWithPendingSize.map((node, index) => index === docxNodeIndex
    ? Object.freeze({ ...node, byteCount: source.size })
    : node));
  const images: ExtractedImageCandidate[] = [];
  const issues: ImageIntakeIssue[] = [];
  let occurrence = 0;
  const convertImage = async (image: DocxConverterImage): Promise<{ src: string; alt?: string }> => {
    occurrence += 1;
    const extension = CONTENT_TYPE_EXTENSIONS[image.contentType.toLowerCase()];
    if (!extension) {
      issues.push(imageIntakeIssue("UNSUPPORTED_FORMAT"));
      return { src: "" };
    }
    const sourceName = `docx-image-${String(occurrence).padStart(3, "0")}.${extension}`;
    try {
      const bytes = decodeBase64(await image.read("base64"));
      const prepared = await prepareImageInput({
        name: sourceName,
        type: image.contentType,
        size: bytes.byteLength,
        arrayBuffer: async () => bytes.slice().buffer,
      });
      const imageProvenance = provenance(options, sourceName, containerChain);
      const candidate = options.validateCandidate
        ? await options.validateCandidate(prepared, imageProvenance)
        : Object.freeze({
          ...await validatePreparedImage(prepared, {
            decoder: options.decoder,
            hash: options.hash,
            signal: options.signal,
          }),
          provenance: imageProvenance,
        });
      images.push(candidate);
      return { src: `local-image:${occurrence}`, ...(image.altText ? { alt: image.altText } : {}) };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      issues.push(error instanceof ImageIntakeFailure ? error.issue : imageIntakeIssue("READ_FAILED"));
      return { src: "" };
    }
  };

  let result: DocxConverterResult;
  try {
    result = await (options.converter ?? browserDocxConverter).convertToHtml(
      { arrayBuffer: await source.arrayBuffer() },
      {
        styleMap: [],
        includeEmbeddedStyleMap: false,
        externalFileAccess: false,
        ignoreEmptyParagraphs: false,
        convertImage,
      },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    failImageIntake("MALFORMED_DOCX");
  }
  if (result.messages.some(({ type }) => type === "error")) failImageIntake("MALFORMED_DOCX");
  if (images.length === 0 && issues.length === 0) failImageIntake("MALFORMED_DOCX");
  const warnings = result.messages.length > 0 ? [DOCX_DIAGNOSTIC_WARNING] : [];
  const reviewedImages = images.map((candidate) => {
    const candidateWarnings = [...candidate.warnings];
    if ((candidate.width < 64 || candidate.height < 64)
      && !candidateWarnings.includes(DOCX_DECORATIVE_WARNING)) {
      candidateWarnings.push(DOCX_DECORATIVE_WARNING);
    }
    for (const warning of warnings) {
      if (!candidateWarnings.includes(warning)) candidateWarnings.push(warning);
    }
    return Object.freeze({
      ...candidate,
      warnings: Object.freeze(candidateWarnings),
    });
  });
  return Object.freeze({
    images: Object.freeze(reviewedImages),
    issues: Object.freeze(issues),
    warnings: Object.freeze(warnings),
  });
}
