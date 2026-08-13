import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { App } from "../../src/app/App";
import type { WorkbenchServices } from "../../src/app/workbench/contracts";
import { CURRENT_TUTORIAL_VERSION, PREFERENCES_STORAGE_KEY } from "../../src/app/workbench/preferences";
import type { WorkspaceProject } from "../../src/domain";
import { ProjectReview } from "../../src/app/workbench/components/ProjectReview";

beforeEach(() => window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ version: 1, data: { tutorialVersion: CURRENT_TUTORIAL_VERSION } })));
afterEach(() => window.localStorage.clear());

function project(): WorkspaceProject {
  const text = new TextEncoder().encode("Original project copy");
  const asset = new Uint8Array([137, 80, 78, 71]);
  return {
    kind: "project", id: "project-1", name: "demo", sourceKind: "folder", status: "needs-review",
    entries: [
      { path: "src/copy.md", immutablePath: "src/copy.md", byteCount: text.length, originalHash: "text-original", sha256: "text-original", originalBytes: text, contentKind: "text", languageId: "markdown", previewKind: "markdown", reviewedText: "Original project copy", reviewedTextHash: "text-reviewed", reviewRevision: 0, promptIncluded: true, packageIncluded: true, exclusionReason: null, restorable: true },
      { path: "assets/logo.png", immutablePath: "assets/logo.png", byteCount: asset.length, originalHash: "asset-original", sha256: "asset-original", originalBytes: asset, contentKind: "asset", languageId: null, previewKind: null, reviewedText: null, reviewedTextHash: null, reviewRevision: 0, promptIncluded: false, packageIncluded: true, exclusionReason: "non-text-asset", restorable: true },
    ],
    originalTreeHash: "tree-original", reviewedTreeHash: "tree-reviewed", treeHash: "tree-original", totalByteCount: text.length + asset.length,
    classification: "general-text", classificationChoiceRequired: false, classificationChoices: ["general-text", "latex"], rootDocument: null,
    selectedEntryPath: "src/copy.md", projectOperationGeneration: 0, projectReviewRevision: 0, requiresReview: true, warnings: [],
    sensitiveBlockedCounts: { credentialFiles: 0, privateKeys: 0, clearCredentials: 0 }, intake: { kind: "folder", displayName: "demo" },
    settingsOverride: {}, contextWarningAcknowledged: false,
  };
}

function services(): WorkbenchServices {
  return {
    createDocumentId: () => "unused",
    preflight: async () => [],
    extract: async () => { throw new Error("unused"); },
    hashText: async (text) => `hash:${text}`,
    buildPackage: async () => ({ ok: false, error: { code: "INVALID_INPUT", message: "unused" } }),
    download: () => ({ ok: true }),
    downloadProgressCopy: () => ({ ok: true }),
    readFolderProject: async () => project(),
    readZipProject: async () => ({ ...project(), id: "project-zip", name: "demo.zip", sourceKind: "zip", intake: { kind: "zip", displayName: "demo.zip" } }),
  };
}

