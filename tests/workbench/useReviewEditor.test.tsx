import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchServices, WorkbenchState } from "../../src/app/workbench/contracts";
import { createInitialWorkbenchState, type WorkbenchAction } from "../../src/app/workbench/reducer";
import { useReviewEditor } from "../../src/app/workbench/useReviewEditor";

afterEach(() => vi.useRealTimers());

describe("useReviewEditor session generations", () => {
  it("drops a hash completion that resolves after a new session begins", async () => {
    vi.useFakeTimers();
    let resolveHash!: (hash: string) => void;
    const hashText = vi.fn(() => new Promise<string>((resolve) => { resolveHash = resolve; }));
    const dispatch = vi.fn<(action: WorkbenchAction) => void>();
    const initial = createInitialWorkbenchState();
    const file = new File(["source"], "source.md");
    const state: WorkbenchState = {
      ...initial,
      documents: [{
        id: "reused-id",
        batchId: "batch",
        uploadOrdinal: 0,
        original: file,
        originalByteSize: file.size,
        originalHash: "original",
        name: file.name,
        format: "markdown",
        status: "needs-review",
        extractedText: "source",
        extractedTextHash: "source-hash",
        warnings: [],
        requiresReview: true,
        settingsOverride: {},
        contextWarningAcknowledged: false,
      }],
      editor: { "reused-id": { revision: 0, hashPending: false, hashFailed: false } },
    };
    const services = { hashText } as unknown as WorkbenchServices;
    const { result } = renderHook(() => useReviewEditor(state, dispatch, services));

    act(() => result.current.edit("reused-id", "changed"));
    await act(async () => { await vi.advanceTimersByTimeAsync(160); });
    expect(hashText).toHaveBeenCalledWith("changed");
    act(() => result.current.resetSession());
    await act(async () => { resolveHash("late-hash"); await Promise.resolve(); });

    expect(dispatch).toHaveBeenCalledWith({
      type: "editor/edited",
      documentId: "reused-id",
      text: "changed",
    });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "editor/hash-completed" }));
  });
});
