import { createHash } from "node:crypto";
import { act, renderHook } from "@testing-library/react";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStudio } from "../../src/app/studio/useStudio";
import * as packageExport from "../../src/export";
import type { PromptPackageResult } from "../../src/export";

function file(name: string, text: string): File {
  const bytes = new TextEncoder().encode(text);
  return {
    name,
    type: "text/markdown",
    size: bytes.length,
    arrayBuffer: async () => bytes.slice().buffer,
  } as File;
}

async function importReviewed(
  sources: { name: string; original: string; reviewed?: string }[],
) {
  const hook = renderHook(() => useStudio());
  act(() =>
    hook.result.current.removeDocument(hook.result.current.documents[0].id),
  );
  await act(async () =>
    hook.result.current.importFiles(
      sources.map((source) => file(source.name, source.original)),
    ),
  );
  for (const [index, source] of sources.entries()) {
    act(() =>
      hook.result.current.selectDocument(
        hook.result.current.documents[index].id,
      ),
    );
    if (source.reviewed !== undefined)
      act(() => hook.result.current.updateText(source.reviewed!));
    act(() => hook.result.current.confirmReview());
  }
  return hook;
}

afterEach(() => vi.restoreAllMocks());

describe("Studio package source identity", () => {
  it("matches canonical workbook ordering to reviewed sources, then clears the index with invalidation", async () => {
    const sources = [
      { name: "zebra.md", original: "Zebra source: 73 volunteers." },
      { name: "apple.md", original: "Apple source: 29 volunteers." },
      { name: "middle.md", original: "Middle source: 41 volunteers." },
    ];
    const { result } = await importReviewed(sources);
    await act(async () => result.current.buildPackage());
    expect(result.current.error).toBeNull();
    const built = result.current.builtPackage!;
    expect(
      built.workbooks.map((workbook) => workbook.originalDisplayName),
    ).toEqual(["apple.md", "middle.md", "zebra.md"]);
    for (const workbook of built.workbooks) {
      expect(result.current.builtSourceByKey[workbook.documentKey]).toEqual({
        name: workbook.originalDisplayName,
        text: sources.find(
          (source) => source.name === workbook.originalDisplayName,
        )!.original,
        isExample: false,
      });
      expect(
        Object.isFrozen(result.current.builtSourceByKey[workbook.documentKey]),
      ).toBe(true);
    }
    expect(Object.isFrozen(result.current.builtSourceByKey)).toBe(true);
    act(() => result.current.updateSettings({ tone: "academic" }));
    expect(result.current.builtPackage).toBeNull();
    expect(result.current.builtSourceByKey).toEqual({});
  });

  it("binds duplicate display names to exact reviewed content, including significant terminal newlines", async () => {
    const sources = [
      {
        name: "notes.md",
        original: "Original first.",
        reviewed: "Reviewed first: 17 trees.",
      },
      {
        name: "notes.md",
        original: "Original second.",
        reviewed: "Reviewed second: 31 trees.",
      },
      {
        name: "notes.md",
        original: "Original third.",
        reviewed: "Reviewed second: 31 trees.\n",
      },
    ].sort((left, right) =>
      createHash("sha256")
        .update(right.original)
        .digest("hex")
        .localeCompare(
          createHash("sha256").update(left.original).digest("hex"),
        ),
    );
    const { result } = await importReviewed(sources);
    await act(async () => result.current.buildPackage());
    expect(result.current.error).toBeNull();
    const built = result.current.builtPackage!;
    const archive = await JSZip.loadAsync(built.blob, { checkCRC32: true });
    expect(
      new Set(built.workbooks.map((workbook) => workbook.documentKey)).size,
    ).toBe(3);
    const mappedTexts: string[] = [];
    for (const record of built.manifest.documents) {
      const archivedText = await archive
        .file(record.reviewedExtraction.path)!
        .async("string");
      expect(result.current.builtSourceByKey[record.key]).toEqual({
        name: "notes.md",
        text: archivedText,
        isExample: false,
      });
      mappedTexts.push(archivedText);
    }
    expect(mappedTexts).toEqual(
      [...sources].reverse().map((source) => source.reviewed),
    );
  });

  it("classifies an exact sample/user-source collision conservatively", async () => {
    const { result } = renderHook(() => useStudio());
    const seed = result.current.documents[0];
    // jsdom File lacks arrayBuffer in some supported Node runtimes.
    if (typeof seed.original.arrayBuffer !== "function") {
      Object.defineProperty(seed.original, "arrayBuffer", {
        value: async () => new TextEncoder().encode(seed.text).buffer,
      });
    }
    await act(async () =>
      result.current.importFiles([file(seed.name, seed.text)]),
    );
    act(() => result.current.confirmReview());
    await act(async () => result.current.buildPackage());
    expect(result.current.error).toBeNull();
    expect(result.current.builtPackage?.workbooks).toHaveLength(2);
    expect(Object.values(result.current.builtSourceByKey)).toEqual([
      { name: seed.name, text: seed.text, isExample: false },
      { name: seed.name, text: seed.text, isExample: false },
    ]);
  });

  it("does not bind source metadata from a successful but superseded build", async () => {
    const { result } = await importReviewed([
      { name: "draft.md", original: "The source before further editing." },
    ]);
    await act(async () => result.current.buildPackage());
    const oldResult = result.current.builtPackage!;
    expect(oldResult).not.toBeNull();
    act(() => result.current.updateSettings({ tone: "professional" }));
    let finish!: (result: PromptPackageResult) => void;
    vi.spyOn(packageExport, "buildPromptPackage").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.buildPackage();
    });
    act(() =>
      result.current.updateText("A new source supersedes that package."),
    );
    await act(async () => {
      finish(oldResult);
      await pending;
    });
    expect(result.current.error).toBeNull();
    expect(result.current.builtPackage).toBeNull();
    expect(result.current.builtSourceByKey).toEqual({});
  });
});
