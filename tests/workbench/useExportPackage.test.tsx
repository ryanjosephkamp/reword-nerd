import { useReducer } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WorkspaceDocument } from "../../src/domain";
import type { DocumentWorkbook, ExportDocumentInput, PromptPackageResult } from "../../src/export";
import type { WorkbenchServices } from "../../src/app/workbench/contracts";
import {
  createInitialWorkbenchState,
  workbenchReducer,
} from "../../src/app/workbench/reducer";
import { selectDirty } from "../../src/app/workbench/selectors";
import { useExportPackage } from "../../src/app/workbench/useExportPackage";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function packageResult(blob: Blob, documentKey = "current"): PromptPackageResult {
  const workbooks = [{ documentKey, originalDisplayName: `${documentKey}.md` } as DocumentWorkbook];
  return {
    ok: true,
    blob,
    filename: "reword-nerd-prompt-package.zip",
    manifest: {} as never,
    workbooks,
    artifacts: workbooks,
  };
}

function readyDocument(): WorkspaceDocument {
  return {
    id: "document-alpha",
    original: new File(["Source text"], "alpha.md", { type: "text/markdown" }),
    originalByteSize: 11,
    originalHash: "original-alpha",
    name: "alpha.md",
    format: "markdown",
    status: "ready",
    extractedText: "Source text",
    extractedTextHash: "text-alpha",
    warnings: [],
    requiresReview: false,
    settingsOverride: {},
    contextWarningAcknowledged: true,
  };
}

function createReadyState() {
  return workbenchReducer(createInitialWorkbenchState(), {
    type: "intake/accepted",
    batchId: "batch-alpha",
    documents: [{ document: readyDocument(), uploadOrdinal: 0 }],
  });
}

function ExportHarness({ services }: { services: WorkbenchServices }) {
  const [state, dispatch] = useReducer(workbenchReducer, undefined, createReadyState);
  const exporter = useExportPackage(state, dispatch, services);
  const editorRevision = state.editor["document-alpha"]?.revision ?? 0;

  return <>
    <button type="button" onClick={() => void exporter.build()}>Build</button>
    <button type="button" onClick={() => exporter.download()}>Download</button>
    <button
      type="button"
      onClick={() => {
        void exporter.build();
        void exporter.build();
      }}
    >Build twice concurrently</button>
    <button
      type="button"
      onClick={() => dispatch({
        type: "editor/edited",
        documentId: "document-alpha",
        text: "Edited during build",
      })}
    >Mutate document</button>
    <button
      type="button"
      onClick={() => {
        dispatch({
          type: "editor/hash-completed",
          documentId: "document-alpha",
          revision: editorRevision,
          hash: "edited-hash",
        });
        dispatch({
          type: "review/confirmed",
          documentId: "document-alpha",
          revision: editorRevision,
        });
      }}
    >Finish review</button>
    <button
      type="button"
      onClick={() => dispatch({
        type: "settings/global-changed",
        field: "length",
        value: "expanded",
      })}
    >Mutate settings</button>
    <button
      type="button"
      onClick={() => dispatch({ type: "profile/selected", profileId: "anthropic-general" })}
    >Mutate profile</button>
    <button
      type="button"
      onClick={() => dispatch({
        type: "context/acknowledged",
        itemId: "document-alpha",
        acknowledged: false,
      })}
    >Mutate review</button>
    <output data-testid="export-status">{state.export.status}</output>
    <output data-testid="dirty">{String(selectDirty(state))}</output>
    <output data-testid="revision">{state.revision}</output>
    <output data-testid="last-exported-revision">{state.lastExportedRevision}</output>
    <output data-testid="workbook-key">{state.export.builtPackage?.workbooks[0]?.documentKey ?? "none"}</output>
  </>;
}

function CodeExportHarness({ services }: { services: WorkbenchServices }) {
  const [state, dispatch] = useReducer(workbenchReducer, undefined, () => {
    const document = { ...readyDocument(), name: "app.ts", format: "code" as const, extractedText: "// original comment\nconst x = 1;" };
    return workbenchReducer(createInitialWorkbenchState(), {
      type: "intake/accepted",
      batchId: "code-batch",
      documents: [{ document, uploadOrdinal: 0 }],
    });
  });
  const exporter = useExportPackage(state, dispatch, services);
  return <button type="button" onClick={() => void exporter.build()}>Build code</button>;
}