describe("project review", () => {
  it("adds a folder as one workspace item and reviews immutable project paths", async () => {
    // This catches folder files being admitted as unrelated documents or project paths becoming editable.
    render(<App services={services()} />);
    const file = new File(["Original project copy"], "copy.md", { type: "text/markdown" });
    Object.defineProperty(file, "webkitRelativePath", { value: "demo/src/copy.md" });
    fireEvent.change(screen.getByLabelText("Add folder project"), { target: { files: [file] } });

    expect(await screen.findByRole("option", { name: /demo.*review/i })).toBeInTheDocument();
    const picker = screen.getByRole("button", { name: "Choose project file" });
    expect(picker).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(picker);
    expect(picker).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("list", { name: "Project files" })).toBeInTheDocument();
    expect(screen.getAllByText("src/copy.md").length).toBeGreaterThanOrEqual(2);
    const editor = screen.getByLabelText("Reviewed text for src/copy.md");
    fireEvent.change(editor, { target: { value: "Reworded project copy" } });
    fireEvent.blur(editor);
    expect(screen.getAllByText("src/copy.md").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("textbox", { name: /path/i })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm project review" })).toBeEnabled());
  });

  it("routes a selected ZIP through general project intake instead of document extraction", async () => {
    // This catches generic ZIP projects being forced through the legacy LaTeX document path.
    const testServices = services();
    const preflight = vi.fn(testServices.preflight);
    render(<App services={{ ...testServices, preflight }} />);
    fireEvent.change(screen.getByLabelText("Add supported files"), {
      target: { files: [new File([new Uint8Array([80, 75, 3, 4])], "demo.zip", { type: "application/zip" })] },
    });
    expect(await screen.findByRole("option", { name: /demo\.zip.*review/i })).toBeInTheDocument();
    expect(preflight).not.toHaveBeenCalled();
  });

  it("requires an explicit ambiguous project classification before review confirmation", async () => {
    // This catches ambiguous project detection silently choosing a workflow without owner review.
    const ambiguous = {
      ...project(),
      classificationChoiceRequired: true,
      entries: [
        ...project().entries,
        {
          ...project().entries[0],
          path: "main.tex",
          immutablePath: "main.tex",
          languageId: "latex",
          previewKind: "code" as const,
          originalHash: "tex-original",
          sha256: "tex-original",
        },
      ],
    } satisfies WorkspaceProject;
    render(<App services={{ ...services(), readFolderProject: async () => ambiguous }} />);
    const file = new File(["text"], "copy.md");
    Object.defineProperty(file, "webkitRelativePath", { value: "ambiguous/copy.md" });
    fireEvent.change(screen.getByLabelText("Add folder project"), { target: { files: [file] } });

    const confirm = await screen.findByRole("button", { name: "Confirm project review" });
    expect(confirm).toBeDisabled();
    const classification = screen.getByRole("combobox", { name: "Project classification" });
    expect(classification).toHaveValue("");
    fireEvent.change(classification, { target: { value: "latex" } });
    expect(screen.getByRole("combobox", { name: "LaTeX root document" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "LaTeX root document" }), { target: { value: "main.tex" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm project review" })).toBeEnabled());
  });

  it("charges project bytes to later document preflight without consuming document count", async () => {
    // This catches a project plus standalone documents bypassing the shared 100 MiB session budget.
    const projectBytes = 100 * 1024 * 1024 - 4;
    const preflight = vi.fn(async (..._args: Parameters<WorkbenchServices["preflight"]>) => {
      expect(_args[0]).toHaveLength(1);
      return [];
    });
    render(<App services={{
      ...services(),
      preflight,
      readFolderProject: async () => ({ ...project(), totalByteCount: projectBytes }),
    }} />);
    const folderFile = new File(["text"], "copy.md");
    Object.defineProperty(folderFile, "webkitRelativePath", { value: "large/copy.md" });
    fireEvent.change(screen.getByLabelText("Add folder project"), { target: { files: [folderFile] } });
    await screen.findByRole("option", { name: /demo.*review/i });

    fireEvent.change(screen.getByLabelText("Add supported files"), {
      target: { files: [new File(["later"], "later.md")] },
    });
    await waitFor(() => expect(preflight).toHaveBeenCalled());
    expect(preflight.mock.calls[0]?.[1]).toEqual({ acceptedCount: 0, acceptedBytes: projectBytes });
  });

  it("reserves ZIP project bytes before preflighting a standalone file from the same batch", async () => {
    // This catches the async project dispatch leaving same-picker document capacity stale.
    const projectBytes = 100 * 1024 * 1024 - 2;
    const preflight = vi.fn(async (...args: Parameters<WorkbenchServices["preflight"]>) => {
      expect(args[0]).toHaveLength(1);
      return [];
    });
    render(<App services={{
      ...services(),
      preflight,
      readZipProject: async () => ({ ...project(), sourceKind: "zip", totalByteCount: projectBytes }),
    }} />);
    fireEvent.change(screen.getByLabelText("Add supported files"), { target: { files: [
      new File([new Uint8Array([80, 75, 3, 4])], "large.zip"),
      new File(["later"], "later.md"),
    ] } });
    await waitFor(() => expect(preflight).toHaveBeenCalled());
    expect(preflight.mock.calls[0]?.[1]).toEqual({ acceptedCount: 0, acceptedBytes: projectBytes });
  });

  it("keeps the latest rapid editor draft and cancels a pending edit when the project disappears", () => {
    // This catches per-keystroke async hashes reverting text and late callbacks surviving reset/removal unmounts.
    vi.useFakeTimers();
    const onEdit = vi.fn();
    const { unmount } = render(<ProjectReview
      project={project()}
      onSelect={() => undefined}
      onEdit={onEdit}
      onInclusion={() => undefined}
      onClassification={() => undefined}
      onConfirm={() => undefined}
    />);
    const editor = screen.getByLabelText("Reviewed text for src/copy.md");
    fireEvent.change(editor, { target: { value: "R" } });
    fireEvent.change(editor, { target: { value: "Rapid" } });
    fireEvent.change(editor, { target: { value: "Rapid final" } });
    expect(editor).toHaveValue("Rapid final");
    expect(onEdit).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(150));
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenLastCalledWith("src/copy.md", "Rapid final");
    fireEvent.change(editor, { target: { value: "Must be cancelled" } });
    unmount();
    act(() => vi.runAllTimers());
    expect(onEdit).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("serializes submitted project edits so a pending hash cannot drop newer exact text", async () => {
    // This catches a second debounced edit capturing the same project revision while the first hash is pending.
    const digestResolvers: Array<(value: ArrayBuffer) => void> = [];
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(
      () => new Promise<ArrayBuffer>((resolve) => digestResolvers.push(resolve)),
    );
    render(<App services={services()} />);
    const folderFile = new File(["text"], "copy.md");
    Object.defineProperty(folderFile, "webkitRelativePath", { value: "demo/copy.md" });
    fireEvent.change(screen.getByLabelText("Add folder project"), { target: { files: [folderFile] } });
    const editor = await screen.findByLabelText("Reviewed text for src/copy.md");
    vi.useFakeTimers();

    fireEvent.change(editor, { target: { value: "First submitted" } });
    await act(async () => { vi.advanceTimersByTime(150); await Promise.resolve(); });
    expect(digest).toHaveBeenCalledTimes(1);
    fireEvent.change(editor, { target: { value: "Latest exact text" } });
    await act(async () => { vi.advanceTimersByTime(150); await Promise.resolve(); });
    expect(editor).toHaveValue("Latest exact text");
    expect(digest).toHaveBeenCalledTimes(1);

    for (let index = 0; index < 4; index += 1) {
      await act(async () => {
        const resolve = digestResolvers.shift();
        expect(resolve).toBeDefined();
        resolve!(new Uint8Array(32).buffer);
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    expect(screen.getByLabelText("Reviewed text for src/copy.md")).toHaveValue("Latest exact text");
    digest.mockRestore();
    vi.useRealTimers();
  });
});
