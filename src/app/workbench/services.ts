import {
  FileExtractionError,
  extractFile,
  hashBytes,
  preflightFiles,
} from "../../domain";
import { buildPromptPackage, initiatePromptPackageDownload } from "../../export";
import type { WorkbenchServices } from "./contracts";

const encoder = new TextEncoder();

export const defaultWorkbenchServices: WorkbenchServices = {
  preflight: (files, capacity) => preflightFiles(files, capacity),
  extract: (accepted, existingDocuments, options, signal, onProgress) => extractFile(accepted, {
    existingDocuments,
    options,
    signal,
    onProgress,
  }),
  hashText: (text) => hashBytes(encoder.encode(text).buffer),
  buildPackage: (inputs) => buildPromptPackage(inputs),
  download: (blob) => initiatePromptPackageDownload(blob),
  createDocumentId: () => globalThis.crypto?.randomUUID?.() ?? `document-${Date.now()}-${Math.random()}`,
};

export function safeExtractionMessage(error: unknown): string {
  return error instanceof FileExtractionError
    ? error.issue.message
    : "This file could not be extracted safely.";
}
