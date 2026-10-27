import type { LocalTextSource } from "./LocalTextRun";
import {
  assessContext,
  DEFAULT_EXTRACTION_OPTIONS,
  resolveSettings,
} from "../../domain";
import { buildPromptPackage } from "../../export";
import { renderPromptBundle } from "../../prompting";
export async function localTextPackage(source: LocalTextSource) {
  const d = source.document,
    settings = resolveSettings(source.settings),
    profile = source.profile;
  if (!["text", "markdown"].includes(d.format) || d.status !== "ready")
    throw Error("Select and review one TXT or Markdown document.");
  const result = await buildPromptPackage([
    {
      kind: "document",
      documentId: d.id,
      documentName: d.name,
      documentFormat: d.format,
      original: d.original,
      reviewedExtractedText: d.text,
      resolvedSettings: settings,
      chosenProfile: profile,
      promptBundle: renderPromptBundle(d.text, settings, profile, {
        format: d.format,
        assets: [],
      }),
      warnings: [...d.warnings],
      contextAssessment: assessContext(d.text, profile.contextWindowTokens),
      reviewed: true,
      contextWarningAcknowledged: d.contextWarningAcknowledged,
      uploadOrdinal: 0,
      pageCount: d.pageCount ?? null,
      extractionOptions:
        d.extraction?.extractionOptions ?? DEFAULT_EXTRACTION_OPTIONS,
      visualAssets: [],
      ocrCandidates: [],
    },
  ]);
  if (!result.ok) throw Error(result.error.message);
  return result.blob;
}
