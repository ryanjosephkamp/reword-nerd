import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CURATED_MODEL_PROFILES } from "../../src/domain";
import { buildPromptPackage, type ExportDocumentInput } from "../../src/export";

const fixtureBytes = new TextEncoder().encode("Original Text fixture.\nLine two: café.\n");

function fixtureUpload(): File {
  return {
    name: "Text fixture.txt",
    size: fixtureBytes.byteLength,
    type: "text/plain",
    arrayBuffer: async () => fixtureBytes.slice().buffer,
  } as File;
}

function fixtureDocument(uploadOrdinal: number): ExportDocumentInput {
  return {
    documentId: `text-fixture-${uploadOrdinal}`,
    documentName: "Text fixture.txt",
    documentFormat: "text",
    original: fixtureUpload(),
    reviewedExtractedText: "Reviewed Text fixture.\nLine two: café.\n",
    resolvedSettings: {
      tone: "professional",
      formality: "standard",
      length: "preserve",
      outputLanguage: "English",
      customRequirements: "Keep the two-line structure.",
    },
    chosenProfile: CURATED_MODEL_PROFILES.find((profile) => profile.id === "openai-general")!,
    promptBundle: {
      oneShot: "ONE SHOT\nUse the reviewed Text fixture.",
      manual: {
        decompose: "DECOMPOSE\nText fixture",
        rewrite: "REWRITE\n<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>",
        verify: "VERIFY\n<<<INSERT_STAGE_2_REWRITE_RESPONSE>>>",
        final: "FINAL\n<<<INSERT_STAGE_3_VERIFICATION_RESPONSE>>>",
      },
    },
    warnings: ["Literal fixture warning."],
    contextAssessment: {
      estimateLabel: "Estimated tokens",
      sourceTokens: 12,
      oneShotWorkflowTokens: 36,
      manualWorkflowTokens: 72,
      oneShotRatio: 36 / 1_050_000,
      manualRatio: 72 / 1_050_000,
      oneShotOversized: false,
      manualOversized: false,
      oneShotWarning: false,
      workflowTokens: 72,
      contextWindowTokens: 1_050_000,
      ratio: 72 / 1_050_000,
      oversized: false,
      acknowledgmentRequired: false,
    },
    reviewed: true,
    contextWarningAcknowledged: false,
    uploadOrdinal,
  };
}

async function archiveBytes(input: readonly ExportDocumentInput[]): Promise<Uint8Array> {
  const result = await buildPromptPackage(input);
  if (!result.ok) throw new Error(`Text fixture must export: ${result.error.code}`);
  return new Uint8Array(await result.blob.arrayBuffer());
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("Text package checkpoint fixture", () => {
  it("locks the literal Text package bytes across repeated and reversed builds", async () => {
    // This catches an Image portal change that leaks timing, ordering, or metadata into the protected Text ZIP.
    const first = await archiveBytes([fixtureDocument(4), fixtureDocument(9)]);
    const repeated = await archiveBytes([fixtureDocument(4), fixtureDocument(9)]);
    const reversed = await archiveBytes([fixtureDocument(9), fixtureDocument(4)]);

    expect(first).toEqual(repeated);
    expect(first).toEqual(reversed);
    expect(first.byteLength).toBe(74_326);
    expect(sha256(first)).toBe("d4db79a7295737bbf265c19da03fbe4a4c2faa0198477fde285a99efe248ca22");
  });
});
