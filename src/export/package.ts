import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { hashBytes } from "../domain/extraction";
import {
  cloneExtractionOptions,
  DEFAULT_EXTRACTION_OPTIONS,
  MAX_GENERATED_MEDIA_BYTES_PER_PACKAGE,
  MAX_ARCHIVE_ENTRY_BYTES,
  MAX_FOLDER_FILE_BYTES,
  MAX_PROJECT_BYTES,
  MAX_PROJECT_ENTRIES,
  MAX_PROMPT_DECODED_TEXT_BYTES,
  MAX_PROMPT_TEXT_FILES,
  assessSourceContext,
  classifyStandaloneTextName,
  classifySensitiveProjectEntry,
  decodeSafeStandaloneText,
  genericTextClassification,
  hashOriginalProjectTree,
  hashReviewedTree,
  joinProjectArchivePath,
  normalizeProjectPath,
  type ExtractionOptions,
  type LatexProjectMetadata,
  type OcrCandidate,
  type ProjectEntry,
  type WorkspaceProject,
  type VisualAsset,
} from "../domain";
import type { ModelFamily } from "../domain/profiles";
import { readSafeLatexProjectFiles } from "../domain/latex";
import { renderPromptBundle, renderPromptSource, responseMarkers } from "../prompting/renderPromptSet";
import { APP_VERSION } from "../version";
import type {
  ArchiveAdapter,
  ExportDependencies,
  ExportDocumentInput,
  ExportProjectInput,
  ExportSourceInput,
  ExportFailure,
  ManifestDocumentRecord,
  PromptPackageManifest,
  PromptPackageResult,
} from "./contracts";
import { extensionForFormat, isSafeArchivePath, normalizeDocumentBase, stableCompare } from "./paths";
import { createDocumentWorkbook, escapeMarkdownText } from "./artifacts";
import { createRunbookDocument, serializeRunbookMarkdown } from "./runbook";
import { TEXT_HTML_THEME_CSS } from "./textHtmlTheme";

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
  kind: "document" | "project";
  documentId: string;
  documentName: string;
  documentFormat: ExportDocumentInput["documentFormat"];
  original?: File;
  reviewedExtractedText: string;
  resolvedSettings: ExportDocumentInput["resolvedSettings"];
  chosenProfile: ExportDocumentInput["chosenProfile"];
  promptBundle: ExportDocumentInput["promptBundle"];
  warnings: string[];
  contextAssessment: Pick<ExportDocumentInput["contextAssessment"],
    | "estimateLabel"
    | "sourceTokens"
    | "oneShotWorkflowTokens"
    | "manualWorkflowTokens"
    | "oneShotRatio"
    | "manualRatio"
    | "oneShotOversized"
    | "manualOversized"
    | "oneShotWarning"
    | "workflowTokens"
    | "contextWindowTokens"
    | "ratio"
    | "oversized"
    | "acknowledgmentRequired"
    | "includedFileCount"
    | "amberRisk"
    | "amberRiskReasons"
    | "inspectDiffsAndRunTestsWarning"
  >;
  reviewed: boolean;
  contextWarningAcknowledged: boolean;
  uploadOrdinal: number;
  pageCount: number | null;
  extractionOptions: ExtractionOptions;
  visualAssets: VisualAsset[];
  ocrCandidates: OcrCandidate[];
  latexProject?: LatexProjectMetadata;
  project?: WorkspaceProject;
  codeRewriteOptions?: ExportProjectInput["codeRewriteOptions"];
  sensitiveBlockedCounts?: ExportProjectInput["sensitiveBlockedCounts"];
}

interface ArchiveEntry {
  path: string;
  data: string | Uint8Array;
  stored: boolean;
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
  return typeof value === "string" && new Set<ExportDocumentInput["documentFormat"]>([
    "text", "markdown", "html", "xml", "json", "jsonl", "ndjson", "csv", "tsv",
    "yaml", "toml", "ini", "config", "css", "sql", "code", "docx", "pdf", "latex",
    "latex-project",
  ]).has(value as ExportDocumentInput["documentFormat"]);
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

function snapshotExtractionOptions(value: unknown): ExtractionOptions | undefined {
  if (value === undefined) return cloneExtractionOptions(DEFAULT_EXTRACTION_OPTIONS);
  if (!isRecord(value)
    || typeof value.extractEmbeddedImages !== "boolean"
    || typeof value.capturePageVisuals !== "boolean"
    || !(value.pageSelection === "all" || typeof value.pageSelection === "string")
    || !(value.pageCaptureQuality === "standard" || value.pageCaptureQuality === "high")
    || !(value.ocrMode === "off" || value.ocrMode === "textless-pages" || value.ocrMode === "all-pages")
    || typeof value.ocrExtractedAssets !== "boolean"
    || typeof value.excludeDecorativeImages !== "boolean"
    || !isRecord(value.ocrLanguage)
    || value.ocrLanguage.kind !== "bundled"
    || value.ocrLanguage.code !== "eng"
    || value.ocrLanguage.label !== "English") return undefined;
  return cloneExtractionOptions(value as unknown as ExtractionOptions);
}

const assetKinds = new Set<VisualAsset["kind"]>([
  "pdf-raster",
  "pdf-page-capture",
  "docx-media",
  "markdown-data-image",
  "latex-asset",
  "latex-preview",
]);

function snapshotVisualAssets(value: unknown): VisualAsset[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const assets: VisualAsset[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)
      || !isNonblankString(candidate.id)
      || typeof candidate.kind !== "string"
      || !assetKinds.has(candidate.kind as VisualAsset["kind"])
      || !isNonblankString(candidate.filename)
      || !isNonblankString(candidate.mimeType)
      || !(candidate.bytes instanceof Uint8Array)
      || !isNonnegativeInteger(candidate.byteCount)
      || candidate.byteCount !== candidate.bytes.byteLength
      || !isNonnegativeInteger(candidate.order)
      || typeof candidate.included !== "boolean"
      || typeof candidate.decorative !== "boolean"
      || !Array.isArray(candidate.warnings)
      || !candidate.warnings.every((warning) => typeof warning === "string")) return undefined;
    assets.push({
      ...(candidate as unknown as VisualAsset),
      bytes: candidate.bytes.slice(),
      warnings: [...candidate.warnings] as string[],
      ...(isRecord(candidate.bounds) ? { bounds: { ...candidate.bounds } as unknown as VisualAsset["bounds"] } : {}),
    });
  }
  return assets;
}

function snapshotOcrCandidates(value: unknown): OcrCandidate[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const candidates: OcrCandidate[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)
      || !isNonblankString(candidate.id)
      || !isRecord(candidate.source)
      || !isNonblankString(candidate.text)
      || typeof candidate.reviewedText !== "string"
      || typeof candidate.confidence !== "number"
      || !Number.isFinite(candidate.confidence)
      || !(candidate.status === "pending" || candidate.status === "accepted" || candidate.status === "omitted")
      || candidate.engine !== "tesseract.js"
      || !isNonblankString(candidate.engineVersion)
      || !isNonblankString(candidate.languageCode)
      || !isNonblankString(candidate.languageHash)) return undefined;
    if (candidate.source.kind === "page" && !isNonnegativeInteger(candidate.source.pageNumber)) return undefined;
    if (candidate.source.kind === "asset" && !isNonblankString(candidate.source.assetId)) return undefined;
    if (candidate.source.kind !== "page" && candidate.source.kind !== "asset") return undefined;
    candidates.push({
      ...(candidate as unknown as OcrCandidate),
      source: { ...candidate.source } as OcrCandidate["source"],
    });
  }
  return candidates;
}

