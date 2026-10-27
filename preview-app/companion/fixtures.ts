import { createHash } from "node:crypto";
import { assessContext } from "../src/domain/context";
import { DEFAULT_EXTRACTION_OPTIONS } from "../src/domain/media";
import { CURATED_MODEL_PROFILES, type ModelProfile } from "../src/domain/profiles";
import { DEFAULT_SETTINGS, type RewriteSettings } from "../src/domain/settings";
import type { ExportDocumentInput } from "../src/export/contracts";
import { buildPromptPackage } from "../src/export/package";
import { renderPromptBundle } from "../src/prompting/renderPromptSet";

export const FIXTURE_SOURCE = "# A small shared garden\n\nOur neighborhood garden opens on Saturday at 10 a.m. Bring water and a pair of gloves. Volunteers will plant herbs in three raised beds. Everyone is welcome, including people who have never gardened before.\n";

export function createFixtureInput(options: {
  text?: string; originalText?: string; name?: string; format?: "text" | "markdown";
  settings?: RewriteSettings; profile?: ModelProfile; withContext?: boolean;
} = {}): ExportDocumentInput {
  const text = options.text ?? FIXTURE_SOURCE;
  const original = new TextEncoder().encode(options.originalText ?? text);
  const name = options.name ?? "Garden.md";
  const format = options.format ?? "markdown";
  const settings = options.settings ?? { ...DEFAULT_SETTINGS, tone: "plain" };
  const profile = options.profile ?? CURATED_MODEL_PROFILES.find((candidate) => candidate.id === "openai-general")!;
  return {
    kind: "document", documentId: "tiny-reviewed-fixture", documentName: name, documentFormat: format,
    original: { name, size: original.length, type: "text/markdown", arrayBuffer: async () => original.slice().buffer } as File,
    reviewedExtractedText: text, resolvedSettings: settings, chosenProfile: profile,
    promptBundle: renderPromptBundle(text, settings, profile, options.withContext === false ? undefined : { format, assets: [] }),
    warnings: [], contextAssessment: assessContext(text, profile.contextWindowTokens),
    reviewed: true, contextWarningAcknowledged: true, uploadOrdinal: 0,
    pageCount: null, extractionOptions: { ...DEFAULT_EXTRACTION_OPTIONS }, visualAssets: [], ocrCandidates: [],
  };
}

/** Actual production exporter bytes, never a manually invented archive fixture. */
export async function createFixturePackage(options: Parameters<typeof createFixtureInput>[0] = {}): Promise<Uint8Array> {
  const result = await buildPromptPackage([createFixtureInput(options)], {
    hasher: { digest: async (buffer) => {
      const digest = createHash("sha256").update(new Uint8Array(buffer)).digest();
      return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength) as ArrayBuffer;
    } },
  });
  if (!result.ok) throw new Error(`Fixture export failed: ${result.error.code}`);
  return new Uint8Array(await result.blob.arrayBuffer());
}
