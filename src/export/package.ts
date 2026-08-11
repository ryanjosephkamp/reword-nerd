import JSZip from "jszip";
import { hashBytes } from "../domain/extraction";
import type { ModelFamily } from "../domain/profiles";
import { responseMarkers } from "../prompting/renderPromptSet";
import type {
  ArchiveAdapter,
  ExportDependencies,
  ExportDocumentInput,
  ExportFailure,
  ManifestDocumentRecord,
  PromptPackageManifest,
  PromptPackageResult,
} from "./contracts";
import { extensionForFormat, isSafeArchivePath, normalizeDocumentBase, stableCompare } from "./paths";
import { createCombinedPromptArtifact } from "./artifacts";

const textEncoder = new TextEncoder();
const fixedDate = new Date(Date.UTC(1980, 0, 1));
const fixedTimestamp = "1980-01-01T00:00:00.000Z" as const;
const packageFilename = "reword-nerd-prompt-package.zip" as const;
const stages = ["decompose", "rewrite", "verify", "final"] as const;

interface PreparedDocument {
  input: ExportSnapshot;
  originalBytes: Uint8Array;
  originalHash: string;
  reviewedHash: string;
  key: string;
}

interface ExportSnapshot {
  documentId: string;
  documentName: string;
  documentFormat: ExportDocumentInput["documentFormat"];
  original: File;
  reviewedExtractedText: string;
  resolvedSettings: ExportDocumentInput["resolvedSettings"];
  chosenProfile: ExportDocumentInput["chosenProfile"];
  promptSet: ExportDocumentInput["promptSet"];
  warnings: string[];
  contextAssessment: ExportDocumentInput["contextAssessment"];
  reviewed: boolean;
  contextWarningAcknowledged: boolean;
  uploadOrdinal: number;
}

interface ArchiveEntry {
  path: string;
  data: string | Uint8Array;
  original: boolean;
}

const messageFor: Record<ExportFailure["code"], string> = {
  NO_DOCUMENTS: "Add at least one reviewed document before exporting.",
  REVIEW_REQUIRED: "Review and confirm every document before exporting.",
  CONTEXT_ACKNOWLEDGMENT_REQUIRED: "Acknowledge each required context warning before exporting.",
  INVALID_INPUT: "One or more documents cannot be exported safely.",
  HASH_UNAVAILABLE: "A browser hashing capability is unavailable.",
  FILE_READ_FAILED: "A document could not be read safely for export.",
  ARCHIVE_GENERATION_FAILED: "The prompt package could not be generated safely.",
};