function testServices(
  buildPackage: WorkbenchServices["buildPackage"],
  download: WorkbenchServices["download"],
): WorkbenchServices {
  return {
    createDocumentId: () => "unused",
    preflight: async () => [],
    extract: async () => { throw new Error("unused"); },
    hashText: async () => "unused",
    buildPackage,
    download,
    downloadProgressCopy: () => ({ ok: true }),
  };
}

type MutationCase = {
  label: string;
  button: string;
  finishReview?: boolean;
  assertCurrent(input: ExportDocumentInput): void;
};

const mutationCases: MutationCase[] = [
  {
    label: "document content",
    button: "Mutate document",
    finishReview: true,
    assertCurrent: (input) => expect(input.reviewedExtractedText).toBe("Edited during build"),
  },
  {
    label: "settings",
    button: "Mutate settings",
    assertCurrent: (input) => expect(input.resolvedSettings.length).toBe("expanded"),
  },
  {
    label: "profile",
    button: "Mutate profile",
    assertCurrent: (input) => expect(input.chosenProfile.id).toBe("anthropic-general"),
  },
  {
    label: "review state",
    button: "Mutate review",
    assertCurrent: (input) => expect(input.contextWarningAcknowledged).toBe(false),
  },
];

describe("useExportPackage operation guards", () => {
  it.each(mutationCases)(
    "discards a completed package after $label changes and rebuilds current state",
    async ({ button, finishReview, assertCurrent }) => {
      const staleBuild = deferred<PromptPackageResult>();
      const staleBlob = new Blob(["stale"]);
      const currentBlob = new Blob(["current"]);
      const buildPackage = vi.fn<WorkbenchServices["buildPackage"]>()
        .mockImplementationOnce(() => staleBuild.promise)
        .mockResolvedValueOnce(packageResult(currentBlob));
      const download = vi.fn<WorkbenchServices["download"]>(() => ({ ok: true }));
      render(<ExportHarness services={testServices(buildPackage, download)} />);

      fireEvent.click(screen.getByRole("button", { name: "Build" }));
      await waitFor(() => expect(buildPackage).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole("button", { name: button }));
      if (finishReview) fireEvent.click(screen.getByRole("button", { name: "Finish review" }));

      await act(async () => staleBuild.resolve(packageResult(staleBlob, "obsolete")));

      expect(download).not.toHaveBeenCalled();
      expect(screen.getByTestId("workbook-key")).toHaveTextContent("none");
      expect(screen.getByTestId("dirty")).toHaveTextContent("true");
      expect(screen.getByTestId("last-exported-revision").textContent).not.toBe(
        screen.getByTestId("revision").textContent,
      );

      fireEvent.click(screen.getByRole("button", { name: "Build" }));
      await waitFor(() => expect(screen.getByTestId("export-status")).toHaveTextContent("ready"));

      expect(download).not.toHaveBeenCalled();
      expect(buildPackage).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("workbook-key")).toHaveTextContent("current");
      const currentInput = buildPackage.mock.calls[1][0][0];
      if (currentInput.kind === "project") throw new Error("document fixture produced project input");
      assertCurrent(currentInput);
      expect(screen.getByTestId("dirty")).toHaveTextContent("true");

      fireEvent.click(screen.getByRole("button", { name: "Download" }));

      expect(download.mock.calls[0][0]).toBe(currentBlob);
      expect(screen.getByTestId("dirty")).toHaveTextContent("false");
    },
  );

  it("admits only one build when the same activation invokes build twice", async () => {
    const build = deferred<PromptPackageResult>();
    const blob = new Blob(["one operation"]);
    const buildPackage = vi.fn<WorkbenchServices["buildPackage"]>(() => build.promise);
    const download = vi.fn<WorkbenchServices["download"]>(() => ({ ok: true }));
    render(<ExportHarness services={testServices(buildPackage, download)} />);

    fireEvent.click(screen.getByRole("button", { name: "Build twice concurrently" }));
    await waitFor(() => expect(buildPackage).toHaveBeenCalledTimes(1));
    await act(async () => build.resolve(packageResult(blob)));
    await waitFor(() => expect(screen.getByTestId("export-status")).toHaveTextContent("ready"));

    expect(download).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(download.mock.calls[0][0]).toBe(blob);
  });

  it("lets a current rebuild finish while an invalidated build is still pending", async () => {
    const staleBuild = deferred<PromptPackageResult>();
    const currentBuild = deferred<PromptPackageResult>();
    const staleBlob = new Blob(["stale overlapping operation"]);
    const currentBlob = new Blob(["current overlapping operation"]);
    const buildPackage = vi.fn<WorkbenchServices["buildPackage"]>()
      .mockImplementationOnce(() => staleBuild.promise)
      .mockImplementationOnce(() => currentBuild.promise);
    const download = vi.fn<WorkbenchServices["download"]>(() => ({ ok: true }));
    render(<ExportHarness services={testServices(buildPackage, download)} />);

    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    await waitFor(() => expect(buildPackage).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Mutate settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    await waitFor(() => expect(buildPackage).toHaveBeenCalledTimes(2));

    await act(async () => currentBuild.resolve(packageResult(currentBlob)));
    await waitFor(() => expect(screen.getByTestId("export-status")).toHaveTextContent("ready"));
    expect(download).not.toHaveBeenCalled();
    expect(screen.getByTestId("dirty")).toHaveTextContent("true");

    await act(async () => staleBuild.resolve(packageResult(staleBlob)));

    expect(download).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(download).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0][0]).toBe(currentBlob);
    expect(screen.getByTestId("dirty")).toHaveTextContent("false");
    expect(screen.getByTestId("last-exported-revision").textContent).toBe(
      screen.getByTestId("revision").textContent,
    );
  });

  it("retries the retained current package after download failure without rebuilding", async () => {
    const blob = new Blob(["retryable current package"]);
    const buildPackage = vi.fn<WorkbenchServices["buildPackage"]>()
      .mockResolvedValue(packageResult(blob));
    const download = vi.fn<WorkbenchServices["download"]>()
      .mockReturnValueOnce({
        ok: false,
        error: { code: "ARCHIVE_GENERATION_FAILED", message: "test failure" },
      })
      .mockReturnValueOnce({ ok: true });
    render(<ExportHarness services={testServices(buildPackage, download)} />);

    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    await waitFor(() => expect(screen.getByTestId("export-status")).toHaveTextContent("ready"));
    expect(download).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(screen.getByTestId("export-status")).toHaveTextContent("failure"));
    expect(screen.getByTestId("dirty")).toHaveTextContent("true");

    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(screen.getByTestId("export-status")).toHaveTextContent("success"));

    expect(buildPackage).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledTimes(2);
    expect(download.mock.calls[0][0]).toBe(blob);
    expect(download.mock.calls[1][0]).toBe(blob);
    expect(screen.getByTestId("dirty")).toHaveTextContent("false");
  });

  it("passes global code rewrite selections into standalone code prompts", async () => {
    const buildPackage = vi.fn<WorkbenchServices["buildPackage"]>().mockResolvedValue({
      ok: false,
      error: { code: "ARCHIVE_GENERATION_FAILED", message: "capture only" },
    });
    render(<CodeExportHarness services={testServices(buildPackage, () => ({ ok: true }))} />);
    fireEvent.click(screen.getByRole("button", { name: "Build code" }));
    await waitFor(() => expect(buildPackage).toHaveBeenCalledOnce());
    const input = buildPackage.mock.calls[0][0][0] as ExportDocumentInput;
    expect(input.promptBundle.oneShot).toContain("## Rewrite Selection");
    expect(input.promptBundle.oneShot).toContain("Comments and docstrings: include");
    expect(input.promptBundle.oneShot).toContain("Narrative structured-data values: exclude");
  });
});