function snapshotLatexProject(value: unknown): LatexProjectMetadata | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)
    || !(value.mainFile === null || typeof value.mainFile === "string")
    || !Array.isArray(value.mainFileCandidates)
    || !Array.isArray(value.files)
    || !isRecord(value.dependencies)
    || !Array.isArray(value.missingDependencies)
    || !Array.isArray(value.cycles)) return undefined;
  return JSON.parse(JSON.stringify(value)) as LatexProjectMetadata;
}

function snapshotDocumentInput(value: unknown): ExportSnapshot | undefined {
  if (!isRecord(value)
    || typeof value.documentId !== "string"
    || !isNonblankString(value.documentName)
    || !isSupportedFormat(value.documentFormat)
    || !isRecord(value.original)
    || typeof value.original.arrayBuffer !== "function"
    || !isNonblankString(value.reviewedExtractedText)
    || !isRecord(value.resolvedSettings)
    || !isRecord(value.chosenProfile)
    || !isRecord(value.promptBundle)
    || !Array.isArray(value.warnings)
    || !isRecord(value.contextAssessment)
    || typeof value.reviewed !== "boolean"
    || typeof value.contextWarningAcknowledged !== "boolean"
    || !isNonnegativeInteger(value.uploadOrdinal)) return undefined;

  const settings = value.resolvedSettings;
  const profile = value.chosenProfile;
  const promptBundle = value.promptBundle;
  const prompts = promptBundle.manual;
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
    || !isNonblankString(promptBundle.oneShot)
    || !isRecord(prompts)
    || stages.some((stage) => !isNonblankString(prompts[stage]))
    || !value.warnings.every((warning) => typeof warning === "string")
    || context.estimateLabel !== "Estimated tokens"
    || !isNonnegativeInteger(context.sourceTokens)
    || !isNonnegativeInteger(context.oneShotWorkflowTokens)
    || !isNonnegativeInteger(context.manualWorkflowTokens)
    || !isNonnegativeInteger(context.workflowTokens)
    || !isPositiveIntegerOrNull(context.contextWindowTokens)
    || !(context.oneShotRatio === null || (typeof context.oneShotRatio === "number" && Number.isFinite(context.oneShotRatio) && context.oneShotRatio >= 0))
    || !(context.manualRatio === null || (typeof context.manualRatio === "number" && Number.isFinite(context.manualRatio) && context.manualRatio >= 0))
    || !(context.ratio === null || (typeof context.ratio === "number" && Number.isFinite(context.ratio) && context.ratio >= 0))
    || typeof context.oneShotOversized !== "boolean"
    || typeof context.manualOversized !== "boolean"
    || typeof context.oneShotWarning !== "boolean"
    || typeof context.oversized !== "boolean"
    || typeof context.acknowledgmentRequired !== "boolean"
    || !(context.includedFileCount === undefined || isNonnegativeInteger(context.includedFileCount))
    || !(context.amberRisk === undefined || typeof context.amberRisk === "boolean")
    || !(context.amberRiskReasons === undefined || (Array.isArray(context.amberRiskReasons)
      && context.amberRiskReasons.every((reason) => reason === "included-file-count" || reason === "one-shot-ratio")))
    || !(context.inspectDiffsAndRunTestsWarning === undefined
      || context.inspectDiffsAndRunTestsWarning === "Inspect the generated diffs and run your normal tests/build after applying changes.")) return undefined;

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
    || !isNonblankString(promptStrategy.oneShotGuidanceVersion)
    || !isNonblankString(promptStrategy.oneShotGuidance)
    || !isRecord(stageGuidance)
    || stages.some((stage) => !isNonblankString(stageGuidance[stage]))) return undefined;

  const extractionOptions = snapshotExtractionOptions(value.extractionOptions);
  const visualAssets = snapshotVisualAssets(value.visualAssets);
  const ocrCandidates = snapshotOcrCandidates(value.ocrCandidates);
  const latexProject = snapshotLatexProject(value.latexProject);
  const pageCount = value.pageCount === undefined || value.pageCount === null
    ? null
    : isNonnegativeInteger(value.pageCount) ? value.pageCount : undefined;
  if (!extractionOptions
    || !visualAssets
    || !ocrCandidates
    || pageCount === undefined
    || ocrCandidates.some((candidate) => candidate.status === "pending")
    || (value.latexProject !== undefined && !latexProject)) return undefined;

  return {
    kind: "document",
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
        oneShotGuidanceVersion: promptStrategy.oneShotGuidanceVersion,
        oneShotGuidance: promptStrategy.oneShotGuidance,
        stageGuidance: {
          decompose: stageGuidance.decompose as string,
          rewrite: stageGuidance.rewrite as string,
          verify: stageGuidance.verify as string,
          final: stageGuidance.final as string,
        },
      },
    },
    promptBundle: {
      oneShot: promptBundle.oneShot,
      manual: {
        decompose: prompts.decompose as string,
        rewrite: prompts.rewrite as string,
        verify: prompts.verify as string,
        final: prompts.final as string,
      },
    },
    warnings: [...value.warnings] as string[],
    contextAssessment: {
      estimateLabel: "Estimated tokens",
      sourceTokens: context.sourceTokens as number,
      oneShotWorkflowTokens: context.oneShotWorkflowTokens as number,
      manualWorkflowTokens: context.manualWorkflowTokens as number,
      oneShotRatio: context.oneShotRatio as number | null,
      manualRatio: context.manualRatio as number | null,
      oneShotOversized: context.oneShotOversized as boolean,
      manualOversized: context.manualOversized as boolean,
      oneShotWarning: context.oneShotWarning as boolean,
      workflowTokens: context.workflowTokens as number,
      contextWindowTokens: context.contextWindowTokens as number | null,
      ratio: context.ratio as number | null,
      oversized: context.oversized as boolean,
      acknowledgmentRequired: context.acknowledgmentRequired as boolean,
      ...(context.includedFileCount !== undefined ? { includedFileCount: context.includedFileCount } : {}),
      ...(context.amberRisk !== undefined ? { amberRisk: context.amberRisk } : {}),
      ...(context.amberRiskReasons !== undefined ? { amberRiskReasons: [...context.amberRiskReasons] as ("included-file-count" | "one-shot-ratio")[] } : {}),
      ...(context.inspectDiffsAndRunTestsWarning !== undefined ? { inspectDiffsAndRunTestsWarning: context.inspectDiffsAndRunTestsWarning } : {}),
    },
    reviewed: value.reviewed,
    contextWarningAcknowledged: value.contextWarningAcknowledged,
    uploadOrdinal: value.uploadOrdinal,
    pageCount,
    extractionOptions,
    visualAssets,
    ocrCandidates,
    ...(latexProject ? { latexProject } : {}),
  };
}