function failure(code: ExportFailure["code"], documentKey?: string): PromptPackageResult {
  return { ok: false, error: { code, message: messageFor[code], ...(documentKey ? { documentKey } : {}) } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonblankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSupportedFormat(value: unknown): value is ExportDocumentInput["documentFormat"] {
  return value === "text" || value === "markdown" || value === "docx" || value === "pdf";
}

const supportedModelFamilies = new Set<ModelFamily>([
  "alibaba",
  "anthropic",
  "custom",
  "deepseek",
  "google",
  "meta",
  "minimax",
  "mistral",
  "moonshot",
  "openai",
  "xai",
  "zai",
]);

function isSupportedModelFamily(value: unknown): value is ModelFamily {
  return typeof value === "string" && supportedModelFamilies.has(value as ModelFamily);
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveIntegerOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value > 0);
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

function snapshotInput(value: unknown): ExportSnapshot | undefined {
  if (!isRecord(value)
    || typeof value.documentId !== "string"
    || !isNonblankString(value.documentName)
    || !isSupportedFormat(value.documentFormat)
    || !isRecord(value.original)
    || typeof value.original.arrayBuffer !== "function"
    || !isNonblankString(value.reviewedExtractedText)
    || !isRecord(value.resolvedSettings)
    || !isRecord(value.chosenProfile)
    || !isRecord(value.promptSet)
    || !Array.isArray(value.warnings)
    || !isRecord(value.contextAssessment)
    || typeof value.reviewed !== "boolean"
    || typeof value.contextWarningAcknowledged !== "boolean"
    || !isNonnegativeInteger(value.uploadOrdinal)) return undefined;

  const settings = value.resolvedSettings;
  const profile = value.chosenProfile;
  const prompts = value.promptSet;
  const context = value.contextAssessment;
  if (!(["preserve", "academic", "professional", "technical", "plain"] as const).includes(settings.tone as never)
    || !(["preserve", "standard", "formal"] as const).includes(settings.formality as never)
    || !(["preserve", "concise", "expanded"] as const).includes(settings.length as never)
    || !isNonblankString(settings.outputLanguage)
    || typeof settings.customRequirements !== "string"
    || !isNonblankString(profile.id)
    || !isSupportedModelFamily(profile.family)
    || !isNonblankString(profile.label)
    || !isPositiveIntegerOrNull(profile.contextWindowTokens)
    || !isNonblankString(profile.lastReviewed)
    || !isNonblankString(profile.workflowNote)
    || !isRecord(profile.promptStrategy)
    || stages.some((stage) => !isNonblankString(prompts[stage]))
    || !value.warnings.every((warning) => typeof warning === "string")
    || context.estimateLabel !== "Estimated tokens"
    || !isNonnegativeInteger(context.sourceTokens)
    || !isNonnegativeInteger(context.workflowTokens)
    || !isPositiveIntegerOrNull(context.contextWindowTokens)
    || !(context.ratio === null || (typeof context.ratio === "number" && Number.isFinite(context.ratio) && context.ratio >= 0))
    || typeof context.oversized !== "boolean"
    || typeof context.acknowledgmentRequired !== "boolean") return undefined;

  const promptStrategy = profile.promptStrategy;
  const stageGuidance = promptStrategy.stageGuidance;
  if (!isNonblankString(promptStrategy.id)
    || !isNonblankString(promptStrategy.version)
    || !isNonblankString(promptStrategy.referenceModel)
    || !isNonblankString(promptStrategy.reviewedAt)
    || !isNonblankString(promptStrategy.guidanceDocument)
    || !(promptStrategy.layout === "task-first" || promptStrategy.layout === "source-first-task-last")
    || !(promptStrategy.delimiterStyle === "markdown" || promptStrategy.delimiterStyle === "xml")
    || !isNonblankString(promptStrategy.sharedGuidance)
    || !isRecord(stageGuidance)
    || stages.some((stage) => !isNonblankString(stageGuidance[stage]))) return undefined;

  return {
    documentId: value.documentId,
    documentName: value.documentName,
    documentFormat: value.documentFormat,
    original: value.original as unknown as File,
    reviewedExtractedText: value.reviewedExtractedText,
    resolvedSettings: {
      tone: settings.tone as ExportDocumentInput["resolvedSettings"]["tone"],
      formality: settings.formality as ExportDocumentInput["resolvedSettings"]["formality"],
      length: settings.length as ExportDocumentInput["resolvedSettings"]["length"],
      outputLanguage: settings.outputLanguage,
      customRequirements: settings.customRequirements,
    },
    chosenProfile: {
      id: profile.id,
      family: profile.family as ExportDocumentInput["chosenProfile"]["family"],
      label: profile.label,
      contextWindowTokens: profile.contextWindowTokens,
      lastReviewed: profile.lastReviewed,
      workflowNote: profile.workflowNote,
      promptStrategy: {
        id: promptStrategy.id,
        version: promptStrategy.version,
        referenceModel: promptStrategy.referenceModel,
        reviewedAt: promptStrategy.reviewedAt,
        guidanceDocument: promptStrategy.guidanceDocument,
        layout: promptStrategy.layout,
        delimiterStyle: promptStrategy.delimiterStyle,
        sharedGuidance: promptStrategy.sharedGuidance,
        stageGuidance: {
          decompose: stageGuidance.decompose as string,
          rewrite: stageGuidance.rewrite as string,
          verify: stageGuidance.verify as string,
          final: stageGuidance.final as string,
        },
      },
    },
    promptSet: {
      decompose: prompts.decompose as string,
      rewrite: prompts.rewrite as string,
      verify: prompts.verify as string,
      final: prompts.final as string,
    },
    warnings: [...value.warnings] as string[],
    contextAssessment: {
      estimateLabel: "Estimated tokens",
      sourceTokens: context.sourceTokens as number,
      workflowTokens: context.workflowTokens as number,
      contextWindowTokens: context.contextWindowTokens as number | null,
      ratio: context.ratio as number | null,
      oversized: context.oversized as boolean,
      acknowledgmentRequired: context.acknowledgmentRequired as boolean,
    },
    reviewed: value.reviewed,
    contextWarningAcknowledged: value.contextWarningAcknowledged,
    uploadOrdinal: value.uploadOrdinal,
  };
}

function snapshotInputs(value: unknown): ExportSnapshot[] | PromptPackageResult {
  if (!Array.isArray(value)) return failure("INVALID_INPUT");
  if (value.length === 0) return failure("NO_DOCUMENTS");
  const snapshots: ExportSnapshot[] = [];
  const ordinals = new Set<number>();
  for (const candidate of value) {
    const input = snapshotInput(candidate);
    if (!input || ordinals.has(input.uploadOrdinal)) return failure("INVALID_INPUT");
    ordinals.add(input.uploadOrdinal);
    if (!input.reviewed) return failure("REVIEW_REQUIRED");
    if (input.contextAssessment.acknowledgmentRequired && !input.contextWarningAcknowledged) {
      return failure("CONTEXT_ACKNOWLEDGMENT_REQUIRED");
    }
    snapshots.push(input);
  }
  return snapshots;
}

function createDefaultArchive(): ArchiveAdapter {
  const archive = new JSZip();
  return {
    file: (path, data, options) => { archive.file(path, data, options); },
    generateAsync: (options) => archive.generateAsync(options) as Promise<Blob>,
  };
}

function stableDocumentCompare(left: PreparedDocument, right: PreparedDocument): number {
  return stableCompare(left.input.documentName.normalize("NFKD"), right.input.documentName.normalize("NFKD"))
    || stableCompare(left.originalHash, right.originalHash)
    || stableCompare(left.reviewedHash, right.reviewedHash)
    || left.input.uploadOrdinal - right.input.uploadOrdinal;
}

function filenameBase(name: string): string {
  const lastDot = name.lastIndexOf(".");
  return lastDot > 0 ? name.slice(0, lastDot) : name;
}

function pathsFor(key: string, format: ExportDocumentInput["documentFormat"]): Record<string, string> {
  const extension = extensionForFormat(format);
  if (!extension) throw new Error("Validated export format missing extension.");
  const root = `documents/${key}`;
  return {
    original: `${root}/original.${extension}`,
    reviewedExtraction: `${root}/reviewed-extraction.md`,
    decompose: `${root}/prompts/01-decompose.md`,
    rewrite: `${root}/prompts/02-rewrite.md`,
    verify: `${root}/prompts/03-verify.md`,
    final: `${root}/prompts/04-final.md`,
    combinedMarkdown: `${root}/combined-prompts.md`,
    combinedHtml: `${root}/combined-prompts.html`,
  };
}

function manifestFor(prepared: readonly PreparedDocument[]): PromptPackageManifest {
  const documents: ManifestDocumentRecord[] = prepared.map((document, exportOrdinal) => {
    const paths = pathsFor(document.key, document.input.documentFormat);
    const promptHashes: ManifestDocumentRecord["prompts"] = {
      decompose: { path: paths.decompose, sha256: "" },
      rewrite: { path: paths.rewrite, sha256: "" },
      verify: { path: paths.verify, sha256: "" },
      final: { path: paths.final, sha256: "" },
    };
    return {
      key: document.key,
      exportOrdinal,
      originalDisplayName: document.input.documentName,
      format: document.input.documentFormat,
      original: { path: paths.original, byteCount: document.originalBytes.byteLength, sha256: document.originalHash },
      reviewedExtraction: {
        path: paths.reviewedExtraction,
        unicodeCodePointCount: Array.from(document.input.reviewedExtractedText).length,
        sha256: document.reviewedHash,
        warnings: [...document.input.warnings],
      },
      settings: { ...document.input.resolvedSettings },
      model: {
        id: document.input.chosenProfile.id,
        family: document.input.chosenProfile.family,
        label: document.input.chosenProfile.label,
        contextWindowTokens: document.input.chosenProfile.contextWindowTokens,
        lastReviewed: document.input.chosenProfile.lastReviewed,
        workflowNote: document.input.chosenProfile.workflowNote,
        promptStrategy: {
          id: document.input.chosenProfile.promptStrategy.id,
          version: document.input.chosenProfile.promptStrategy.version,
          referenceModel: document.input.chosenProfile.promptStrategy.referenceModel,
          reviewedAt: document.input.chosenProfile.promptStrategy.reviewedAt,
        },
      },
      contextAssessment: { ...document.input.contextAssessment },
      contextWarningAcknowledged: document.input.contextWarningAcknowledged,
      prompts: promptHashes,
      combined: {
        markdown: { path: paths.combinedMarkdown, sha256: "" },
        html: { path: paths.combinedHtml, sha256: "" },
      },
    };
  });
  return {
    schemaVersion: 2,
    package: { name: "reword-nerd", version: "0.2.0", format: "manual-four-stage-prompt-package" },
    archive: {
      entryOrder: "lexicographic-code-unit-ascending",
      timestamp: fixedTimestamp,
      originalCompression: "STORE",
      generatedCompression: "DEFLATE-9",
    },
    workflow: {
      mode: "manual",
      stages: ["decompose", "rewrite", "verify", "final"],
      responseMarkers: { stage1: responseMarkers.decompose, stage2: responseMarkers.rewrite, stage3: responseMarkers.verify },
    },
    documents,
  };
}

function createRunbook(manifest: PromptPackageManifest): string {
  const lines = [
    "# reword-nerd prompt package",
    "",
    "This package supports a local, manual four-stage rewriting workflow. It was generated locally and makes no provider call.",
    "",
    "| Document key | Original | Reviewed extraction | Decompose | Rewrite | Verify | Final | Combined Markdown | Combined HTML |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...manifest.documents.map((document) => `| ${document.key} | ${document.original.path} | ${document.reviewedExtraction.path} | ${document.prompts.decompose.path} | ${document.prompts.rewrite.path} | ${document.prompts.verify.path} | ${document.prompts.final.path} | ${document.combined.markdown.path} | ${document.combined.html.path} |`),
  ];
  for (const document of manifest.documents) {
    lines.push(
      "",
      `## ${document.key}`,
      `Selected model: ${document.model.label}`,
      `Reference model: ${document.model.promptStrategy.referenceModel}`,
      `Guidance version: ${document.model.promptStrategy.version}`,
      `Workflow note: ${document.model.workflowNote}`,
      `Resolved settings: ${JSON.stringify(document.settings)}`,
      `Context estimate: ${document.contextAssessment.workflowTokens}; known limit: ${document.contextAssessment.contextWindowTokens ?? "unknown"}; required warning acknowledged: ${document.contextAssessment.acknowledgmentRequired ? (document.contextWarningAcknowledged ? "yes" : "no") : "not required"}.`,
      "Manual flow: start a new conversation; run Stage 1; copy its response into the Stage 1 marker in Stage 2; run Stage 2; fill both prior markers in Stage 3; run Stage 3; fill all three markers in Stage 4; run Stage 4; review the final output.",
      `Stage 1 marker: ${manifest.workflow.responseMarkers.stage1}`,
      `Stage 2 marker: ${manifest.workflow.responseMarkers.stage2}`,
      `Stage 3 marker: ${manifest.workflow.responseMarkers.stage3}`,
    );
  }
  lines.push(
    "",
    "Replace only the response markers and keep instruction/source blocks intact.",
    "",
  );
  return lines.join("\n");
}

export async function buildPromptPackage(
  inputs: readonly ExportDocumentInput[],
  dependencies: ExportDependencies = {},
): Promise<PromptPackageResult> {
  let snapshots: ExportSnapshot[] | PromptPackageResult;
  try {
    snapshots = snapshotInputs(inputs);
  } catch {
    return failure("INVALID_INPUT");
  }
  if (!Array.isArray(snapshots)) return snapshots;

  const prepared: PreparedDocument[] = [];
  try {
    for (const input of snapshots) {
      const readBytes: unknown = await input.original.arrayBuffer();
      if (!isArrayBuffer(readBytes)) throw new Error("File-like input returned non-binary data.");
      const originalBytes = new Uint8Array(readBytes).slice();
      prepared.push({ input, originalBytes, originalHash: "", reviewedHash: "", key: "" });
    }
  } catch {
    return failure("FILE_READ_FAILED");
  }
  try {
    for (const document of prepared) {
      const { input, originalBytes } = document;
      const originalHash = await hashBytes(originalBytes.buffer, dependencies.hasher);
      const reviewedHash = await hashBytes(textEncoder.encode(input.reviewedExtractedText).buffer, dependencies.hasher);
      document.originalHash = originalHash;
      document.reviewedHash = reviewedHash;
      document.key = `${normalizeDocumentBase(filenameBase(input.documentName))}--${originalHash.slice(0, 12)}`;
    }
  } catch {
    return failure("HASH_UNAVAILABLE");
  }

  prepared.sort(stableDocumentCompare);
  const seenKeys = new Map<string, number>();
  for (const document of prepared) {
    const count = seenKeys.get(document.key) ?? 0;
    seenKeys.set(document.key, count + 1);
    if (count > 0) document.key = `${document.key}--${count + 1}`;
  }
  const manifest = manifestFor(prepared);
  const entries: ArchiveEntry[] = [];
  const runbook = createRunbook(manifest);
  const artifacts = [];
  try {
    for (const [index, document] of prepared.entries()) {
      const paths = pathsFor(document.key, document.input.documentFormat);
      const record = manifest.documents[index];
      for (const stage of stages) record.prompts[stage] = { path: paths[stage], sha256: await hashBytes(textEncoder.encode(document.input.promptSet[stage]).buffer, dependencies.hasher) };
      const artifact = createCombinedPromptArtifact(manifest, index, runbook, document.input.promptSet);
      record.combined.markdown.sha256 = await hashBytes(textEncoder.encode(artifact.markdown).buffer, dependencies.hasher);
      record.combined.html.sha256 = await hashBytes(textEncoder.encode(artifact.html).buffer, dependencies.hasher);
      artifacts.push(artifact);
      entries.push(
        { path: paths.original, data: document.originalBytes, original: true },
        { path: paths.reviewedExtraction, data: document.input.reviewedExtractedText, original: false },
        ...stages.map((stage) => ({ path: paths[stage], data: document.input.promptSet[stage], original: false })),
        { path: paths.combinedMarkdown, data: artifact.markdown, original: false },
        { path: paths.combinedHtml, data: artifact.html, original: false },
      );
    }
  } catch {
    return failure("HASH_UNAVAILABLE");
  }
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  entries.push({ path: "manifest.json", data: manifestText, original: false }, { path: "README.md", data: runbook, original: false });
  if (new Set(entries.map((entry) => entry.path)).size !== entries.length || entries.some((entry) => !isSafeArchivePath(entry.path))) {
    return failure("INVALID_INPUT");
  }
  try {
    const archive = dependencies.createArchive?.() ?? createDefaultArchive();
    for (const entry of [...entries].sort((left, right) => stableCompare(left.path, right.path))) {
      archive.file(entry.path, entry.data, {
        date: fixedDate,
        createFolders: false,
        comment: "",
        unixPermissions: "100644",
        compression: entry.original ? "STORE" : "DEFLATE",
        compressionOptions: entry.original ? undefined : { level: 9 },
      });
    }
    const blob = await archive.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
      comment: "",
      platform: "UNIX",
      streamFiles: false,
      mimeType: "application/zip",
    });
    return { ok: true, blob, filename: packageFilename, manifest, artifacts };
  } catch {
    return failure("ARCHIVE_GENERATION_FAILED");
  }
}
