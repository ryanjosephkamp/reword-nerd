import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "../../src/app/App";
import type { WorkbenchServices } from "../../src/app/workbench/contracts";
import type { DocumentWorkbook } from "../../src/export";
import { CURRENT_TUTORIAL_VERSION, PREFERENCES_STORAGE_KEY } from "../../src/app/workbench/preferences";

const defaultMatchMedia = window.matchMedia;
beforeEach(() => {
  window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
    version: 1,
    data: { tutorialVersion: CURRENT_TUTORIAL_VERSION },
  }));
});
afterEach(() => {
  window.matchMedia = defaultMatchMedia;
  window.localStorage.clear();
});

function workbook(documentKey = "notes", name = "notes.md"): DocumentWorkbook {
  const promptBlocks = [
    { stage: "decompose" as const, title: "Stage 1 — Decompose", content: "DECOMPOSE PROMPT\nSource text" },
    { stage: "rewrite" as const, title: "Stage 2 — Rewrite", content: "REWRITE PROMPT\n<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>" },
    { stage: "verify" as const, title: "Stage 3 — Verify", content: "VERIFY PROMPT\n<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>\n<<<INSERT_STAGE_2_REWRITE_RESPONSE>>>" },
    { stage: "final" as const, title: "Stage 4 — Final", content: "FINAL PROMPT\n<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>\n<<<INSERT_STAGE_2_REWRITE_RESPONSE>>>\n<<<INSERT_STAGE_3_VERIFICATION_RESPONSE>>>" },
  ];
  return {
    documentKey,
    originalDisplayName: name,
    runbook: {} as never,
    runbookMarkdown: "# reword-nerd prompt package\n\nRun each stage in order.",
    runbookDocument: {
      type: "runbook-document",
      blocks: [
        { type: "heading", depth: 1, content: [{ type: "text", value: "reword-nerd prompt package" }] },
        { type: "paragraph", content: [{ type: "text", value: "Run each stage in order." }] },
      ],
    },
    promptBundle: {
      oneShot: "ONE-SHOT PROMPT\nSource text",
      manual: {
        decompose: promptBlocks[0].content,
        rewrite: promptBlocks[1].content,
        verify: promptBlocks[2].content,
        final: promptBlocks[3].content,
      },
    },
    promptBlocks,
    oneShot: { prompt: "ONE-SHOT PROMPT\nSource text", markdown: "one-shot markdown", html: "<!doctype html><title>one shot</title>" },
    manual: { promptBlocks, markdown: "manual markdown", html: "<!doctype html><title>manual</title>" },
    combined: {
      markdown: "combined markdown",
      html: "<!doctype html><title>combined prompts</title>",
      fullHtml: "<!doctype html><title>combined prompts full</title>",
      fullHtmlStatus: "generated",
    },
    markdown: "combined markdown",
    html: "<!doctype html><title>combined prompts</title>",
    fullHtml: "<!doctype html><title>combined prompts full</title>",
    fullHtmlStatus: "generated",
    visualAssets: [],
  };
}

function services(overrides: Partial<WorkbenchServices> = {}): WorkbenchServices {
  let nextId = 0;
  return {
    createDocumentId: () => `document-${nextId++}`,
    preflight: async (files) => files.map((file) => ({
      accepted: true as const,
      file,
      format: "markdown" as const,
      originalBytes: new TextEncoder().encode("Source text").buffer,
    })),
    extract: async (accepted) => ({
      format: accepted.format,
      extractedText: "Source text",
      warnings: [],
      originalHash: "original-hash",
      extractedTextHash: "text-hash",
      requiresReview: true,
    }),
    hashText: async (text) => `hash:${text}`,
    buildPackage: async () => {
      const workbooks = [workbook()];
      return {
      ok: true,
      blob: new Blob(["zip"]),
      filename: "reword-nerd-prompt-package.zip",
      manifest: {} as never,
      workbooks,
      artifacts: workbooks,
    }; },
    download: () => ({ ok: true }),
    downloadProgressCopy: () => ({ ok: true }),
    ...overrides,
  };
}

async function uploadReviewedFile(testServices: WorkbenchServices) {
  render(<App services={testServices} />);
  const input = screen.getByLabelText("Add supported files");
  const file = new File(["Source text"], "notes.md", { type: "text/markdown" });
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByDisplayValue("Source text");
  fireEvent.click(screen.getByRole("button", { name: "Confirm review" }));
  expect((await screen.findAllByText("Review complete")).length).toBeGreaterThanOrEqual(1);
}

