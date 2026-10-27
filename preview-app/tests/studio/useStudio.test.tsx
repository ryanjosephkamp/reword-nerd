import { act, renderHook } from "@testing-library/react";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStudio } from "../../src/app/studio/useStudio";
import * as packageExport from "../../src/export";
import type { PromptPackageResult } from "../../src/export";

function sourceFile(name: string, text: string): File {
  const bytes = new TextEncoder().encode(text);
  return {
    name,
    size: bytes.byteLength,
    type: "text/plain",
    arrayBuffer: async () => bytes.slice().buffer,
  } as File;
}

afterEach(() => vi.restoreAllMocks());

describe("Studio source and package custody", () => {
  it("exports immutable imported bytes alongside edited, confirmed text and invalidates an outdated kit", async () => {
    const { result } = renderHook(() => useStudio());
    act(() => result.current.removeDocument(result.current.documents[0].id));
    const original = "Original finding: café volunteers planted 24 trees.\n";
    await act(async () =>
      result.current.importFiles([sourceFile("field-notes.txt", original)]),
    );
    expect(result.current.selectedDocument?.status).toBe("review");
    expect(result.current.exportBlocker).toMatch(/review and confirm/i);

    const edited =
      "Reviewed finding: café volunteers planted 24 trees in May.\n";
    act(() => result.current.updateText(edited));
    expect(result.current.selectedDocument?.originalText).toBe(original);
    act(() => result.current.confirmReview());
    await act(async () => result.current.buildPackage());
    expect(result.current.error).toBeNull();
    const built = result.current.builtPackage;
    expect(built).not.toBeNull();
    if (!built)
      throw new Error("The reviewed source should produce a package.");

    const archive = await JSZip.loadAsync(built.blob, { checkCRC32: true });
    const record = built.manifest.documents[0];
    expect(built.manifest.schemaVersion).toBe(6);
    expect(built.manifest.documents).toHaveLength(1);
    expect(await archive.file(record.original!.path)!.async("string")).toBe(
      original,
    );
    expect(
      await archive.file(record.reviewedExtraction.path)!.async("string"),
    ).toBe(edited);
    expect(
      await archive.file(record.prompts.oneShot.path)!.async("string"),
    ).toContain(edited);
    expect(
      await archive.file(record.prompts.rewrite.path)!.async("string"),
    ).toContain("<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>");

    act(() => result.current.updateSettings({ tone: "academic" }));
    expect(result.current.builtPackage).toBeNull();
    expect(result.current.exportBlocker).toBeNull();
    act(() => result.current.updateText(`${edited}Additional observation.\n`));
    expect(result.current.selectedDocument?.status).toBe("review");
    expect(result.current.exportBlocker).toMatch(/review and confirm/i);
  });

  it("keeps usable source documents after rejecting an unsupported import", async () => {
    const { result } = renderHook(() => useStudio());
    const before = result.current.selectedDocument;
    await act(async () =>
      result.current.importFiles([sourceFile("bad.exe", "not a document")]),
    );
    expect(result.current.error).toMatch(
      /choose a document or supported code/i,
    );
    expect(result.current.documents).toHaveLength(1);
    expect(result.current.selectedDocument).toEqual(before);
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it("requires a fresh context acknowledgement after the reviewed source changes", () => {
    const { result } = renderHook(() => useStudio());
    const profile = result.current.profiles.find(
      (candidate) => candidate.id === "zai-glm",
    )!;
    act(() => result.current.selectProfile(profile.id));
    act(() =>
      result.current.updateText(
        "word ".repeat(Math.ceil(profile.contextWindowTokens! / 5)),
      ),
    );
    act(() => result.current.confirmReview());
    expect(result.current.contextAssessment.acknowledgmentRequired).toBe(true);
    expect(result.current.exportBlocker).toMatch(/context warning/i);
    act(() => result.current.acknowledgeContextWarning());
    expect(result.current.exportBlocker).toBeNull();
    act(() =>
      result.current.updateText(
        `${result.current.selectedDocument!.text}One more fact.`,
      ),
    );
    act(() => result.current.confirmReview());
    expect(result.current.selectedDocument?.contextWarningAcknowledged).toBe(
      false,
    );
    expect(result.current.exportBlocker).toMatch(/context warning/i);
  });

  it("does not publish the result of a build after its source has changed", async () => {
    let finish!: (result: PromptPackageResult) => void;
    vi.spyOn(packageExport, "buildPromptPackage").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useStudio());
    let building!: Promise<void>;
    act(() => {
      building = result.current.buildPackage();
    });
    expect(result.current.building).toBe(true);
    act(() =>
      result.current.updateText("This source supersedes the in-flight build."),
    );
    await act(async () => {
      finish({
        ok: false,
        error: { code: "ARCHIVE_GENERATION_FAILED", message: "Stale failure" },
      });
      await building;
    });
    expect(result.current.error).toBeNull();
    expect(result.current.builtPackage).toBeNull();
    expect(result.current.building).toBe(false);
    expect(result.current.selectedDocument?.status).toBe("review");
  });
});
