// Builds the TextSource records the rest of the app works with.
import type { DocumentAsset, DocumentFormat, OcrPassage, TextSource } from "../types";
import type { TextKind } from "./formats";
import { newId, sha256Hex } from "./util";

const MIME_TYPES: Partial<Record<DocumentFormat, string>> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  markdown: "text/markdown",
  html: "text/html",
  xml: "application/xml",
  json: "application/json",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  css: "text/css",
};

export interface SourceFields {
  path: string;
  projectId: string | null;
  kind: TextKind;
  bytes: Uint8Array<ArrayBuffer>;
  text: string;
  notes?: string[];
  assets?: DocumentAsset[];
  ocr?: OcrPassage[];
}

export async function makeTextSource(fields: SourceFields): Promise<TextSource> {
  const { bytes, kind } = fields;
  return {
    id: newId("text"),
    kind: "text",
    path: fields.path,
    projectId: fields.projectId,
    format: kind.format,
    languageId: kind.languageId,
    previewKind: kind.previewKind,
    original: new Blob([bytes], { type: MIME_TYPES[kind.format] ?? "text/plain" }),
    byteCount: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    extractedText: fields.text,
    text: fields.text,
    included: true,
    notes: fields.notes ?? [],
    assets: fields.assets ?? [],
    ocr: fields.ocr ?? [],
  };
}
