import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStudio } from "../../src/app/studio/useStudio";
import * as domain from "../../src/domain";
import * as packageExport from "../../src/export";
import * as prompting from "../../src/prompting";

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

describe("Studio editing resilience", () => {
  it("keeps transiently invalid form values intact and blocks export without losing source", async () => {
    const build = vi.spyOn(packageExport, "buildPromptPackage");
    const { result } = renderHook(() => useStudio());
    const document = result.current.selectedDocument;
    const requirements = "  Keep this exact phrase. \n";
    act(() =>
      result.current.updateSettings({
        outputLanguage: "   ",
        customRequirements: requirements,
      }),
    );
    expect(result.current.settings.outputLanguage).toBe("   ");
    expect(result.current.settings.customRequirements).toBe(requirements);
    expect(result.current.promptBundle).toBeNull();
    expect(result.current.exportBlocker).toBe("Choose an output language.");
    expect(result.current.selectedDocument).toBe(document);
    await act(async () => result.current.buildPackage());
    expect(build).not.toHaveBeenCalled();
    expect(result.current.error).toBe("Choose an output language.");
    expect(result.current.building).toBe(false);

    act(() => result.current.updateSettings({ outputLanguage: " English " }));
    expect(result.current.settings.outputLanguage).toBe(" English ");
    expect(result.current.settings.customRequirements).toBe(requirements);
    expect(result.current.promptBundle?.oneShot).toContain(
      "Keep this exact phrase.",
    );
    expect(result.current.exportBlocker).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("recovers from excessive custom requirements and from a renderer failure", () => {
    const { result } = renderHook(() => useStudio());
    const excessive = "🪴".repeat(2_001);
    act(() => result.current.updateSettings({ customRequirements: excessive }));
    expect(result.current.settings.customRequirements).toBe(excessive);
    expect(result.current.promptBundle).toBeNull();
    expect(result.current.exportBlocker).toMatch(
      /2000 Unicode characters or fewer/,
    );

    const render = vi
      .spyOn(prompting, "renderPromptBundle")
      .mockImplementationOnce(() => {
        throw new Error("Unexpected preview rendering failure");
      });
    act(() =>
      result.current.updateSettings({ customRequirements: "Valid again" }),
    );
    expect(result.current.promptBundle).toBeNull();
    expect(result.current.documents).toHaveLength(1);
    render.mockRestore();
    act(() =>
      result.current.updateSettings({ customRequirements: "Valid again " }),
    );
    expect(result.current.promptBundle).not.toBeNull();
    expect(result.current.settings.customRequirements).toBe("Valid again ");
  });
});

describe("Studio removal recovery", () => {
  it("restores the latest removed document at its original position with original bytes and review state", () => {
    const { result } = renderHook(() => useStudio());
    act(() => {
      result.current.addTextDocument("Original middle document", "middle.txt");
      result.current.addTextDocument("Last document", "last.txt");
    });
    const middleId = result.current.documents[1].id;
    act(() => result.current.selectDocument(middleId));
    act(() => result.current.updateText("Edited middle document"));
    const removed = result.current.selectedDocument!;
    const originalOrder = result.current.documents.map(
      (document) => document.id,
    );
    act(() => result.current.removeDocument(middleId));
    expect(result.current.canUndoRemove).toBe(true);
    expect(result.current.lastRemovedDocument).toBe(removed);
    expect(result.current.documents).toHaveLength(2);
    act(() => {
      expect(result.current.restoreRemovedDocument()).toBe(true);
    });
    expect(result.current.documents.map((document) => document.id)).toEqual(
      originalOrder,
    );
    expect(result.current.selectedDocument).toBe(removed);
    expect(result.current.selectedDocument?.original).toBe(removed.original);
    expect(result.current.selectedDocument?.originalText).toBe(
      "Original middle document",
    );
    expect(result.current.selectedDocument?.text).toBe(
      "Edited middle document",
    );
    expect(result.current.selectedDocument?.status).toBe("review");
    expect(result.current.canUndoRemove).toBe(false);
    expect(result.current.lastRemovedDocument).toBeNull();
    act(() => {
      expect(result.current.restoreRemovedDocument()).toBe(false);
    });
    expect(result.current.documents).toHaveLength(3);
  });

  it("keeps one undo slot and respects capacity when restoring", () => {
    const { result } = renderHook(() => useStudio());
    const seed = result.current.selectedDocument!;
    act(() => result.current.removeDocument(seed.id));
    act(() => {
      for (let index = 0; index < 20; index += 1) {
        result.current.addTextDocument(
          `Source ${index}`,
          `source-${index}.txt`,
        );
      }
    });
    act(() => {
      expect(result.current.restoreRemovedDocument()).toBe(false);
    });
    expect(result.current.documents).toHaveLength(20);
    expect(result.current.lastRemovedDocument).toBe(seed);
    expect(result.current.error).toMatch(
      /Unable to undo removal.*20 documents/,
    );

    const latest = result.current.selectedDocument!;
    act(() => result.current.removeDocument(latest.id));
    expect(result.current.lastRemovedDocument).toBe(latest);
    act(() => {
      expect(result.current.restoreRemovedDocument()).toBe(true);
    });
    expect(result.current.documents).toHaveLength(20);
    expect(
      result.current.documents.some((document) => document.id === seed.id),
    ).toBe(false);
  });

  it("never overwrites a reloaded example with an older removed revision", () => {
    const { result } = renderHook(() => useStudio());
    const seedId = result.current.selectedId!;
    act(() => result.current.updateText("An older edited sample"));
    act(() => result.current.removeDocument(seedId));
    act(() => result.current.loadExample("garden"));
    const fresh = result.current.selectedDocument;
    act(() => {
      expect(result.current.restoreRemovedDocument()).toBe(false);
    });
    expect(result.current.documents).toHaveLength(1);
    expect(result.current.selectedDocument).toBe(fresh);
    expect(result.current.selectedDocument?.text).not.toBe(
      "An older edited sample",
    );
    expect(result.current.canUndoRemove).toBe(false);
  });

  it("clears an old model context acknowledgement when the profile changes during removal", () => {
    const { result } = renderHook(() => useStudio());
    act(() => result.current.acknowledgeContextWarning());
    const removedId = result.current.selectedId!;
    act(() => result.current.removeDocument(removedId));
    expect(result.current.lastRemovedDocument?.contextWarningAcknowledged).toBe(
      true,
    );
    act(() => result.current.selectProfile("zai-glm"));
    act(() => {
      expect(result.current.restoreRemovedDocument()).toBe(true);
    });
    expect(result.current.selectedDocument?.contextWarningAcknowledged).toBe(
      false,
    );
  });

  it("aborts a removed loading document and ignores its later extraction completion", async () => {
    let finish!: (extraction: domain.ExtractionResult) => void;
    let signal: AbortSignal | undefined;
    vi.spyOn(domain, "extractFile").mockImplementationOnce(
      (_accepted, dependencies) => {
        signal = dependencies?.signal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    );
    const { result } = renderHook(() => useStudio());
    let importing!: Promise<void>;
    act(() => {
      importing = result.current.importFiles([
        sourceFile("pending.txt", "Still reading"),
      ]);
    });
    await waitFor(() =>
      expect(result.current.selectedDocument?.status).toBe("loading"),
    );
    const pendingId = result.current.selectedId!;
    act(() => result.current.removeDocument(pendingId));
    expect(signal?.aborted).toBe(true);
    expect(result.current.canUndoRemove).toBe(false);
    await act(async () => {
      finish({
        format: "text",
        extractedText: "Late extraction",
        warnings: [],
        originalHash: "original",
        extractedTextHash: "extracted",
        requiresReview: true,
      });
      await importing;
    });
    expect(
      result.current.documents.some((document) => document.id === pendingId),
    ).toBe(false);
    expect(result.current.documents).toHaveLength(1);
    expect(result.current.error).toBeNull();
    expect(result.current.canUndoRemove).toBe(false);
  });
});

describe("Studio package snapshot retention", () => {
  it("retains the last successful package through invalidation and failed replacements", async () => {
    const { result } = renderHook(() => useStudio());
    expect(result.current.retainedPackage).toBeNull();
    expect(result.current.packageGeneration).toBe(0);
    act(() => result.current.removeDocument(result.current.selectedId!));
    await act(async () =>
      result.current.importFiles([
        sourceFile("working.txt", "First source version."),
      ]),
    );
    act(() => result.current.confirmReview());
    await act(async () => result.current.buildPackage());
    const first = result.current.builtPackage;
    expect(first).not.toBeNull();
    const firstSources = result.current.builtSourceByKey;
    expect(result.current.retainedPackage).toBe(first);
    expect(result.current.retainedSourceByKey).toBe(firstSources);
    expect(result.current.packageGeneration).toBe(1);

    act(() => {
      result.current.updateSettings({ ...result.current.settings });
      result.current.updateSettings({});
      result.current.selectProfile(result.current.profile.id);
    });
    expect(result.current.builtPackage).toBe(first);
    expect(result.current.builtSourceByKey).toBe(firstSources);
    expect(result.current.packageGeneration).toBe(1);

    act(() => result.current.updateSettings({ tone: "academic" }));
    expect(result.current.builtPackage).toBeNull();
    expect(result.current.builtSourceByKey).toEqual({});
    expect(result.current.retainedPackage).toBe(first);
    expect(result.current.retainedSourceByKey).toBe(firstSources);
    expect(result.current.packageGeneration).toBe(1);

    act(() => result.current.updateText("Second reviewed source version."));
    act(() => result.current.confirmReview());
    const build = vi
      .spyOn(packageExport, "buildPromptPackage")
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "ARCHIVE_GENERATION_FAILED",
          message: "A recoverable build failure.",
        },
      });
    await act(async () => result.current.buildPackage());
    expect(result.current.error).toBe("A recoverable build failure.");
    expect(result.current.builtPackage).toBeNull();
    expect(result.current.retainedPackage).toBe(first);
    expect(result.current.retainedSourceByKey).toBe(firstSources);
    expect(result.current.packageGeneration).toBe(1);
    build.mockRestore();

    const download = vi
      .spyOn(packageExport, "initiatePromptPackageDownload")
      .mockReturnValue({ ok: true });
    act(() => result.current.downloadPackage());
    expect(download).toHaveBeenCalledWith(first!.blob);
    await act(async () => result.current.buildPackage());
    expect(result.current.builtPackage).not.toBe(first);
    expect(result.current.retainedPackage).toBe(result.current.builtPackage);
    expect(result.current.retainedSourceByKey).toBe(
      result.current.builtSourceByKey,
    );
    expect(Object.values(result.current.retainedSourceByKey)[0].text).toBe(
      "Second reviewed source version.",
    );
    expect(result.current.packageGeneration).toBe(2);

    const latest = result.current.retainedPackage;
    act(() => result.current.removeDocument(result.current.selectedId!));
    expect(result.current.documents).toHaveLength(0);
    expect(result.current.builtPackage).toBeNull();
    expect(result.current.retainedPackage).toBe(latest);
    expect(result.current.packageGeneration).toBe(2);
  });
});
