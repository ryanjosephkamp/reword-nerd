import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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

  it("names an automatic prompt-cap exclusion as an initial scope reduction", () => {
    // This catches the bounded intake looking like an unexplained generic exclusion before review confirmation.
    const capped = project();
    capped.entries = capped.entries.map((entry) => entry.path === "src/copy.md"
      ? { ...entry, promptIncluded: false, packageIncluded: true, exclusionReason: "prompt-limit" as const }
      : entry);
    render(<ProjectReview
      project={capped}
      onSelect={() => undefined}
      onEdit={() => undefined}
      onInclusion={() => undefined}
      onClassification={() => undefined}
      onConfirm={() => undefined}
    />);

    expect(screen.getByRole("status")).toHaveTextContent(/excluded from prompt scope.*250-file.*5 MiB.*review.*before confirming/i);
    expect(screen.getByText("PROMPT LIMIT", { selector: "small" })).toBeInTheDocument();
  });

  it.each([
    ["inclusion", (view: typeof screen) => fireEvent.click(view.getByRole("checkbox", { name: "Include in package" }))],
    ["classification", (view: typeof screen) => fireEvent.change(view.getByRole("combobox", { name: "Project classification" }), { target: { value: "general-text" } })],
  ] as const)("blocks BUILD synchronously while a project %s hash is deferred", async (_label, mutate) => {
    const ready = { ...project(), status: "ready" as const, requiresReview: false };
    render(<App services={{ ...services(), readFolderProject: async () => ready }} />);
    const file = new File(["text"], "copy.md");
    Object.defineProperty(file, "webkitRelativePath", { value: "demo/copy.md" });
    fireEvent.change(screen.getByLabelText("Add folder project"), { target: { files: [file] } });
    await screen.findByRole("textbox", { name: "Reviewed text for src/copy.md" });

    let release!: (value: ArrayBuffer) => void;
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementationOnce(
      () => new Promise<ArrayBuffer>((resolve) => { release = resolve; }),
    );
    mutate(screen);
    expect(screen.getAllByRole("button", { name: /build package/i }).every((button) => button.hasAttribute("disabled"))).toBe(true);
    await waitFor(() => expect(release).toBeTypeOf("function"));
    await act(async () => release(new Uint8Array(32).buffer));
    digest.mockRestore();
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

  it("keeps the latest rapid editor draft and flushes a pending edit before the editor disappears", () => {
    // This catches an entry switch/removal silently discarding the visible text before its debounce expires.
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
    expect(onEdit).toHaveBeenLastCalledWith("src/copy.md", "Rapid final", undefined);
    fireEvent.change(editor, { target: { value: "Must be cancelled" } });
    unmount();
    act(() => vi.runAllTimers());
    expect(onEdit).toHaveBeenCalledTimes(2);
    expect(onEdit).toHaveBeenLastCalledWith("src/copy.md", "Must be cancelled", undefined);
    vi.useRealTimers();
  });

  it("renews mutation custody before retrying the same draft after a failed edit", async () => {
    // This catches an exact-value blur retry reusing a failed ticket, resolving as a no-op,
    // and clearing the dirty guard while canonical project text remains unchanged.
    let nextTicket = 0;
    const onMutationIntent = vi.fn(() => {
      nextTicket += 1;
      return nextTicket;
    });
    const onEdit = vi.fn()
      .mockRejectedValueOnce(new Error("hash failed"))
      .mockResolvedValueOnce(undefined);
    render(<ProjectReview
      project={project()}
      onSelect={() => undefined}
      onMutationIntent={onMutationIntent}
      onEdit={onEdit}
      onInclusion={() => undefined}
      onClassification={() => undefined}
      onConfirm={() => undefined}
    />);
    const editor = screen.getByLabelText("Reviewed text for src/copy.md");
    const confirm = screen.getByRole("button", { name: "Confirm project review" });

    fireEvent.change(editor, { target: { value: "Retry this exact draft" } });
    fireEvent.blur(editor);
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit).toHaveBeenLastCalledWith("src/copy.md", "Retry this exact draft", 1);
    expect(confirm).toBeDisabled();

    fireEvent.blur(editor);
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(2));
    expect(onEdit).toHaveBeenLastCalledWith("src/copy.md", "Retry this exact draft", 2);
    expect(onMutationIntent).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(confirm).toBeEnabled());
  });

  it("accepts the exact retried draft into canonical project state after a hash failure", async () => {
    // This verifies the renewed ticket reaches the real project reducer instead of only
    // changing the editor's local dirty state.
    const realDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest")
      .mockRejectedValueOnce(new Error("first hash failed"))
      .mockImplementation((algorithm, data) => realDigest(algorithm, data));
    render(<App services={services()} />);
    const file = new File(["Original project copy"], "copy.md", { type: "text/markdown" });
    Object.defineProperty(file, "webkitRelativePath", { value: "demo/src/copy.md" });
    fireEvent.change(screen.getByLabelText("Add folder project"), { target: { files: [file] } });
    const editor = await screen.findByLabelText("Reviewed text for src/copy.md");
    const confirm = screen.getByRole("button", { name: "Confirm project review" });

    fireEvent.change(editor, { target: { value: "Canonical retry text" } });
    fireEvent.blur(editor);
    await screen.findByText("The project review change could not be applied safely.");
    expect(confirm).toBeDisabled();

    fireEvent.blur(editor);
    await screen.findByText("Project review changed. Confirm the project again.");
    await waitFor(() => expect(confirm).toBeEnabled());

    const picker = screen.getByRole("button", { name: "Choose project file" });
    fireEvent.click(picker);
    fireEvent.click(within(screen.getByRole("list", { name: "Project files" })).getByRole("button", { name: /assets\/logo\.png/i }));
    fireEvent.click(picker);
    fireEvent.click(within(screen.getByRole("list", { name: "Project files" })).getByRole("button", { name: /src\/copy\.md/i }));
    expect(screen.getByLabelText("Reviewed text for src/copy.md")).toHaveValue("Canonical retry text");
    digest.mockRestore();
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

  it("starts a fresh review queue when the same deterministic project is reimported after New session", async () => {
    // This catches retained project bytes/promises chaining a new same-ID project behind a stale edit.
    const digestSettlers: Array<{ resolve(value: ArrayBuffer): void; reject(reason: Error): void }> = [];
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(
      () => new Promise<ArrayBuffer>((resolve, reject) => digestSettlers.push({ resolve, reject })),
    );
    render(<App services={services()} />);
    const addProject = () => {
      const folderFile = new File(["text"], "copy.md");
      Object.defineProperty(folderFile, "webkitRelativePath", { value: "demo/copy.md" });
      fireEvent.change(screen.getByLabelText("Add folder project"), { target: { files: [folderFile] } });
    };

    addProject();
    let editor = await screen.findByLabelText("Reviewed text for src/copy.md");
    fireEvent.change(editor, { target: { value: "Stale pre-reset edit" } });
    await waitFor(() => expect(digest).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    fireEvent.click(screen.getByRole("button", { name: "Start new session" }));
    addProject();
    editor = await screen.findByLabelText("Reviewed text for src/copy.md");
    fireEvent.change(editor, { target: { value: "Fresh post-reset edit" } });
    await waitFor(() => expect(digest).toHaveBeenCalledTimes(2));
    expect(editor).toHaveValue("Fresh post-reset edit");
    await act(async () => {
      digestSettlers[0]?.reject(new Error("stale failure"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText("The project review change could not be applied safely.")).not.toBeInTheDocument();
    digest.mockRestore();
  });

  it("rejects a pre-debounce cleanup edit after New session and same-ID reimport", async () => {
    // This catches editor cleanup acquiring the post-reset generation and overwriting a newly imported identical project.
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    render(<App services={services()} />);
    const addProject = () => {
      const folderFile = new File(["text"], "copy.md");
      Object.defineProperty(folderFile, "webkitRelativePath", { value: "demo/copy.md" });
      fireEvent.change(screen.getByLabelText("Add folder project"), { target: { files: [folderFile] } });
    };

    addProject();
    const firstEditor = await screen.findByLabelText("Reviewed text for src/copy.md");
    fireEvent.change(firstEditor, { target: { value: "Stale draft before debounce" } });
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    fireEvent.click(screen.getByRole("button", { name: "Start new session" }));

    addProject();
    const freshEditor = await screen.findByLabelText("Reviewed text for src/copy.md");
    expect(freshEditor).toHaveValue("Original project copy");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });

    expect(screen.getByLabelText("Reviewed text for src/copy.md")).toHaveValue("Original project copy");
    expect(screen.queryByText("Project review changed. Confirm the project again.")).not.toBeInTheDocument();
    expect(digest).not.toHaveBeenCalled();
    digest.mockRestore();
  });

  it("serializes concurrent folder admission and atomically reserves the first project bytes", async () => {
    // This catches two deferred projects both observing the same pre-admission session capacity.
    const sixtyMiB = 60 * 1024 * 1024;
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const readFolderProject = vi.fn(async (input: Parameters<NonNullable<WorkbenchServices["readFolderProject"]>>[0], options?: Parameters<NonNullable<WorkbenchServices["readFolderProject"]>>[1]) => {
      if (input.name === "first") await firstGate;
      if ((options?.existingSessionBytes ?? 0) + sixtyMiB > 100 * 1024 * 1024) throw new Error("capacity");
      return { ...project(), id: `project-${input.name}`, name: input.name, totalByteCount: sixtyMiB };
    });
    render(<App services={{ ...services(), readFolderProject }} />);
    const input = screen.getByLabelText("Add folder project");
    const first = new File(["one"], "copy.md");
    Object.defineProperty(first, "webkitRelativePath", { value: "first/copy.md" });
    const second = new File(["two"], "copy.md");
    Object.defineProperty(second, "webkitRelativePath", { value: "second/copy.md" });

    fireEvent.change(input, { target: { files: [first] } });
    fireEvent.change(input, { target: { files: [second] } });
    await waitFor(() => expect(readFolderProject).toHaveBeenCalledTimes(1));
    await act(async () => { releaseFirst(); await firstGate; });
    await waitFor(() => expect(readFolderProject).toHaveBeenCalledTimes(2));

    expect(readFolderProject.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ existingSessionBytes: sixtyMiB }));
    expect(within(screen.getByRole("listbox", { name: "Uploaded files" })).getAllByRole("option")).toHaveLength(1);
    expect(await screen.findByText(/second: this folder could not be admitted safely/i)).toBeInTheDocument();
  });

  it("shares one atomic capacity reservation across folder and standalone file intake", async () => {
    // This catches separate hook-local capacities admitting two concurrent 60 MiB inputs into a 100 MiB session.
    const sixtyMiB = 60 * 1024 * 1024;
    let releaseFolder!: () => void;
    const folderGate = new Promise<void>((resolve) => { releaseFolder = resolve; });
    const readFolderProject = vi.fn(async () => {
      await folderGate;
      return { ...project(), id: "large-folder", name: "large-folder", totalByteCount: sixtyMiB };
    });
    const preflight = vi.fn(async (files: readonly File[], capacity: { acceptedCount: number; acceptedBytes: number }) => files.map((file) => capacity.acceptedBytes + file.size > 100 * 1024 * 1024
      ? { accepted: false as const, file, issue: { code: "TOTAL_TOO_LARGE" as const, message: "Session byte limit exceeded." } }
      : { accepted: true as const, file, format: "markdown" as const, originalBytes: new ArrayBuffer(0) }));
    render(<App services={{ ...services(), readFolderProject, preflight }} />);
    const folder = new File(["folder"], "copy.md");
    Object.defineProperty(folder, "webkitRelativePath", { value: "large-folder/copy.md" });
    const standalone = new File(["standalone"], "later.md");
    Object.defineProperty(standalone, "size", { value: sixtyMiB });

    fireEvent.change(screen.getByLabelText("Add folder project"), { target: { files: [folder] } });
    await waitFor(() => expect(readFolderProject).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Add supported files"), { target: { files: [standalone] } });
    await Promise.resolve();
    expect(preflight).not.toHaveBeenCalled();

    await act(async () => { releaseFolder(); await folderGate; });
    await waitFor(() => expect(preflight).toHaveBeenCalledTimes(1));
    expect(preflight.mock.calls[0]?.[1]).toEqual({ acceptedCount: 0, acceptedBytes: sixtyMiB });
    expect(within(screen.getByRole("listbox", { name: "Uploaded files" })).getAllByRole("option")).toHaveLength(1);
  });
});
