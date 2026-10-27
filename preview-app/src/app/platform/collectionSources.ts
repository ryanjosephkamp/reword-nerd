import type { StudioDocument } from "../studio/useStudio";
import type { ModelProfile } from "../../domain/profiles";
import type { RewriteSettings } from "../../domain/settings";
import { DEFAULT_EXTRACTION_OPTIONS } from "../../domain/media";
import { assessContext } from "../../domain/context";
import type { WorkbenchState } from "../workbench/contracts";
import { selectContextAssessment, selectResolvedSettings, selectWorkingProfile } from "../workbench/selectors";
import { createProjectPromptSnapshot } from "../../domain/project";
import { renderPromptBundle, renderPromptSource } from "../../prompting";
import type { ExportSourceInput } from "../../export";
import { sourceContext } from "../../collections/prepare";
export interface StudioCollectionSources { documents: StudioDocument[]; settings: RewriteSettings; profile: ModelProfile }
export interface TextCandidate { id: string; path: string; input: ExportSourceInput | null; reason?: string }
export function studioCandidates(source: StudioCollectionSources | null): TextCandidate[] {
  if (!source) return [];
  return source.documents.map(d => {
    const input: ExportSourceInput = { kind: "document", documentId: d.id, documentName: d.name, documentFormat: d.format, original: d.original, reviewedExtractedText: d.text,
      resolvedSettings: source.settings, chosenProfile: source.profile, promptBundle: null as never,
      warnings: d.warnings, contextAssessment: assessContext(d.text, source.profile.contextWindowTokens), reviewed: d.status === "ready", contextWarningAcknowledged: d.contextWarningAcknowledged, uploadOrdinal: 0,
      pageCount: d.pageCount ?? null, extractionOptions: d.extraction?.extractionOptions ?? DEFAULT_EXTRACTION_OPTIONS,
      visualAssets: d.extraction?.visualAssets ?? [], ocrCandidates: d.extraction?.ocrCandidates ?? [] };
    input.promptBundle = renderPromptBundle(d.text, source.settings, source.profile, sourceContext(input));
    return { id: d.id, path: d.name, input, ...(d.status !== "ready" ? { reason: "Review this document in Text first." } : {}) };
  });
}
export function workbenchCandidates(state: WorkbenchState | null): TextCandidate[] {
  if (!state) return [];
  const profile = selectWorkingProfile(state);
  return state.items.map(d => {
    try {
      const settings = selectResolvedSettings(state, d.id);
      const common = { resolvedSettings: settings, chosenProfile: profile, warnings: [...d.warnings], reviewed: d.status === "ready" && !d.requiresReview, contextWarningAcknowledged: d.contextWarningAcknowledged, uploadOrdinal: 0, contextAssessment: selectContextAssessment(state, d.id) };
      let input: ExportSourceInput;
      if (d.kind === "project") {
        const s = createProjectPromptSnapshot(d, 0);
        const context = { kind: "project" as const, format: d.classification === "latex" ? "latex-project" as const : "text" as const, assets: [], reviewedTreeHash: s.reviewedTreeHash, includedFiles: s.includedFiles, excludedPaths: s.excludedPaths, codeRewriteOptions: state.globalCodeRewriteOptions, latexMainFile: d.rootDocument };
        const text = renderPromptSource(context);
        input = { ...common, kind: "project", projectId: d.id, projectName: d.name, project: d, reviewedExtractedText: text, codeRewriteOptions: state.globalCodeRewriteOptions, sensitiveBlockedCounts: { ...d.sensitiveBlockedCounts }, promptBundle: renderPromptBundle(text, settings, profile, context) };
      } else {
        input = { ...common, kind: "document", documentId: d.id, documentName: d.name, documentFormat: d.format, original: d.original, reviewedExtractedText: d.extractedText, promptBundle: null as never,
          pageCount: d.pageCount ?? null, extractionOptions: d.extractionOptions ?? state.globalExtractionOptions, visualAssets: d.visualAssets ?? [], ocrCandidates: d.ocrCandidates ?? [], ...(d.latexProject ? { latexProject: d.latexProject } : {}) };
        input.promptBundle = renderPromptBundle(input.reviewedExtractedText, settings, profile, sourceContext(input));
      }
      return { id: d.id, path: d.name, input, ...(!input.reviewed ? { reason: "Complete source review in Projects / Advanced first." } : {}) };
    } catch (e) { return { id: d.id, path: d.name, input: null, reason: (e as Error).message }; }
  });
}