describe("Night Terminal workbench", () => {
  it("collapses desktop Settings without invalidating the session and expands it on demand", async () => {
    // This catches the desktop gear being inert or a view-only collapse invalidating a built package.
    await uploadReviewedFile(services());
    const settingsButton = screen.getByRole("button", { name: "Settings" });
    const grid = document.querySelector(".workbench-grid");
    expect(settingsButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "Parameters" })).toBeInTheDocument();

    fireEvent.click(settingsButton);
    expect(settingsButton).toHaveAttribute("aria-expanded", "false");
    expect(grid).toHaveClass("settings-collapsed");
    expect(document.getElementById("panel-settings")).toHaveAttribute("hidden");

    fireEvent.click(settingsButton);
    expect(settingsButton).toHaveAttribute("aria-expanded", "true");
    expect(grid).not.toHaveClass("settings-collapsed");
  });

  it("opens New session from the header and clears documents only after confirmation", async () => {
    // This catches destructive session reset without confirmation or Settings loss.
    await uploadReviewedFile(services());
    fireEvent.change(screen.getByLabelText("Custom requirements"), { target: { value: "Keep terminology." } });
    const restart = screen.getByRole("button", { name: "New session" });
    fireEvent.click(restart);
    const dialog = screen.getByRole("dialog", { name: "Start a new session?" });
    expect(dialog).toHaveTextContent(/uploaded files.*progress.*built package/i);
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" })); });
    expect(screen.getByDisplayValue("Source text")).toBeInTheDocument();
    expect(restart).toHaveFocus();

    fireEvent.click(restart);
    fireEvent.click(screen.getByRole("button", { name: "Start new session" }));
    expect(screen.queryByDisplayValue("Source text")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Custom requirements")).toHaveValue("Keep terminology.");
    expect(screen.getByRole("button", { name: "Add files" })).toHaveFocus();
    expect(screen.getByText("New session ready. Settings kept.")).toBeInTheDocument();
  });

  it("exposes branded Info on desktop with exact deliberate creator links", () => {
    // This catches missing identity/version or links drifting outside the privacy navigation allowlist.
    render(<App services={services()} />);
    const infoButton = screen.getByRole("button", { name: "Info" });
    fireEvent.click(infoButton);
    const dialog = screen.getByRole("dialog", { name: "About reword-nerd" });
    expect(within(dialog).getByText("reword-nerd v0.5.1")).toBeInTheDocument();
    expect(within(dialog).getByRole("img", { name: /reword-nerd logo/i })).toBeInTheDocument();
    const repository = within(dialog).getByRole("link", { name: "Repository" });
    const creator = within(dialog).getByRole("region", { name: "Built by Ryan Kamp" });
    expect(creator).not.toContainElement(repository);
    expect(within(creator).getByRole("link", { name: "Ryan Kamp" })).toHaveAttribute("href", "https://ryanjosephkamp.github.io");
    expect(within(creator).getByRole("link", { name: "GitHub profile" })).toHaveAttribute("href", "https://github.com/ryanjosephkamp/");
    const links = {
      Repository: "https://github.com/ryanjosephkamp/reword-nerd",
      "GitHub profile": "https://github.com/ryanjosephkamp/",
      Website: "https://ryanjosephkamp.github.io",
      Sponsor: "https://github.com/sponsors/ryanjosephkamp",
    };
    for (const [name, href] of Object.entries(links)) {
      expect(within(dialog).getByRole("link", { name })).toHaveAttribute("href", href);
      expect(within(dialog).getByRole("link", { name })).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("resets the open Help chapter after Help is dismissed and reopened", () => {
    render(<App services={services()} />);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.click(screen.getByRole("button", { name: "WATCH SETTINGS DEMO" }));
    expect(screen.getByLabelText("Settings demonstration")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close help" }));
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.queryByLabelText("Settings demonstration")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "WATCH SETTINGS DEMO" })).toHaveAttribute("aria-expanded", "false");
  });

  it("preserves spaces and returns while editing global and per-file requirements", async () => {
    // This catches binding a controlled textarea to normalized settings, which erases trailing input on every render.
    await uploadReviewedFile(services());
    const requirements = screen.getByLabelText("Custom requirements");
    const outputLanguage = screen.getByLabelText("Output language");

    fireEvent.change(requirements, { target: { value: "  Preserve citations.  \n\nKeep this paragraph.  " } });
    fireEvent.change(outputLanguage, { target: { value: " English " } });

    expect(requirements).toHaveValue("  Preserve citations.  \n\nKeep this paragraph.  ");
    expect(outputLanguage).toHaveValue(" English ");

    fireEvent.click(screen.getByRole("switch", { name: "PER-FILE OVERRIDE" }));
    fireEvent.change(requirements, { target: { value: "  File rule.\n\n  Second line.  " } });

    expect(requirements).toHaveValue("  File rule.\n\n  Second line.  ");
  });

  it("explains that Custom model includes local and self-hosted runtimes", () => {
    render(<App services={services()} />);
    fireEvent.change(screen.getByLabelText("Model profile"), { target: { value: "custom" } });

    expect(screen.getByText(/local, self-hosted, fine-tuned, or otherwise unlisted/i)).toBeInTheDocument();
  });

  it("uses the v0.4 processing defaults and reprocesses after an explicit page-capture or OCR change", async () => {
    // This catches embedded-image extraction becoming default-off, optional expensive processing becoming implicit, or changes failing to reach extraction.
    const extract = vi.fn(services().extract);
    render(<App services={services({ extract })} />);
    fireEvent.change(screen.getByLabelText("Add supported files"), {
      target: { files: [new File(["Source text"], "notes.md")] },
    });
    await screen.findByDisplayValue("Source text");
    expect(extract).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      extractEmbeddedImages: true,
      capturePageVisuals: false,
      ocrMode: "off",
    }), expect.any(AbortSignal), expect.any(Function));

    fireEvent.click(screen.getByLabelText("Capture PDF page visuals"));
    await waitFor(() => expect(extract).toHaveBeenCalledTimes(2));
    expect(extract).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      extractEmbeddedImages: true,
      capturePageVisuals: true,
      ocrMode: "off",
    }), expect.any(AbortSignal), expect.any(Function));
  });

  it("reviews pending OCR before confirmation and merges only the accepted edited candidate", async () => {
    // This catches OCR entering reviewed source without explicit disposition or losing the user's correction.
    const extract = vi.fn(async (accepted: Parameters<WorkbenchServices["extract"]>[0]) => ({
      format: accepted.format,
      extractedText: "Native source",
      warnings: ["Review every OCR candidate before confirming the extraction."],
      originalHash: "original-hash",
      extractedTextHash: "text-hash",
      requiresReview: true,
      ocrCandidates: [{
        id: "ocr-page-2",
        source: { kind: "page" as const, pageNumber: 2 },
        text: "raw scan",
        reviewedText: "raw scan",
        confidence: 72,
        status: "pending" as const,
        engine: "tesseract.js" as const,
        engineVersion: "7.0.0",
        languageCode: "eng",
        languageHash: "language-hash",
      }],
    }));
    render(<App services={services({ extract })} />);
    fireEvent.change(screen.getByLabelText("Add supported files"), { target: { files: [new File(["x"], "scan.pdf")] } });
    await screen.findByLabelText("Reviewed OCR text for Page 2");
    expect(screen.getByRole("button", { name: "Confirm review" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reviewed OCR text for Page 2"), { target: { value: "corrected scan" } });
    fireEvent.click(screen.getByRole("button", { name: "Accept OCR" }));
    await waitFor(() => expect((screen.getByLabelText("Extracted text for scan.pdf") as HTMLTextAreaElement).value).toContain("corrected scan"));
    expect(screen.getByRole("button", { name: "Confirm review" })).toBeEnabled();
  });

  it("mounts the complete accessible workbench shell and upload affordances", () => {
    render(<App services={services()} />);

    expect(screen.getByRole("main", { name: "reword_nerd workbench" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "reword_nerd/" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Extracted text preview" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Parameters" })).toBeInTheDocument();
    expect(screen.getByLabelText("Add supported files")).toHaveAttribute(
      "accept",
      ".txt,.md,.markdown,.docx,.pdf,.tex,.ltx,.zip",
    );
    expect(screen.getByRole("button", { name: "Add files" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start with files" })).not.toHaveAttribute("hidden");
  });

  it("binds each mobile tab to one tabpanel and hides every inactive panel", () => {
    window.matchMedia = vi.fn((query: string) => ({
      matches: query.includes("767px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    render(<App services={services()} />);

    for (const name of ["files", "preview", "settings"] as const) {
      const tab = screen.getByRole("tab", { name: name === "preview" ? "REVIEW" : name.toUpperCase() });
      const panel = document.getElementById(`panel-${name}`);
      expect(tab).toHaveAttribute("aria-controls", `panel-${name}`);
      expect(panel).toHaveAttribute("role", "tabpanel");
      expect(panel).toHaveAttribute("aria-labelledby", `tab-${name}`);
      expect(panel).not.toHaveAttribute("aria-label");
      if (name === "files") expect(panel).not.toHaveAttribute("hidden");
      else expect(panel).toHaveAttribute("hidden");
    }
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", "panel-files");

    fireEvent.click(screen.getByRole("tab", { name: "REVIEW" }));
    expect(document.getElementById("panel-files")).toHaveAttribute("hidden");
    expect(document.getElementById("panel-preview")).not.toHaveAttribute("hidden");
    expect(document.getElementById("panel-settings")).toHaveAttribute("hidden");
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", "panel-preview");
  });

  it("retains labeled region semantics for every panel at tablet width", () => {
    window.matchMedia = vi.fn((query: string) => ({
      matches: query.includes("1279px") && !query.includes("767px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    render(<App services={services()} />);

    const expected = [
      ["panel-files", "Files"],
      ["panel-preview", "Extracted text preview"],
      ["panel-settings", "Parameters"],
    ] as const;
    for (const [id, label] of expected) {
      const panel = document.getElementById(id);
      expect(panel).toHaveAttribute("role", "region");
      expect(panel).toHaveAttribute("aria-label", label);
      expect(panel).not.toHaveAttribute("aria-labelledby");
      expect(panel).not.toHaveAttribute("hidden");
    }
  });

  it("hides the empty upload call to action only after a document is admitted", async () => {
    render(<App services={services()} />);
    const filesPanel = screen.getByRole("region", { name: "Files" });
    const emptyUpload = screen.getByRole("button", { name: "Start with files" });
    expect(filesPanel).not.toHaveClass("has-documents");
    expect(emptyUpload).not.toHaveAttribute("hidden");

    fireEvent.change(screen.getByLabelText("Add supported files"), {
      target: { files: [new File(["Source text"], "notes.md")] },
    });
    await screen.findByDisplayValue("Source text");
    expect(filesPanel).toHaveClass("has-documents");
    expect(emptyUpload).toHaveAttribute("hidden");
  });

  it("serializes overlapping admissions so each preflight sees reserved capacity", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const capacities: number[] = [];
    let calls = 0;
    const testServices = services({
      preflight: async (files, capacity) => {
        const acceptedCount = capacity.acceptedCount ?? 0;
        capacities.push(acceptedCount);
        calls += 1;
        if (calls === 1) await firstGate;
        return files.map((file, index) => acceptedCount + index < 20 ? {
          accepted: true as const,
          file,
          format: "markdown" as const,
          originalBytes: new TextEncoder().encode(file.name).buffer,
        } : {
          accepted: false as const,
          file,
          issue: { code: "MAX_FILE_COUNT" as const, message: "The 20-file session limit has been reached." },
        });
      },
      extract: async (accepted) => ({
        format: accepted.format,
        extractedText: accepted.file.name,
        warnings: [],
        originalHash: `original:${accepted.file.name}`,
        extractedTextHash: `text:${accepted.file.name}`,
        requiresReview: true,
      }),
    });
    render(<App services={testServices} />);
    const input = screen.getByLabelText("Add supported files");
    const first = Array.from({ length: 15 }, (_, index) => new File(["a"], `first-${index}.md`));
    const second = Array.from({ length: 10 }, (_, index) => new File(["b"], `second-${index}.md`));
    fireEvent.change(input, { target: { files: first } });
    await waitFor(() => expect(capacities).toEqual([0]));
    fireEvent.change(input, { target: { files: second } });
    expect(capacities).toEqual([0]);

    await act(async () => { releaseFirst(); });
    await waitFor(() => expect(capacities).toEqual([0, 15]));
    await waitFor(() => expect(within(screen.getByRole("listbox", { name: "Uploaded files" })).getAllByRole("option")).toHaveLength(20));
    expect(await screen.findAllByText(/20-file session limit/)).toHaveLength(5);
  });

  it("drops an intake that was queued before a new session reset", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let calls = 0;
    const preflight = vi.fn(async (files: readonly File[]) => {
      calls += 1;
      if (calls === 1) await firstGate;
      return files.map((file) => ({
        accepted: true as const,
        file,
        format: "markdown" as const,
        originalBytes: new TextEncoder().encode(file.name).buffer,
      }));
    });
    render(<App services={services({ preflight })} />);
    const input = screen.getByLabelText("Add supported files");
    fireEvent.change(input, { target: { files: [new File(["a"], "first.md")] } });
    await waitFor(() => expect(preflight).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { files: [new File(["b"], "queued-before-reset.md")] } });

    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    fireEvent.click(screen.getByRole("button", { name: "Start new session" }));
    await act(async () => { releaseFirst(); await firstGate; });
    await waitFor(() => expect(within(screen.getByRole("listbox", { name: "Uploaded files" })).queryAllByRole("option")).toHaveLength(0));
    expect(preflight).toHaveBeenCalledTimes(1);
  });

  it("admits a bubbling drop through exactly one intake boundary", async () => {
    const preflight = vi.fn(services().preflight);
    const { container } = render(<App services={services({ preflight })} />);
    const dropZone = container.querySelector<HTMLElement>(".upload-drop-zone");
    expect(dropZone).not.toBeNull();

    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [new File(["Source text"], "dropped.md")] },
    });

    await screen.findByDisplayValue("Source text");
    expect(preflight).toHaveBeenCalledTimes(1);
    expect(within(screen.getByRole("listbox", { name: "Uploaded files" })).getAllByRole("option")).toHaveLength(1);
  });

  it("builds an in-memory package, previews it, and downloads only on explicit activation", async () => {
    const buildPackage = vi.fn(services().buildPackage);
    const download = vi.fn(() => ({ ok: true as const }));
    const testServices = services({ buildPackage, download });

    await uploadReviewedFile(testServices);
    const buildButton = screen.getByRole("button", { name: "BUILD PACKAGE" });
    expect(buildButton).toBeEnabled();
    fireEvent.click(buildButton);

    expect((await screen.findAllByText("Package ready.")).length).toBeGreaterThanOrEqual(1);
    expect(buildPackage).toHaveBeenCalledTimes(1);
    expect(download).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "PACKAGE PREVIEW" })).toHaveFocus();
    expect(screen.getByText(/Run each stage in order\./)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "RUNBOOK" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "ONE-SHOT" }));
    expect(screen.getByRole("textbox", { name: "Editable One-shot prompt" })).toHaveValue(
      "ONE-SHOT PROMPT\nSource text",
    );

    let copiedText = "";
    const previousExecCommand = document.execCommand;
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => {
        copiedText = document.querySelector<HTMLTextAreaElement>('textarea[aria-hidden="true"]')?.value ?? "";
        return true;
      }),
    });
    const copyButton = screen.getByRole("button", { name: "COPY ONE-SHOT PROMPT" });
    copyButton.focus();
    fireEvent.click(copyButton);
    expect(await screen.findByText("One-shot prompt copied.")).toBeInTheDocument();
    expect(copiedText).toBe("ONE-SHOT PROMPT\nSource text");
    expect(copyButton).toHaveFocus();
    Object.defineProperty(document, "execCommand", { configurable: true, value: previousExecCommand });

    const zipDownload = screen.getByRole("button", { name: "DOWNLOAD ZIP" });
    zipDownload.focus();
    fireEvent.click(zipDownload);

    expect((await screen.findAllByText("Package downloaded.")).length).toBeGreaterThanOrEqual(1);
    expect(download).toHaveBeenCalledTimes(1);
    expect(zipDownload).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "SOURCE" }));
    expect(screen.getByDisplayValue("Source text")).toBeInTheDocument();
  });

  it("invalidates the built preview and download when settings change", async () => {
    await uploadReviewedFile(services());
    fireEvent.click(screen.getByRole("button", { name: "BUILD PACKAGE" }));
    await screen.findByRole("heading", { name: "PACKAGE PREVIEW" });
    expect(screen.getByRole("button", { name: "DOWNLOAD ZIP" })).toBeEnabled();
    fireEvent.click(screen.getByRole("tab", { name: "ONE-SHOT" }));
    fireEvent.change(screen.getByRole("textbox", { name: "One-shot final document and compact audit" }), {
      target: { value: "obsolete workbook response" },
    });

    const requirements = screen.getByLabelText("Custom requirements");
    requirements.focus();
    fireEvent.change(requirements, {
      target: { value: "A new package requirement" },
    });

    expect(screen.getByRole("heading", { name: "EXTRACTED_TEXT" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PACKAGE" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "DOWNLOAD ZIP" })).toBeDisabled();
    expect(requirements).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "BUILD PACKAGE" }));
    fireEvent.click(await screen.findByRole("tab", { name: "ONE-SHOT" }));
    expect(await screen.findByRole("textbox", { name: "One-shot final document and compact audit" })).toHaveValue("");
  });

  it("preserves workbook progress across non-invalidating Source and Assets navigation", async () => {
    await uploadReviewedFile(services());
    fireEvent.click(screen.getByRole("button", { name: "BUILD PACKAGE" }));
    await screen.findByRole("heading", { name: "PACKAGE PREVIEW" });
    fireEvent.click(screen.getByRole("tab", { name: "MANUAL" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Stage 1 — Decompose model response" }), {
      target: { value: "retained analysis" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Editable Stage 2 — Rewrite prompt" }), {
      target: { value: "retained local rewrite edit" },
    });

    fireEvent.click(screen.getByRole("button", { name: "SOURCE" }));
    expect(screen.getByDisplayValue("Source text")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ASSETS" }));
    expect(screen.getByText("No extracted visual assets.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "PACKAGE" }));

    expect(screen.getByRole("tab", { name: "MANUAL" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("textbox", { name: "Stage 1 — Decompose model response" })).toHaveValue("retained analysis");
    expect(screen.getByRole("textbox", { name: "Editable Stage 2 — Rewrite prompt" })).toHaveValue(
      "retained local rewrite edit",
    );
  });

  it("switches package documents without conflating the selected workflow", async () => {
    const testServices = services({
      buildPackage: async () => {
        const workbooks = [workbook("one", "one.md"), workbook("two", "two.md")];
        return {
          ok: true,
          blob: new Blob(["zip"]),
          filename: "reword-nerd-prompt-package.zip",
          manifest: {} as never,
          workbooks,
          artifacts: workbooks,
        };
      },
    });
    render(<App services={testServices} />);
    fireEvent.change(screen.getByLabelText("Add supported files"), {
      target: { files: [new File(["one"], "one.md"), new File(["two"], "two.md")] },
    });
    await screen.findByDisplayValue("Source text");
    fireEvent.click(screen.getByRole("button", { name: "Confirm review" }));
    fireEvent.click(screen.getByRole("option", { name: /two\.md/ }));
    await screen.findByDisplayValue("Source text");
    fireEvent.click(screen.getByRole("button", { name: "Confirm review" }));
    fireEvent.click(screen.getByRole("button", { name: "BUILD PACKAGE" }));

    const artifactSelect = await screen.findByRole("combobox", { name: "Package document" });
    expect(screen.getByRole("heading", { name: "one.md" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "MANUAL" }));
    artifactSelect.focus();
    fireEvent.change(artifactSelect, { target: { value: "two" } });
    expect(screen.getByRole("heading", { name: "two.md" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "MANUAL" })).toHaveAttribute("aria-selected", "true");
    expect(artifactSelect).toHaveFocus();
  });

  it("retains reviewed session state on safe export failure", async () => {
    const testServices = services({
      buildPackage: async () => ({
        ok: false,
        error: { code: "ARCHIVE_GENERATION_FAILED", message: "internal detail" },
      }),
    });
    await uploadReviewedFile(testServices);

    fireEvent.click(screen.getByRole("button", { name: "BUILD PACKAGE" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Package could not be generated. Your session is still available.",
    );
    expect(screen.getByDisplayValue("Source text")).toBeInTheDocument();
  });

  it("retries a retained package download only from a later explicit activation", async () => {
    const buildPackage = vi.fn(services().buildPackage);
    const download = vi
      .fn()
      .mockReturnValueOnce({
        ok: false as const,
        error: { code: "ARCHIVE_GENERATION_FAILED" as const, message: "download detail" },
      })
      .mockReturnValueOnce({ ok: true as const });
    await uploadReviewedFile(services({ buildPackage, download }));

    const buildButton = screen.getByRole("button", { name: "BUILD PACKAGE" });
    fireEvent.click(buildButton);
    await screen.findAllByText("Package ready.");
    fireEvent.click(screen.getByRole("button", { name: "DOWNLOAD ZIP" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "DOWNLOAD ZIP" }));

    expect((await screen.findAllByText("Package downloaded.")).length).toBeGreaterThanOrEqual(1);
    expect(buildPackage).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("supports tab arrow navigation and an Escape-dismissable help dialog", () => {
    render(<App services={services()} />);
    const filesTab = screen.getByRole("tab", { name: "FILES" });
    filesTab.focus();
    fireEvent.keyDown(filesTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "REVIEW" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "REVIEW" })).toHaveFocus();

    const helpButton = screen.getByRole("button", { name: "Help" });
    fireEvent.click(helpButton);
    expect(screen.getByRole("dialog", { name: "Help and workflow guide" })).toHaveTextContent(
      "One-shot and Manual",
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(helpButton).toHaveFocus();
  });

  it("contains keyboard focus inside modal help and settings surfaces", () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn((query: string) => ({
      matches: query.includes("1279px") && !query.includes("767px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    render(<App services={services()} />);

    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    const help = screen.getByRole("dialog", { name: "Help and workflow guide" });
    fireEvent.keyDown(help, { key: "Tab" });
    const closeHelp = screen.getByRole("button", { name: "Close help" });
    expect(closeHelp).toHaveFocus();
    fireEvent.keyDown(closeHelp, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "REPLAY QUICK START" })).toHaveFocus();
    fireEvent.click(closeHelp);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const settings = screen.getByRole("dialog", { name: "Parameters" });
    const closeSettings = screen.getByRole("button", { name: "Close settings" });
    const lastSettingsControl = within(settings).getByRole("button", { name: "Reset saved preferences" });
    expect(closeSettings).toHaveFocus();
    fireEvent.keyDown(closeSettings, { key: "Tab", shiftKey: true });
    expect(lastSettingsControl).toHaveFocus();
    fireEvent.keyDown(lastSettingsControl, { key: "Tab" });
    expect(closeSettings).toHaveFocus();
    window.matchMedia = originalMatchMedia;
  });

  it("keeps both Settings and Help reachable from the mobile menu", () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn((query: string) => ({
      matches: query.includes("767px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    render(<App services={services()} />);
    const menu = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(menu);
    fireEvent.click(within(screen.getByLabelText("Mobile utilities")).getByRole("button", { name: "Help" }));
    expect(screen.getByRole("dialog", { name: "Help and workflow guide" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close help" }));
    expect(menu).toHaveFocus();

    fireEvent.click(menu);
    fireEvent.click(within(screen.getByLabelText("Mobile utilities")).getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("tab", { name: "SETTINGS" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "SETTINGS" })).toHaveFocus();
    window.matchMedia = originalMatchMedia;
  });

  it("dismisses utility and file-action menus with outside activation or Escape", async () => {
    render(<App services={services()} />);
    const utility = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(utility);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByLabelText("Mobile utilities")).not.toBeInTheDocument();

    fireEvent.click(utility);
    fireEvent.keyDown(screen.getByLabelText("Mobile utilities"), { key: "Escape" });
    expect(screen.queryByLabelText("Mobile utilities")).not.toBeInTheDocument();
    expect(utility).toHaveFocus();

    fireEvent.change(screen.getByLabelText("Add supported files"), {
      target: { files: [new File(["Source text"], "notes.md")] },
    });
    await screen.findByDisplayValue("Source text");
    const fileActions = screen.getByRole("button", { name: "File actions for notes.md" });
    fireEvent.click(fileActions);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("button", { name: "Remove file" })).not.toBeInTheDocument();

    fireEvent.click(fileActions);
    fireEvent.keyDown(screen.getByLabelText("Actions for notes.md"), { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Remove file" })).not.toBeInTheDocument();
    expect(fileActions).toHaveFocus();
  });

  it("announces rejection issues in input order without persisting session state", async () => {
    const storageSpies = [
      vi.spyOn(window.localStorage, "setItem"),
      vi.spyOn(window.localStorage, "removeItem"),
    ];
    render(<App services={services({
      preflight: async (files) => files.map((file) => ({
        accepted: false as const,
        file,
        issue: { code: "UNSUPPORTED_EXTENSION" as const, message: "This file type is not supported." },
      })),
    })} />);
    const input = screen.getByLabelText("Add supported files");
    fireEvent.change(input, {
      target: { files: [new File(["a"], "one.exe"), new File(["b"], "two.exe")] },
    });

    const issues = await screen.findAllByText(/This file type is not supported\./);
    expect(issues.map((item) => item.textContent)).toEqual([
      "one.exe: This file type is not supported.",
      "two.exe: This file type is not supported.",
    ]);
    storageSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  it("registers beforeunload only while the session is dirty", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<App services={services()} />);

    expect(add.mock.calls.some(([type]) => type === "beforeunload")).toBe(false);
    fireEvent.change(screen.getByLabelText("Add supported files"), {
      target: { files: [new File(["Source text"], "notes.md")] },
    });
    await waitFor(() => {
      expect(add.mock.calls.some(([type]) => type === "beforeunload")).toBe(true);
    });
    unmount();
    expect(remove.mock.calls.some(([type]) => type === "beforeunload")).toBe(true);
  });

  it("marks duplicates discovered within the same concurrent intake batch", async () => {
    const buildPackage = vi.fn(services().buildPackage);
    render(<App services={services({
      extract: async (accepted) => ({
        format: accepted.format,
        extractedText: accepted.file.name,
        warnings: [],
        originalHash: "same-original-hash",
        extractedTextHash: `hash-${accepted.file.name}`,
        requiresReview: true,
      }),
      buildPackage,
    })} />);
    fireEvent.change(screen.getByLabelText("Add supported files"), {
      target: { files: [new File(["a"], "one.md"), new File(["b"], "two.md")] },
    });
    await screen.findByDisplayValue("one.md");
    fireEvent.click(screen.getByRole("button", { name: "Confirm review" }));
    fireEvent.click(await screen.findByRole("option", { name: /two\.md/ }));
    await screen.findByDisplayValue("two.md");
    fireEvent.click(screen.getByRole("button", { name: "Confirm review" }));
    fireEvent.click(screen.getByRole("button", { name: "BUILD PACKAGE" }));
    await waitFor(() => expect(buildPackage).toHaveBeenCalledTimes(1));

    const exported = buildPackage.mock.calls[0][0];
    expect(exported[1].warnings).toContain("This file duplicates an existing document and needs review.");
  });

  it("reserves ordinals and duplicate hashes across immediately queued intake batches", async () => {
    const buildPackage = vi.fn(services().buildPackage);
    render(<App services={services({
      extract: async (accepted) => ({
        format: accepted.format,
        extractedText: accepted.file.name,
        warnings: [],
        originalHash: "cross-batch-hash",
        extractedTextHash: `text:${accepted.file.name}`,
        requiresReview: true,
      }),
      buildPackage,
    })} />);
    const input = screen.getByLabelText("Add supported files");
    fireEvent.change(input, { target: { files: [new File(["a"], "first.md")] } });
    fireEvent.change(input, { target: { files: [new File(["b"], "second.md")] } });

    fireEvent.click(await screen.findByRole("option", { name: /first\.md/ }));
    await screen.findByDisplayValue("first.md");
    fireEvent.click(screen.getByRole("button", { name: "Confirm review" }));
    fireEvent.click(await screen.findByRole("option", { name: /second\.md/ }));
    await screen.findByDisplayValue("second.md");
    fireEvent.click(screen.getByRole("button", { name: "Confirm review" }));
    fireEvent.click(screen.getByRole("button", { name: "BUILD PACKAGE" }));
    await waitFor(() => expect(buildPackage).toHaveBeenCalledTimes(1));

    const exported = buildPackage.mock.calls[0][0];
    expect(exported.map((document) => document.uploadOrdinal)).toEqual([0, 1]);
    expect(exported[1].warnings).toContain("This file duplicates an existing document and needs review.");
  });

  it("retries one transient edited-text hash failure before review can be confirmed", async () => {
    const hashText = vi.fn()
      .mockRejectedValueOnce(new Error("transient-1"))
      .mockRejectedValueOnce(new Error("transient-2"))
      .mockResolvedValueOnce("recovered-hash");
    render(<App services={services({ hashText })} />);
    fireEvent.change(screen.getByLabelText("Add supported files"), {
      target: { files: [new File(["Source text"], "notes.md")] },
    });
    const editor = await screen.findByDisplayValue("Source text");
    fireEvent.change(editor, { target: { value: "Edited text" } });

    await waitFor(() => expect(hashText).toHaveBeenCalledTimes(2));
    const confirm = screen.getByRole("button", { name: "Confirm review" });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect((await screen.findAllByText("Review complete")).length).toBeGreaterThanOrEqual(1);
    expect(hashText).toHaveBeenCalledTimes(3);
  });

  it("opens an explicit file-actions menu before removal", async () => {
    render(<App services={services()} />);
    fireEvent.change(screen.getByLabelText("Add supported files"), {
      target: { files: [new File(["Source text"], "notes.md")] },
    });
    await screen.findByDisplayValue("Source text");
    expect(screen.queryByRole("button", { name: "Remove file" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "File actions for notes.md" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove file" }));
    expect(screen.queryByRole("option", { name: /notes\.md/ })).not.toBeInTheDocument();
  });

  it("uses the mobile selected-file disclosure to return to Files", async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn((query: string) => ({
      matches: query.includes("767px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    render(<App services={services()} />);
    fireEvent.change(screen.getByLabelText("Add supported files"), {
      target: { files: [new File(["Source text"], "notes.md")] },
    });
    await screen.findByDisplayValue("Source text");
    expect(screen.getByRole("tab", { name: "REVIEW" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Selected file notes.md" }));
    expect(screen.getByRole("tab", { name: "FILES" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "FILES" })).toHaveFocus();
    fireEvent.click(screen.getByRole("option", { name: /notes\.md/ }));
    expect(screen.getByRole("tab", { name: "REVIEW" })).toHaveFocus();
    window.matchMedia = originalMatchMedia;
  });

  it("shows exact editor metrics and focuses Add files after the last removal", async () => {
    render(<App services={services()} />);
    fireEvent.change(screen.getByLabelText("Add supported files"), {
      target: { files: [new File(["Source text"], "notes.md")] },
    });
    await screen.findByDisplayValue("Source text");
    expect(screen.getByText("WORDS: 2")).toBeInTheDocument();
    expect(screen.getByText("CHARS: 11")).toBeInTheDocument();
    expect(screen.getByText("LINES: 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "File actions for notes.md" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove file" }));
    expect(screen.getByRole("button", { name: "Add files" })).toHaveFocus();
  });

  it("shows actionable validation and disables review for blank edited extraction", async () => {
    render(<App services={services()} />);
    fireEvent.change(screen.getByLabelText("Add supported files"), {
      target: { files: [new File(["Source text"], "notes.md")] },
    });
    const editor = await screen.findByDisplayValue("Source text");
    fireEvent.change(editor, { target: { value: " \n\t " } });

    expect(editor).toHaveAttribute("aria-invalid", "true");
    expect(editor).toHaveAttribute("aria-describedby", "extracted-text-error-document-1");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Extracted text cannot be blank. Add text or remove the file.",
    );
    expect(screen.getByRole("button", { name: "Confirm review" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "BUILD PACKAGE" })).toBeDisabled();
  });

  it("keeps queued and extracting documents non-editable until extraction succeeds", async () => {
    let finishExtraction!: (result: Awaited<ReturnType<WorkbenchServices["extract"]>>) => void;
    const extraction = new Promise<Awaited<ReturnType<WorkbenchServices["extract"]>>>((resolve) => {
      finishExtraction = resolve;
    });
    render(<App services={services({ extract: () => extraction })} />);
    fireEvent.change(screen.getByLabelText("Add supported files"), {
      target: { files: [new File(["Source text"], "slow.md")] },
    });

    expect(await screen.findByRole("status")).toHaveTextContent("Extracting text from slow.md…");
    expect(screen.queryByRole("textbox", { name: "Extracted text for slow.md" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm review" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "BUILD PACKAGE" })).toBeDisabled();

    await act(async () => {
      finishExtraction({
        format: "markdown",
        extractedText: "Extracted text",
        warnings: [],
        originalHash: "slow-original",
        extractedTextHash: "slow-text",
        requiresReview: true,
      });
    });
    expect(await screen.findByDisplayValue("Extracted text")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm review" })).toBeEnabled();
  });

  it("shows every safe extraction warning before review without rewriting it", async () => {
    const warnings = [
      "An embedded image was omitted from DOCX extraction.",
      "Page 2 does not contain selectable text.",
      "This file duplicates an existing document and needs review.",
    ];
    render(<App services={services({
      extract: async (accepted) => ({
        format: accepted.format,
        extractedText: "Source text",
        warnings,
        originalHash: "warning-original",
        extractedTextHash: "warning-text",
        requiresReview: true,
      }),
    })} />);
    fireEvent.change(screen.getByLabelText("Add supported files"), {
      target: { files: [new File(["Source text"], "warnings.docx")] },
    });

    await screen.findByDisplayValue("Source text");
    const warningRegion = screen.getByRole("region", { name: "Extraction warnings for warnings.docx" });
    expect(within(warningRegion).getAllByRole("listitem").map((item) => item.textContent)).toEqual(warnings);
    expect(screen.getByRole("button", { name: "Confirm review" })).toBeEnabled();
  });

  it("routes mobile Preview removal to Files and focuses the adjacent document", async () => {
    window.matchMedia = vi.fn((query: string) => ({
      matches: query.includes("767px"), media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(),
      removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
    render(<App services={services({
      extract: async (accepted) => ({
        format: accepted.format,
        extractedText: accepted.file.name,
        warnings: [],
        originalHash: `original:${accepted.file.name}`,
        extractedTextHash: `text:${accepted.file.name}`,
        requiresReview: true,
      }),
    })} />);
    fireEvent.change(screen.getByLabelText("Add supported files"), {
      target: { files: [new File(["one"], "one.md"), new File(["two"], "two.md")] },
    });
    await screen.findByDisplayValue("one.md");

    fireEvent.click(screen.getByRole("button", { name: "Remove one.md" }));

    expect(screen.getByRole("tab", { name: "FILES" })).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById("panel-files")).not.toHaveAttribute("hidden");
    await waitFor(() => expect(screen.getByRole("option", { name: /two\.md/ })).toHaveFocus());
  });

  it("routes removal of the last blocked mobile document to Files and Add files", async () => {
    window.matchMedia = vi.fn((query: string) => ({
      matches: query.includes("767px"), media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(),
      removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
    render(<App services={services({ extract: async () => { throw new Error("unsafe"); } })} />);
    fireEvent.change(screen.getByLabelText("Add supported files"), {
      target: { files: [new File(["one"], "blocked.md")] },
    });
    await screen.findByText("This file could not be extracted safely.");

    fireEvent.click(screen.getByRole("button", { name: "Remove file" }));

    expect(screen.getByRole("tab", { name: "FILES" })).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById("panel-files")).not.toHaveAttribute("hidden");
    await waitFor(() => expect(screen.getByRole("button", { name: "Add files" })).toHaveFocus());
  });

  it("retries a blocked extraction without discarding the original", async () => {
    const extract = vi.fn()
      .mockRejectedValueOnce(new Error("unsafe detail"))
      .mockResolvedValueOnce({
        format: "markdown" as const,
        extractedText: "Recovered text",
        warnings: [],
        originalHash: "original-hash",
        extractedTextHash: "text-hash",
        requiresReview: true,
      });
    render(<App services={services({ extract })} />);
    fireEvent.change(screen.getByLabelText("Add supported files"), {
      target: { files: [new File(["Source text"], "notes.md")] },
    });
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry extraction" }));
    expect(await screen.findByDisplayValue("Recovered text")).toBeInTheDocument();
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it("preserves ready, review, and blocked counts in the summary", async () => {
    window.matchMedia = vi.fn((query: string) => ({
      matches: query.includes("767px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const { container } = render(<App services={services({
      extract: async (accepted) => {
        if (accepted.file.name === "blocked.md") throw new Error("blocked");
        return {
          format: accepted.format,
          extractedText: accepted.file.name,
          warnings: [],
          originalHash: accepted.file.name,
          extractedTextHash: `hash-${accepted.file.name}`,
          requiresReview: true,
        };
      },
    })} />);
    fireEvent.change(screen.getByLabelText("Add supported files"), {
      target: { files: [new File(["a"], "review.md"), new File(["b"], "blocked.md")] },
    });
    await waitFor(() => expect(screen.getAllByText("1 review").length).toBeGreaterThanOrEqual(1));
    expect(screen.getAllByText("1 blocked").length).toBeGreaterThanOrEqual(1);
    const compact = container.querySelector<HTMLElement>(".status-summary.compact");
    expect(compact).not.toBeNull();
    expect(within(compact!).getByText("2 files")).toBeInTheDocument();
    expect(within(compact!).getByText("0 ready")).toBeInTheDocument();
    expect(within(compact!).getByText("1 review")).toBeInTheDocument();
    expect(within(compact!).getByText("1 blocked")).toBeInTheDocument();
    expect(within(compact!).queryByText("•")).not.toBeInTheDocument();
  });
});