function snapshotCodeRewriteOptions(value: unknown): ExportProjectInput["codeRewriteOptions"] | undefined {
  if (!isRecord(value)
    || typeof value.documentationAndMarkup !== "boolean"
    || typeof value.commentsAndDocstrings !== "boolean"
    || typeof value.userFacingStrings !== "boolean"
    || typeof value.narrativeStructuredDataValues !== "boolean"
    || typeof value.honorRootGitignore !== "boolean"
    || typeof value.excludeDependenciesBuildGenerated !== "boolean"
    || typeof value.preserveSafeNonTextAssets !== "boolean"
    || value.protectedExecutableSyntax !== true) return undefined;
  return {
    documentationAndMarkup: value.documentationAndMarkup,
    commentsAndDocstrings: value.commentsAndDocstrings,
    userFacingStrings: value.userFacingStrings,
    narrativeStructuredDataValues: value.narrativeStructuredDataValues,
    honorRootGitignore: value.honorRootGitignore,
    excludeDependenciesBuildGenerated: value.excludeDependenciesBuildGenerated,
    preserveSafeNonTextAssets: value.preserveSafeNonTextAssets,
    protectedExecutableSyntax: true,
  };
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function cloneProjectEntry(value: unknown): ProjectEntry | undefined {
  if (!isRecord(value)
    || !isNonblankString(value.path)
    || value.immutablePath !== value.path
    || !isNonnegativeInteger(value.byteCount)
    || !isSha256(value.originalHash)
    || value.sha256 !== value.originalHash
    || !(value.originalBytes instanceof Uint8Array)
    || value.originalBytes.byteLength !== value.byteCount
    || !(value.contentKind === "text" || value.contentKind === "asset" || value.contentKind === "invalid-text")
    || !(value.languageId === null || typeof value.languageId === "string")
    || !(value.previewKind === null || typeof value.previewKind === "string")
    || !(value.reviewedText === null || typeof value.reviewedText === "string")
    || !(value.reviewedTextHash === null || isSha256(value.reviewedTextHash))
    || !isNonnegativeInteger(value.reviewRevision)
    || typeof value.promptIncluded !== "boolean"
    || typeof value.packageIncluded !== "boolean"
    || !(value.exclusionReason === null
      || value.exclusionReason === "gitignore"
      || value.exclusionReason === "default-excluded"
      || value.exclusionReason === "non-text-asset"
      || value.exclusionReason === "invalid-text"
      || value.exclusionReason === "prompt-limit")
    || typeof value.restorable !== "boolean") return undefined;
  try {
    if (normalizeProjectPath(value.path) !== value.path) return undefined;
  } catch {
    return undefined;
  }
  const decodedOriginal = decodeSafeStandaloneText(value.originalBytes);
  const namedClassification = classifyStandaloneTextName(value.path);
  const expectedTextClassification = namedClassification ?? (decodedOriginal.ok ? genericTextClassification() : undefined);
  if (value.contentKind === "text") {
    if (!expectedTextClassification
      || !decodedOriginal.ok
      || value.languageId !== expectedTextClassification.languageId
      || value.previewKind !== expectedTextClassification.previewKind
      || typeof value.reviewedText !== "string"
      || !decodeSafeStandaloneText(textEncoder.encode(value.reviewedText)).ok
      || !isSha256(value.reviewedTextHash)
      || value.restorable !== true
      || (value.promptIncluded && !value.packageIncluded)
      || (value.promptIncluded && value.exclusionReason !== null)
      || value.exclusionReason === "non-text-asset"
      || value.exclusionReason === "invalid-text") return undefined;
  } else if (value.contentKind === "asset") {
    if (expectedTextClassification
      || value.languageId !== null
      || value.previewKind !== null
      || value.reviewedText !== null
      || value.reviewedTextHash !== null
      || value.promptIncluded
      || value.restorable !== true
      || !(value.exclusionReason === "non-text-asset"
        || value.exclusionReason === "gitignore"
        || value.exclusionReason === "default-excluded")
      || (value.packageIncluded && value.exclusionReason !== "non-text-asset")) return undefined;
  } else if (!namedClassification
    || decodedOriginal.ok
    || value.languageId !== namedClassification.languageId
    || value.previewKind !== namedClassification.previewKind
    || value.reviewedText !== null
    || value.reviewedTextHash !== null
    || value.promptIncluded
    || value.packageIncluded
    || value.exclusionReason !== "invalid-text"
    || value.restorable) return undefined;
  return Object.freeze({
    path: value.path,
    immutablePath: value.path,
    byteCount: value.byteCount,
    originalHash: value.originalHash,
    sha256: value.originalHash,
    originalBytes: value.originalBytes.slice(),
    contentKind: value.contentKind,
    languageId: value.languageId,
    previewKind: value.previewKind as ProjectEntry["previewKind"],
    reviewedText: value.reviewedText,
    reviewedTextHash: value.reviewedTextHash,
    reviewRevision: value.reviewRevision,
    promptIncluded: value.promptIncluded,
    packageIncluded: value.packageIncluded,
    exclusionReason: value.exclusionReason,
    restorable: value.restorable,
  });
}

function snapshotWorkspaceProject(value: unknown): WorkspaceProject | undefined {
  if (!isRecord(value)
    || value.kind !== "project"
    || !isNonblankString(value.id)
    || !isNonblankString(value.name)
    || !(value.sourceKind === "folder" || value.sourceKind === "zip")
    || !(value.status === "needs-review" || value.status === "ready" || value.status === "blocked" || value.status === "error")
    || !Array.isArray(value.entries)
    || !isSha256(value.originalTreeHash)
    || !isSha256(value.reviewedTreeHash)
    || value.treeHash !== value.originalTreeHash
    || !isNonnegativeInteger(value.totalByteCount)
    || !(value.classification === "latex" || value.classification === "general-text")
    || typeof value.classificationChoiceRequired !== "boolean"
    || !Array.isArray(value.classificationChoices)
    || !value.classificationChoices.every((choice) => choice === "latex" || choice === "general-text")
    || !(value.rootDocument === null || typeof value.rootDocument === "string")
    || !(value.selectedEntryPath === null || typeof value.selectedEntryPath === "string")
    || !isNonnegativeInteger(value.projectOperationGeneration)
    || !isNonnegativeInteger(value.projectReviewRevision)
    || typeof value.requiresReview !== "boolean"
    || !Array.isArray(value.warnings)
    || !value.warnings.every((warning) => typeof warning === "string")
    || !isRecord(value.sensitiveBlockedCounts)
    || !isNonnegativeInteger(value.sensitiveBlockedCounts.credentialFiles)
    || !isNonnegativeInteger(value.sensitiveBlockedCounts.privateKeys)
    || !isNonnegativeInteger(value.sensitiveBlockedCounts.clearCredentials)
    || !isRecord(value.intake)
    || value.intake.kind !== value.sourceKind
    || !isNonblankString(value.intake.displayName)
    || !isRecord(value.settingsOverride)
    || typeof value.contextWarningAcknowledged !== "boolean") return undefined;
  const entries = value.entries.map(cloneProjectEntry);
  if (entries.some((entry) => !entry)) return undefined;
  const projectReviewRevision = value.projectReviewRevision as number;
  if (entries.length > MAX_PROJECT_ENTRIES
    || value.name !== value.intake.displayName
    || !value.classificationChoices.includes(value.classification)
    || (value.classification === "general-text" && value.rootDocument !== null)
    || (entries as ProjectEntry[]).some((entry) => entry.reviewRevision > projectReviewRevision)) return undefined;
  const exact = new Set<string>();
  const portable = new Set<string>();
  let priorPath: string | null = null;
  let computedTotalBytes = 0;
  let promptFileCount = 0;
  let promptTextBytes = 0;
  const perEntryLimit = value.sourceKind === "zip" ? MAX_ARCHIVE_ENTRY_BYTES : MAX_FOLDER_FILE_BYTES;
  for (const entry of entries as ProjectEntry[]) {
    if (priorPath !== null && stableCompare(priorPath, entry.path) >= 0) return undefined;
    priorPath = entry.path;
    computedTotalBytes += entry.byteCount;
    if (entry.byteCount > perEntryLimit) return undefined;
    if (entry.promptIncluded) {
      promptFileCount += 1;
      if (entry.contentKind !== "text" || entry.reviewedText === null) return undefined;
      promptTextBytes += textEncoder.encode(entry.reviewedText).byteLength;
    }
    const key = entry.path.normalize("NFKC").toLocaleLowerCase("und").replaceAll("ß", "ss").replaceAll("ς", "σ");
    if (exact.has(entry.path) || portable.has(key)) return undefined;
    exact.add(entry.path);
    portable.add(key);
  }
  if (computedTotalBytes !== value.totalByteCount
    || computedTotalBytes > MAX_PROJECT_BYTES
    || promptFileCount > MAX_PROMPT_TEXT_FILES
    || promptTextBytes > MAX_PROMPT_DECODED_TEXT_BYTES) return undefined;
  let originalContainer: WorkspaceProject["originalContainer"];
  if (value.originalContainer !== undefined) {
    if (value.sourceKind !== "zip"
      || !isRecord(value.originalContainer)
      || !isNonblankString(value.originalContainer.displayName)
      || value.originalContainer.displayName !== value.intake.displayName
      || !isNonnegativeInteger(value.originalContainer.byteCount)
      || !isSha256(value.originalContainer.sha256)) return undefined;
    originalContainer = Object.freeze({
      displayName: value.originalContainer.displayName,
      byteCount: value.originalContainer.byteCount,
      sha256: value.originalContainer.sha256,
    });
  } else if (value.sourceKind === "zip") return undefined;
  const sensitiveBlockedCounts = Object.freeze({
    credentialFiles: value.sensitiveBlockedCounts.credentialFiles,
    privateKeys: value.sensitiveBlockedCounts.privateKeys,
    clearCredentials: value.sensitiveBlockedCounts.clearCredentials,
  });
  const blockedCount = Object.values(sensitiveBlockedCounts).reduce((total, count) => total + count, 0);
  const warnings = [
    ...(blockedCount > 0 ? [`${blockedCount} sensitive project ${blockedCount === 1 ? "file was" : "files were"} dropped before hashing and retention.`] : []),
    ...(value.classificationChoiceRequired
      ? ["Choose whether to treat this ZIP as a LaTeX or General text project before confirming review."]
      : []),
  ];
  return {
    kind: "project",
    id: value.id,
    name: value.name,
    sourceKind: value.sourceKind,
    status: value.status,
    entries: Object.freeze(entries as ProjectEntry[]),
    originalTreeHash: value.originalTreeHash,
    reviewedTreeHash: value.reviewedTreeHash,
    treeHash: value.originalTreeHash,
    totalByteCount: value.totalByteCount,
    classification: value.classification,
    classificationChoiceRequired: value.classificationChoiceRequired,
    classificationChoices: Object.freeze([...value.classificationChoices]) as WorkspaceProject["classificationChoices"],
    rootDocument: value.rootDocument,
    selectedEntryPath: value.selectedEntryPath,
    projectOperationGeneration: value.projectOperationGeneration,
    projectReviewRevision,
    requiresReview: value.requiresReview,
    warnings: Object.freeze(warnings),
    sensitiveBlockedCounts,
    intake: Object.freeze({ kind: value.sourceKind, displayName: value.intake.displayName }),
    ...(originalContainer ? { originalContainer } : {}),
    settingsOverride: { ...value.settingsOverride },
    contextWarningAcknowledged: value.contextWarningAcknowledged,
  };
}

function snapshotProjectInput(value: unknown): ExportSnapshot | undefined {
  if (!isRecord(value)
    || value.kind !== "project"
    || typeof value.projectId !== "string"
    || !isNonblankString(value.projectName)
    || !isRecord(value.project)) return undefined;
  const project = snapshotWorkspaceProject(value.project);
  const codeRewriteOptions = snapshotCodeRewriteOptions(value.codeRewriteOptions);
  if (!project
    || !codeRewriteOptions
    || project.id !== value.projectId
    || project.name !== value.projectName
    || project.contextWarningAcknowledged !== value.contextWarningAcknowledged
    || !isRecord(value.sensitiveBlockedCounts)
    || !isNonnegativeInteger(value.sensitiveBlockedCounts.credentialFiles)
    || !isNonnegativeInteger(value.sensitiveBlockedCounts.privateKeys)
    || !isNonnegativeInteger(value.sensitiveBlockedCounts.clearCredentials)) return undefined;
  const sensitiveBlockedCounts = {
    credentialFiles: value.sensitiveBlockedCounts.credentialFiles,
    privateKeys: value.sensitiveBlockedCounts.privateKeys,
    clearCredentials: value.sensitiveBlockedCounts.clearCredentials,
  };
  if (JSON.stringify(project.sensitiveBlockedCounts) !== JSON.stringify(sensitiveBlockedCounts)) return undefined;
  const base = snapshotDocumentInput({
    documentId: value.projectId,
    documentName: value.projectName,
    documentFormat: project.classification === "latex" ? "latex-project" : "text",
    original: { arrayBuffer: () => new ArrayBuffer(0) },
    reviewedExtractedText: value.reviewedExtractedText,
    resolvedSettings: value.resolvedSettings,
    chosenProfile: value.chosenProfile,
    promptBundle: value.promptBundle,
    warnings: project.warnings,
    contextAssessment: value.contextAssessment,
    reviewed: value.reviewed,
    contextWarningAcknowledged: value.contextWarningAcknowledged,
    uploadOrdinal: value.uploadOrdinal,
  });
  if (!base) return undefined;
  return {
    ...base,
    kind: "project",
    original: undefined,
    project,
    codeRewriteOptions,
    sensitiveBlockedCounts,
    warnings: [...project.warnings],
  };
}

function snapshotInput(value: unknown): ExportSnapshot | undefined {
  return isRecord(value) && value.kind === "project"
    ? snapshotProjectInput(value)
    : snapshotDocumentInput(value);
}

/** @internal Pure limit check kept separate so the cumulative boundary is testable without allocating 100 MiB. */
export function exceedsCumulativeProjectBytes(byteCounts: readonly number[]): boolean {
  let total = 0;
  for (const count of byteCounts) {
    if (!isNonnegativeInteger(count)) return true;
    total += count;
    if (!Number.isSafeInteger(total) || total > MAX_PROJECT_BYTES) return true;
  }
  return false;
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
  if (exceedsCumulativeProjectBytes(snapshots.flatMap((input) => input.project ? [input.project.totalByteCount] : []))) {
    return failure("INVALID_INPUT");
  }
  return snapshots;
}

function arrayBufferFor(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function revalidateProjectSnapshot(input: ExportSnapshot, hasher?: ExportDependencies["hasher"]): Promise<boolean> {
  const project = input.project;
  const codeRewriteOptions = input.codeRewriteOptions;
  if (input.kind !== "project"
    || !project
    || !codeRewriteOptions
    || input.reviewed !== true
    || project.status !== "ready"
    || project.requiresReview
    || project.classificationChoiceRequired) return false;
  if (!project.classificationChoices.includes(project.classification)
    || (project.classification === "general-text" && project.rootDocument !== null)) return false;
  let totalByteCount = 0;
  for (const entry of project.entries) {
    try {
      if (normalizeProjectPath(entry.path) !== entry.path) return false;
      joinProjectArchivePath("project/files", entry.path);
    } catch {
      return false;
    }
    totalByteCount += entry.byteCount;
    if (entry.reviewRevision > project.projectReviewRevision) return false;
    if (classifySensitiveProjectEntry(entry.path, entry.originalBytes) !== null) return false;
    if (await hashBytes(arrayBufferFor(entry.originalBytes), hasher) !== entry.originalHash) return false;
    if (entry.contentKind === "text") {
      if (entry.reviewedText === null || entry.reviewedTextHash === null) return false;
      const reviewedBytes = textEncoder.encode(entry.reviewedText);
      if (classifySensitiveProjectEntry(entry.path, reviewedBytes) !== null
        || await hashBytes(reviewedBytes.buffer, hasher) !== entry.reviewedTextHash) return false;
    } else if (entry.reviewedText !== null || entry.reviewedTextHash !== null || entry.promptIncluded) return false;
    if (entry.packageIncluded && entry.contentKind === "invalid-text") return false;
  }
  if (totalByteCount !== project.totalByteCount
    || await hashOriginalProjectTree(project.entries, hasher) !== project.originalTreeHash
    || await hashReviewedTree(project.entries, hasher, project.classification, project.rootDocument) !== project.reviewedTreeHash) return false;
  if (project.classification === "latex") {
    if (project.rootDocument === null || !/\.(?:tex|ltx)$/iu.test(project.rootDocument)) return false;
    const root = project.entries.find((entry) => entry.path === project.rootDocument);
    if (!root?.promptIncluded || !root.packageIncluded || root.contentKind !== "text") return false;
  }
  const includedFiles = project.entries.flatMap((entry) => entry.promptIncluded
    && entry.contentKind === "text"
    && entry.reviewedText !== null
    && entry.reviewedTextHash !== null
    && entry.languageId !== null
    && entry.previewKind !== null
    ? [{
        path: entry.path,
        text: entry.reviewedText,
        originalHash: entry.originalHash,
        reviewedTextHash: entry.reviewedTextHash,
        languageId: entry.languageId,
        previewKind: entry.previewKind,
      }]
    : []);
  const excludedPaths = project.entries.filter((entry) => !entry.promptIncluded).map((entry) => entry.path);
  const format = project.classification === "latex" ? "latex-project" as const : "text" as const;
  const sourceContext = {
    kind: "project" as const,
    format,
    assets: [],
    reviewedTreeHash: project.reviewedTreeHash,
    includedFiles,
    excludedPaths,
    codeRewriteOptions,
    latexMainFile: project.rootDocument,
  };
  const reviewedExtractedText = renderPromptSource(sourceContext);
  if (input.reviewedExtractedText !== reviewedExtractedText) return false;
  const expectedBundle = renderPromptBundle(reviewedExtractedText, input.resolvedSettings, input.chosenProfile, sourceContext);
  if (input.promptBundle.oneShot !== expectedBundle.oneShot
    || stages.some((stage) => input.promptBundle.manual[stage] !== expectedBundle.manual[stage])) return false;
  const expectedContext = assessSourceContext({ kind: "project", includedFiles }, input.chosenProfile.contextWindowTokens);
  const contextKeys = [
    "estimateLabel",
    "sourceTokens", "oneShotWorkflowTokens", "manualWorkflowTokens", "oneShotRatio", "manualRatio",
    "oneShotOversized", "manualOversized", "oneShotWarning", "workflowTokens", "contextWindowTokens",
    "ratio", "oversized", "acknowledgmentRequired", "includedFileCount", "amberRisk",
    "inspectDiffsAndRunTestsWarning",
  ] as const;
  return contextKeys.every((key) => input.contextAssessment[key] === expectedContext[key])
    && JSON.stringify(input.contextAssessment.amberRiskReasons ?? []) === JSON.stringify(expectedContext.amberRiskReasons ?? []);
}

function createDefaultArchive(): ArchiveAdapter {
  const files: Array<{ path: string; data: string | Uint8Array; options: Record<string, unknown> }> = [];
  return {
    file: (path, data, options) => { files.push({ path, data, options: { ...options } }); },
    generateAsync: async () => {
      const writer = new ZipWriter(new Uint8ArrayWriter(), { bufferedWrite: true });
      for (const file of files) {
        const reader = new Uint8ArrayReader(
          typeof file.data === "string" ? textEncoder.encode(file.data) : file.data.slice(),
        );
        await writer.add(file.path, reader, {
          level: file.options.compression === "STORE" ? 0 : 9,
          lastModDate: file.options.date instanceof Date ? file.options.date : fixedDate,
          externalFileAttributes: 0o100644 << 16,
          dataDescriptor: false,
        });
      }
      const bytes = await writer.close();
      return new Blob([bytes.slice()], { type: "application/zip" });
    },
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
    oneShot: `${root}/one-shot/00-one-shot.md`,
    decompose: `${root}/manual-prompts/01-decompose.md`,
    rewrite: `${root}/manual-prompts/02-rewrite.md`,
    verify: `${root}/manual-prompts/03-verify.md`,
    final: `${root}/manual-prompts/04-final.md`,
    oneShotMarkdown: `${root}/one-shot/one-shot-prompt.md`,
    oneShotHtml: `${root}/one-shot/one-shot-prompt.html`,
    manualMarkdown: `${root}/manual-prompts/manual-prompts.md`,
    manualHtml: `${root}/manual-prompts/manual-prompts.html`,
    combinedMarkdown: `${root}/combined-prompts/combined-prompts.md`,
    combinedHtml: `${root}/combined-prompts/combined-prompts.html`,
    combinedFullHtml: `${root}/combined-prompts/combined-prompts-full.html`,
    assetIndex: `${root}/assets/index.md`,
    placementMap: `${root}/assets/placement-map.json`,
    ocrCandidates: `${root}/ocr/candidates.json`,
    projectIndexMarkdown: `${root}/project/index.md`,
    projectIndexJson: `${root}/project/index.json`,
    projectFilesRoot: `${root}/project/files`,
  };
}

function extensionForAsset(asset: VisualAsset): string {
  const byMime: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "application/pdf": "pdf",
    "application/postscript": "eps",
    "image/tiff": "tiff",
  };
  return byMime[asset.mimeType] ?? "bin";
}

function assetPathFor(key: string, asset: VisualAsset): string {
  const safeId = normalizeDocumentBase(asset.id);
  return `documents/${key}/assets/${safeId}.${extensionForAsset(asset)}`;
}

function projectFilePathFor(key: string, entryPath: string): string {
  return `documents/${key}/${joinProjectArchivePath("project/files", entryPath)}`;
}

function manifestFor(prepared: readonly PreparedDocument[]): PromptPackageManifest {
  const documents: ManifestDocumentRecord[] = prepared.map((document, exportOrdinal) => {
    const paths = pathsFor(document.key, document.input.documentFormat);
    const project = document.input.project;
    const source: ManifestDocumentRecord["source"] = project
      ? {
          kind: "project",
          intakeKind: project.sourceKind,
          rootName: project.intake.displayName,
          classification: project.classification,
          rootDocument: project.rootDocument,
          originalTreeHash: project.originalTreeHash,
          reviewedTreeHash: project.reviewedTreeHash,
          reviewRevision: project.projectReviewRevision,
          totalByteCount: project.totalByteCount,
          codeRewriteOptions: { ...document.input.codeRewriteOptions! },
          ...(project.originalContainer ? { originalContainer: { ...project.originalContainer } } : {}),
          index: {
            markdown: { path: paths.projectIndexMarkdown, sha256: "" },
            json: { path: paths.projectIndexJson, sha256: "" },
          },
          entries: project.entries.map((entry) => ({
            path: entry.path,
            originalByteCount: entry.byteCount,
            originalSha256: entry.originalHash,
            reviewedSha256: entry.reviewedTextHash,
            reviewRevision: entry.reviewRevision,
            contentKind: entry.contentKind,
            languageId: entry.languageId,
            promptIncluded: entry.promptIncluded,
            packageIncluded: entry.packageIncluded,
            exclusionReason: entry.exclusionReason,
            ...(entry.packageIncluded ? { packaged: {
              path: projectFilePathFor(document.key, entry.path),
              sha256: entry.contentKind === "text" ? entry.reviewedTextHash! : entry.originalHash,
            } } : {}),
          })),
          sensitiveBlockedCounts: { ...document.input.sensitiveBlockedCounts! },
        }
      : {
          kind: "file",
          original: { path: paths.original, byteCount: document.originalBytes.byteLength, sha256: document.originalHash },
        };
    const promptHashes: ManifestDocumentRecord["prompts"] = {
      oneShot: { path: paths.oneShot, sha256: "" },
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
      source,
      ...(!project ? { original: { path: paths.original, byteCount: document.originalBytes.byteLength, sha256: document.originalHash } } : {}),
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
      processing: {
        pageCount: document.input.pageCount,
        options: cloneExtractionOptions(document.input.extractionOptions),
      },
      visualAssets: {
        index: { path: paths.assetIndex, sha256: "" },
        placementMap: { path: paths.placementMap, sha256: "" },
        records: [],
      },
      ocr: { path: paths.ocrCandidates, sha256: "", records: [] },
      ...(document.input.latexProject ? { latexProject: {
        ...JSON.parse(JSON.stringify(document.input.latexProject)) as LatexProjectMetadata,
        projectRoot: `documents/${document.key}/project`,
      } } : {}),
      workbooks: {
        oneShot: {
          markdown: { path: paths.oneShotMarkdown, sha256: "" },
          html: { path: paths.oneShotHtml, sha256: "" },
        },
        manual: {
          markdown: { path: paths.manualMarkdown, sha256: "" },
          html: { path: paths.manualHtml, sha256: "" },
        },
        combined: {
          markdown: { path: paths.combinedMarkdown, sha256: "" },
          html: { path: paths.combinedHtml, sha256: "" },
          fullHtml: { status: "generated", path: paths.combinedFullHtml, sha256: "" },
        },
      },
    };
  });
  return {
    schemaVersion: 6,
    package: { name: "reword-nerd", version: APP_VERSION, format: "dual-mode-prompt-package" },
    archive: {
      entryOrder: "lexicographic-code-unit-ascending",
      timestamp: fixedTimestamp,
      originalCompression: "STORE",
      generatedCompression: "DEFLATE-9",
    },
    workflow: {
      modes: ["one-shot", "manual"],
      manualStages: ["decompose", "rewrite", "verify", "final"],
      responseMarkers: { stage1: responseMarkers.decompose, stage2: responseMarkers.rewrite, stage3: responseMarkers.verify },
    },
    rootArtifacts: {
      readme: { path: "README.md", sha256: "" },
      openMe: { path: "OPEN-ME.html", sha256: "" },
    },
    documents,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function markdownCodeSpan(value: string): string {
  const delimiter = "`".repeat(Math.max(1, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length + 1)));
  const padding = /^`|`$/u.test(value) ? " " : "";
  return `${delimiter}${padding}${value}${padding}${delimiter}`;
}

function createOpenMe(manifest: PromptPackageManifest): string {
  const documents = manifest.documents.map((document) => `<article class="root-card">
    <h2>${escapeHtml(document.originalDisplayName)}</h2>
    <p><code>${escapeHtml(document.key)}</code></p>
    <ul>
      <li><a href="${escapeHtml(document.workbooks.combined.html.path)}">Open combined One-shot + Manual workbook</a></li>
      <li><a href="${escapeHtml(document.workbooks.oneShot.html.path)}">Open One-shot workbook</a></li>
      <li><a href="${escapeHtml(document.workbooks.manual.html.path)}">Open Manual workbook</a></li>
    </ul>
  </article>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <title>Open reword-nerd workbooks</title>
  <style>${TEXT_HTML_THEME_CSS}.root-card ul{display:grid;gap:10px;padding-left:22px}.root-card code{color:var(--muted)}</style>
</head>
<body><main><header class="package-header"><p class="eyebrow">REWORD NERD / TEXT</p><h1>reword-nerd workbooks</h1><p class="intro">Choose a document and workflow. Everything remains inside its document folder.</p></header>${documents}</main></body>
</html>
`;
}

function projectIndexes(record: ManifestDocumentRecord): { markdown: string; json: string } {
  if (record.source.kind !== "project") throw new Error("Project index requires project provenance.");
  const source = record.source;
  const markdown = [
    "# Reviewed project index",
    "",
    "This sanitized tree is AI context for a changed-files rewriting workflow. It is not a source-control backup, does not include dropped sensitive files, and was not built or tested by reword-nerd.",
    "",
    `- Intake: ${source.intakeKind}`,
    `- Root name: ${escapeMarkdownText(source.rootName)}`,
    `- Classification: ${source.classification}`,
    `- Root document: ${source.rootDocument ? escapeMarkdownText(source.rootDocument) : "not applicable"}`,
    `- Original tree SHA-256: ${source.originalTreeHash}`,
    `- Reviewed tree SHA-256: ${source.reviewedTreeHash}`,
    `- Review revision: ${source.reviewRevision}`,
    `- Sensitive files dropped before retention: ${Object.values(source.sensitiveBlockedCounts).reduce((total, count) => total + count, 0)}`,
    "",
    "## Retained entries",
    "",
    ...source.entries.map((entry) => `- ${markdownCodeSpan(entry.path)} — ${entry.contentKind}; prompt ${entry.promptIncluded ? "included" : "excluded"}; package ${entry.packageIncluded ? "included" : "excluded"}; original ${entry.originalSha256}; reviewed ${entry.reviewedSha256 ?? "not applicable"}.`),
    "",
    "Apply only changed text-file blocks returned by the model, inspect every diff, and run the project's normal tests/build afterward.",
    "",
  ].join("\n");
  const json = `${JSON.stringify({
    schemaVersion: 1,
    kind: "reviewed-project-index",
    intakeKind: source.intakeKind,
    rootName: source.rootName,
    classification: source.classification,
    rootDocument: source.rootDocument,
    originalTreeHash: source.originalTreeHash,
    reviewedTreeHash: source.reviewedTreeHash,
    reviewRevision: source.reviewRevision,
    totalByteCount: source.totalByteCount,
    codeRewriteOptions: source.codeRewriteOptions,
    sensitiveBlockedCounts: source.sensitiveBlockedCounts,
    entries: source.entries,
  }, null, 2)}\n`;
  return { markdown, json };
}

export async function buildPromptPackage(
  inputs: readonly ExportSourceInput[],
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
      if (input.kind === "project") {
        prepared.push({ input, originalBytes: new Uint8Array(), originalHash: "", reviewedHash: "", key: "" });
        continue;
      }
      if (!input.original) throw new Error("File source is missing original bytes.");
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
      if (input.kind === "project") {
        if (!await revalidateProjectSnapshot(input, dependencies.hasher)) return failure("INVALID_INPUT");
        const project = input.project!;
        document.originalHash = project.originalTreeHash;
        document.reviewedHash = await hashBytes(textEncoder.encode(input.reviewedExtractedText).buffer, dependencies.hasher);
        document.key = `${normalizeDocumentBase(filenameBase(input.documentName))}--${project.originalTreeHash.slice(0, 12)}`;
        continue;
      }
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
  const artifactAssets: Array<Array<{ asset: VisualAsset; path: string }>> = [];
  try {
    for (const [index, document] of prepared.entries()) {
      const paths = pathsFor(document.key, document.input.documentFormat);
      const record = manifest.documents[index];
      record.prompts.oneShot = {
        path: paths.oneShot,
        sha256: await hashBytes(textEncoder.encode(document.input.promptBundle.oneShot).buffer, dependencies.hasher),
      };
      for (const stage of stages) record.prompts[stage] = {
        path: paths[stage],
        sha256: await hashBytes(textEncoder.encode(document.input.promptBundle.manual[stage]).buffer, dependencies.hasher),
      };
      const includedAssets = document.input.visualAssets.filter((asset) => asset.included);
      const seenAssetIds = new Set<string>();
      const packagedAssets: Array<{ asset: VisualAsset; path: string }> = [];
      for (const asset of document.input.visualAssets) {
        if (seenAssetIds.has(asset.id)) throw new Error("Duplicate asset ID.");
        seenAssetIds.add(asset.id);
        if (!asset.included) {
          record.visualAssets.records.push({
            id: asset.id,
            byteCount: asset.byteCount,
            mimeType: asset.mimeType,
            kind: asset.kind,
            filename: asset.filename,
            order: asset.order,
            ...(asset.pageNumber ? { pageNumber: asset.pageNumber } : {}),
            ...(asset.sourcePath ? { sourcePath: asset.sourcePath } : {}),
            ...(asset.bounds ? { bounds: { ...asset.bounds } } : {}),
            ...(asset.width ? { width: asset.width } : {}),
            ...(asset.height ? { height: asset.height } : {}),
            ...(asset.caption ? { caption: asset.caption } : {}),
            ...(asset.altText ? { altText: asset.altText } : {}),
            included: false,
            decorative: asset.decorative,
            warnings: [...asset.warnings],
          });
          continue;
        }
        const path = assetPathFor(document.key, asset);
        const sha256 = await hashBytes(
          asset.bytes.buffer.slice(asset.bytes.byteOffset, asset.bytes.byteOffset + asset.bytes.byteLength),
          dependencies.hasher,
        );
        record.visualAssets.records.push({
          id: asset.id,
          path,
          sha256,
          byteCount: asset.byteCount,
          mimeType: asset.mimeType,
          kind: asset.kind,
          filename: asset.filename,
          order: asset.order,
          ...(asset.pageNumber ? { pageNumber: asset.pageNumber } : {}),
          ...(asset.sourcePath ? { sourcePath: asset.sourcePath } : {}),
          ...(asset.bounds ? { bounds: { ...asset.bounds } } : {}),
          ...(asset.width ? { width: asset.width } : {}),
          ...(asset.height ? { height: asset.height } : {}),
          ...(asset.caption ? { caption: asset.caption } : {}),
          ...(asset.altText ? { altText: asset.altText } : {}),
          included: true,
          decorative: asset.decorative,
          warnings: [...asset.warnings],
        });
        packagedAssets.push({ asset, path });
        entries.push({ path, data: asset.bytes, stored: true });
      }
      artifactAssets[index] = packagedAssets;
      const assetIndex = [
        "# Visual assets",
        "",
        "Attach these files manually when the selected model interface supports image input. Preserve each stable ID and place the asset near the relevant rewritten discussion.",
        "",
        ...(includedAssets.length === 0
          ? ["No extracted visual assets are included."]
          : record.visualAssets.records.filter((asset) => asset.included).map((asset) => `- **${escapeMarkdownText(asset.id)}** — ${escapeMarkdownText(asset.path ?? "unavailable")}; ${asset.sourcePath ? `source ${escapeMarkdownText(asset.sourcePath)}` : asset.pageNumber ? `page ${asset.pageNumber}` : "document"}; caption: ${escapeMarkdownText(asset.caption ?? "not supplied")}; alt text: ${escapeMarkdownText(asset.altText ?? "not supplied")}`)),
        "",
      ].join("\n");
      const placementMap = `${JSON.stringify(record.visualAssets.records.map((asset) => ({
        id: asset.id,
        path: asset.path,
        pageNumber: asset.pageNumber ?? null,
        sourcePath: asset.sourcePath ?? null,
        bounds: asset.bounds ?? null,
        caption: asset.caption ?? null,
        altText: asset.altText ?? null,
      })), null, 2)}\n`;
      record.visualAssets.index.sha256 = await hashBytes(textEncoder.encode(assetIndex).buffer, dependencies.hasher);
      record.visualAssets.placementMap.sha256 = await hashBytes(textEncoder.encode(placementMap).buffer, dependencies.hasher);

      for (const candidate of document.input.ocrCandidates) {
        record.ocr.records.push({
          id: candidate.id,
          source: { ...candidate.source },
          confidence: candidate.confidence,
          status: candidate.status,
          engine: candidate.engine,
          engineVersion: candidate.engineVersion,
          languageCode: candidate.languageCode,
          languageHash: candidate.languageHash,
          rawTextSha256: await hashBytes(textEncoder.encode(candidate.text).buffer, dependencies.hasher),
          reviewedTextSha256: await hashBytes(textEncoder.encode(candidate.reviewedText).buffer, dependencies.hasher),
        });
      }
      const ocrText = `${JSON.stringify({
        records: document.input.ocrCandidates.map((candidate) => ({ ...candidate, source: { ...candidate.source } })),
      }, null, 2)}\n`;
      record.ocr.sha256 = await hashBytes(textEncoder.encode(ocrText).buffer, dependencies.hasher);
      entries.push(
        { path: paths.reviewedExtraction, data: document.input.reviewedExtractedText, stored: false },
        { path: paths.oneShot, data: document.input.promptBundle.oneShot, stored: false },
        ...stages.map((stage) => ({ path: paths[stage], data: document.input.promptBundle.manual[stage], stored: false })),
        { path: paths.assetIndex, data: assetIndex, stored: false },
        { path: paths.placementMap, data: placementMap, stored: false },
        { path: paths.ocrCandidates, data: ocrText, stored: false },
      );
      if (document.input.kind === "project") {
        const project = document.input.project!;
        if (record.source.kind !== "project") throw new Error("Project manifest provenance is missing.");
        const indexes = projectIndexes(record);
        record.source.index.markdown.sha256 = await hashBytes(textEncoder.encode(indexes.markdown).buffer, dependencies.hasher);
        record.source.index.json.sha256 = await hashBytes(textEncoder.encode(indexes.json).buffer, dependencies.hasher);
        entries.push(
          { path: record.source.index.markdown.path, data: indexes.markdown, stored: false },
          { path: record.source.index.json.path, data: indexes.json, stored: false },
        );
        for (const entry of project.entries) {
          if (!entry.packageIncluded) continue;
          const path = projectFilePathFor(document.key, entry.path);
          const data = entry.contentKind === "text" ? entry.reviewedText! : entry.originalBytes;
          const expectedHash = entry.contentKind === "text" ? entry.reviewedTextHash : entry.originalHash;
          const digest = await hashBytes(typeof data === "string" ? textEncoder.encode(data).buffer : arrayBufferFor(data), dependencies.hasher);
          if (digest !== expectedHash) throw new Error("Reviewed project entry changed during export.");
          entries.push({ path, data, stored: typeof data !== "string" });
        }
      } else {
        entries.push({ path: paths.original, data: document.originalBytes, stored: true });
      }
      if (document.input.kind === "document" && document.input.documentFormat === "latex-project") {
        const projectFiles = await readSafeLatexProjectFiles(document.originalBytes);
        const declared = new Map((document.input.latexProject?.files ?? []).map((file) => [file.path, file.sha256]));
        for (const projectFile of projectFiles) {
          const digest = await hashBytes(
            projectFile.bytes.buffer.slice(projectFile.bytes.byteOffset, projectFile.bytes.byteOffset + projectFile.bytes.byteLength),
            dependencies.hasher,
          );
          if (declared.get(projectFile.path) !== digest) throw new Error("LaTeX project changed after review.");
          entries.push({ path: `documents/${document.key}/project/${projectFile.path}`, data: projectFile.bytes, stored: true });
        }
      }
    }
  } catch {
    return failure("HASH_UNAVAILABLE");
  }
  const generatedMediaBytes = manifest.documents.reduce(
    (total, document) => total + document.visualAssets.records.reduce((subtotal, asset) => subtotal + asset.byteCount, 0),
    0,
  );
  if (generatedMediaBytes > MAX_GENERATED_MEDIA_BYTES_PER_PACKAGE) return failure("INVALID_INPUT");

  let runbookDocument = createRunbookDocument(manifest);
  let runbook = serializeRunbookMarkdown(runbookDocument);
  let workbooks = prepared.map((document, index) => createDocumentWorkbook(
    manifest,
    index,
    runbookDocument,
    document.input.promptBundle,
    artifactAssets[index],
  ));
  for (let iteration = 0; iteration <= prepared.length; iteration += 1) {
    let statusChanged = false;
    for (const [index, workbook] of workbooks.entries()) {
      const status = manifest.documents[index].workbooks.combined.fullHtml;
      if (status.status === "generated" && !workbook.combined.fullHtml) {
        manifest.documents[index].workbooks.combined.fullHtml = { status: "not-generated", reason: "encoded-size-limit" };
        statusChanged = true;
      }
    }
    if (!statusChanged) break;
    runbookDocument = createRunbookDocument(manifest);
    runbook = serializeRunbookMarkdown(runbookDocument);
    workbooks = prepared.map((document, index) => createDocumentWorkbook(
      manifest,
      index,
      runbookDocument,
      document.input.promptBundle,
      artifactAssets[index],
    ));
  }
  const openMe = createOpenMe(manifest);
  try {
    for (const [index, document] of prepared.entries()) {
      const paths = pathsFor(document.key, document.input.documentFormat);
      const record = manifest.documents[index];
      const workbook = workbooks[index];
      record.workbooks.oneShot.markdown.sha256 = await hashBytes(textEncoder.encode(workbook.oneShot.markdown).buffer, dependencies.hasher);
      record.workbooks.oneShot.html.sha256 = await hashBytes(textEncoder.encode(workbook.oneShot.html).buffer, dependencies.hasher);
      record.workbooks.manual.markdown.sha256 = await hashBytes(textEncoder.encode(workbook.manual.markdown).buffer, dependencies.hasher);
      record.workbooks.manual.html.sha256 = await hashBytes(textEncoder.encode(workbook.manual.html).buffer, dependencies.hasher);
      record.workbooks.combined.markdown.sha256 = await hashBytes(textEncoder.encode(workbook.combined.markdown).buffer, dependencies.hasher);
      record.workbooks.combined.html.sha256 = await hashBytes(textEncoder.encode(workbook.combined.html).buffer, dependencies.hasher);
      if (workbook.combined.fullHtml && record.workbooks.combined.fullHtml.status === "generated") {
        record.workbooks.combined.fullHtml.sha256 = await hashBytes(textEncoder.encode(workbook.combined.fullHtml).buffer, dependencies.hasher);
      } else if (!workbook.combined.fullHtml) {
        record.workbooks.combined.fullHtml = { status: "not-generated", reason: "encoded-size-limit" };
      }
      entries.push(
        { path: paths.oneShotMarkdown, data: workbook.oneShot.markdown, stored: false },
        { path: paths.oneShotHtml, data: workbook.oneShot.html, stored: false },
        { path: paths.manualMarkdown, data: workbook.manual.markdown, stored: false },
        { path: paths.manualHtml, data: workbook.manual.html, stored: false },
        { path: paths.combinedMarkdown, data: workbook.combined.markdown, stored: false },
        { path: paths.combinedHtml, data: workbook.combined.html, stored: false },
        ...(workbook.combined.fullHtml ? [{ path: paths.combinedFullHtml, data: workbook.combined.fullHtml, stored: false }] : []),
      );
    }
  } catch {
    return failure("HASH_UNAVAILABLE");
  }
  try {
    manifest.rootArtifacts.readme.sha256 = await hashBytes(textEncoder.encode(runbook).buffer, dependencies.hasher);
    manifest.rootArtifacts.openMe.sha256 = await hashBytes(textEncoder.encode(openMe).buffer, dependencies.hasher);
  } catch {
    return failure("HASH_UNAVAILABLE");
  }
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  entries.push(
    { path: "manifest.json", data: manifestText, stored: false },
    { path: manifest.rootArtifacts.readme.path, data: runbook, stored: false },
    { path: manifest.rootArtifacts.openMe.path, data: openMe, stored: false },
  );
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
        compression: entry.stored ? "STORE" : "DEFLATE",
        compressionOptions: entry.stored ? undefined : { level: 9 },
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
    const frozenWorkbooks = Object.freeze(workbooks);
    return { ok: true, blob, filename: packageFilename, manifest, workbooks: frozenWorkbooks, artifacts: frozenWorkbooks };
  } catch {
    return failure("ARCHIVE_GENERATION_FAILED");
  }
}
