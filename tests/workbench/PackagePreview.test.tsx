import { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PackagePreview } from "../../src/app/workbench/components/PackagePreview";
import {
  parseWorkbookProgressHtml,
  type DocumentWorkbook,
} from "../../src/export";

function workbook(documentKey = "notes", originalDisplayName = "notes.md"): DocumentWorkbook {
  const promptBlocks = [
    { stage: "decompose" as const, title: "Stage 1 — Decompose", content: "DECOMPOSE\nSource text" },
    { stage: "rewrite" as const, title: "Stage 2 — Rewrite", content: "REWRITE\n<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>" },
    { stage: "verify" as const, title: "Stage 3 — Verify", content: "VERIFY\n<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>\n<<<INSERT_STAGE_2_REWRITE_RESPONSE>>>" },
    { stage: "final" as const, title: "Stage 4 — Final", content: "FINAL\n<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>\n<<<INSERT_STAGE_2_REWRITE_RESPONSE>>>\n<<<INSERT_STAGE_3_VERIFICATION_RESPONSE>>>" },
  ];
  return {
    documentKey,
    originalDisplayName,
    runbook: {} as never,
    runbookMarkdown: "# reword-nerd prompt package\n\nRun each stage in order.",
    promptBundle: {
      oneShot: `ONE-SHOT\n${originalDisplayName}\nSource text`,
      manual: {
        decompose: promptBlocks[0].content,
        rewrite: promptBlocks[1].content,
        verify: promptBlocks[2].content,
        final: promptBlocks[3].content,
      },
    },
    promptBlocks,
    oneShot: {
      prompt: `ONE-SHOT\n${originalDisplayName}\nSource text`,
      markdown: "one-shot markdown",
      html: '<!doctype html><script data-generated-html="one-shot"></script>',
    },
    manual: {
      promptBlocks,
      markdown: "manual markdown",
      html: '<!doctype html><script data-generated-html="manual"></script>',
    },
    combined: {
      markdown: "combined markdown",
      html: '<!doctype html><script data-generated-html="combined"></script>',
      fullHtmlStatus: "not-generated",
    },
    markdown: "combined markdown",
    html: '<!doctype html><script data-generated-html="combined"></script>',
    fullHtmlStatus: "not-generated",
    visualAssets: [],
  };
}

type ProgressDownload = (html: string, filename: string) => { ok: true } | { ok: false };
type PromptCopy = (text: string) => Promise<"copied" | "select-manually">;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function PreviewHarness({
  workbooks = [workbook()],
  downloadProgressCopy = () => ({ ok: true as const }),
  copyPromptText,
}: {
  workbooks?: readonly DocumentWorkbook[];
  downloadProgressCopy?: ProgressDownload;
  copyPromptText?: PromptCopy;
}) {
  const [selectedDocumentKey, setSelectedDocumentKey] = useState<string | null>(workbooks[0]?.documentKey ?? null);
  const [workflow, setWorkflow] = useState<"one-shot" | "manual">("one-shot");

  const props = {
    workbooks,
    selectedDocumentKey,
    workflow,
    onSelect: setSelectedDocumentKey,
    onWorkflowChange: setWorkflow,
    downloadProgressCopy,
    copyPromptText,
  };
  return <PackagePreview {...props} />;
}

describe("PackagePreview workbook integration", () => {
  it("opens One-shot with accessible workflow tabs and copies the exact editable prompt", async () => {
    const previousExecCommand = document.execCommand;
    let copiedText = "";
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => {
        copiedText = document.querySelector<HTMLTextAreaElement>('textarea[aria-hidden="true"]')?.value ?? "";
        return true;
      }),
    });

    render(<PreviewHarness />);

    const tablist = screen.getByRole("tablist", { name: "Package workflow" });
    expect(within(tablist).getByRole("tab", { name: "ONE-SHOT" })).toHaveAttribute("aria-selected", "true");
    expect(within(tablist).getByRole("tab", { name: "MANUAL" })).toHaveAttribute("aria-selected", "false");
    const prompt = screen.getByRole("textbox", { name: "Editable One-shot prompt" });
    expect(prompt).toHaveValue("ONE-SHOT\nnotes.md\nSource text");
    fireEvent.change(prompt, { target: { value: "MY EXACT ONE-SHOT PROMPT" } });

    const copy = screen.getByRole("button", { name: "COPY ONE-SHOT PROMPT" });
    copy.focus();
    fireEvent.click(copy);

    expect(await screen.findByText("One-shot prompt copied.")).toBeInTheDocument();
    expect(copiedText).toBe("MY EXACT ONE-SHOT PROMPT");
    expect(copy).toHaveFocus();
    expect(document.querySelector("[data-generated-html]")).toBeNull();

    Object.defineProperty(document, "execCommand", { configurable: true, value: previousExecCommand });
  });

  it("reports an honest manual-copy fallback and still returns focus to the initiating button", async () => {
    const previousExecCommand = document.execCommand;
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });
    render(<PreviewHarness />);

    const copy = screen.getByRole("button", { name: "COPY ONE-SHOT PROMPT" });
    copy.focus();
    fireEvent.click(copy);

    expect(await screen.findByText(
      "Copy unavailable. Select the One-shot prompt text manually, then press Ctrl+C or Command+C.",
    )).toBeInTheDocument();
    expect(copy).toHaveFocus();
    Object.defineProperty(document, "execCommand", { configurable: true, value: previousExecCommand });
  });

  it("hydrates Manual prompts, preserves stale edits, and requires explicit Reapply or Reset", () => {
    render(<PreviewHarness />);
    const manualTab = screen.getByRole("tab", { name: "MANUAL" });
    fireEvent.click(manualTab);
    expect(manualTab).toHaveAttribute("aria-selected", "true");
    expect(manualTab).toHaveFocus();

    const rewritePrompt = screen.getByRole("textbox", { name: "Editable Stage 2 — Rewrite prompt" });
    const rewriteCopy = screen.getByRole("button", { name: "Copy Rewrite" });
    fireEvent.focus(rewritePrompt);
    expect(rewriteCopy).toBeDisabled();
    expect(screen.getByRole("button", { name: "COPY CURRENT MANUAL PROMPT" })).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox", { name: "Stage 1 — Decompose model response" }), {
      target: { value: "analysis one" },
    });
    expect(rewritePrompt).toHaveValue("REWRITE\nanalysis one");
    expect(rewriteCopy).toBeEnabled();
    expect(screen.getByRole("button", { name: "COPY CURRENT MANUAL PROMPT" })).toBeEnabled();

    fireEvent.change(rewritePrompt, { target: { value: "MY CAREFUL EDIT" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Stage 1 — Decompose model response" }), {
      target: { value: "analysis two" },
    });

    expect(rewritePrompt).toHaveValue("MY CAREFUL EDIT");
    expect(screen.getByText("Upstream responses changed. Review this preserved edit, then choose Reapply.")).toBeInTheDocument();
    const reapply = screen.getByRole("button", { name: "Reapply Rewrite prompt" });
    expect(reapply).toBeEnabled();
    fireEvent.click(reapply);
    expect(rewritePrompt).toHaveValue("REWRITE\nanalysis two");

    fireEvent.change(rewritePrompt, { target: { value: "ANOTHER EDIT" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset Rewrite prompt" }));
    expect(rewritePrompt).toHaveValue("REWRITE\nanalysis two");
    expect(screen.getByRole("textbox", { name: "Stage 4 — Final model response (optional for progress copy)" })).toBeEnabled();
  });

  it("keeps workflow and document selection distinct while retaining per-document progress", () => {
    render(<PreviewHarness workbooks={[workbook("one", "one.md"), workbook("two", "two.md")]} />);
    fireEvent.click(screen.getByRole("tab", { name: "MANUAL" }));
    const firstResponse = screen.getByRole("textbox", { name: "Stage 1 — Decompose model response" });
    fireEvent.change(firstResponse, { target: { value: "first document analysis" } });

    const selector = screen.getByRole("combobox", { name: "Package document" });
    selector.focus();
    fireEvent.change(selector, { target: { value: "two" } });
    expect(selector).toHaveFocus();
    expect(screen.getByRole("heading", { name: "two.md" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "MANUAL" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("textbox", { name: "Stage 1 — Decompose model response" })).toHaveValue("");

    fireEvent.change(selector, { target: { value: "one" } });
    expect(screen.getByRole("textbox", { name: "Stage 1 — Decompose model response" })).toHaveValue("first document analysis");
  });

  it("downloads the exact safe progress renderer through a separate adapter", async () => {
    const downloadProgressCopy = vi.fn<ProgressDownload>(() => ({ ok: true }));
    const sourceWorkbook = workbook();
    const storage = vi.spyOn(window.localStorage, "setItem");
    render(<PreviewHarness workbooks={[sourceWorkbook]} downloadProgressCopy={downloadProgressCopy} />);

    fireEvent.change(screen.getByRole("textbox", { name: "One-shot final document and compact audit" }), {
      target: { value: "one-shot result" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "MANUAL" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Stage 4 — Final model response (optional for progress copy)" }), {
      target: { value: "optional final response" },
    });
    const download = screen.getByRole("button", { name: "DOWNLOAD PROGRESS COPY" });
    download.focus();
    fireEvent.click(download);

    expect(downloadProgressCopy).toHaveBeenCalledTimes(1);
    const [html, filename] = downloadProgressCopy.mock.calls[0];
    expect(filename).toBe("notes-progress.html");
    expect(parseWorkbookProgressHtml(sourceWorkbook, html).responses).toMatchObject({
      oneShot: "one-shot result",
      final: "optional final response",
    });
    expect(await screen.findByText("Progress copy downloaded.")).toBeInTheDocument();
    await waitFor(() => expect(download).toHaveFocus());
    expect(storage).not.toHaveBeenCalled();
  });

  it("supports arrow navigation between the two workflow tabs", () => {
    render(<PreviewHarness />);
    const oneShot = screen.getByRole("tab", { name: "ONE-SHOT" });
    oneShot.focus();
    fireEvent.keyDown(oneShot, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "MANUAL" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "MANUAL" })).toHaveAttribute("aria-selected", "true");
  });

  it("ignores a delayed Copy completion after the package document changes", async () => {
    const pendingCopy = deferred<"copied" | "select-manually">();
    render(<PreviewHarness
      workbooks={[workbook("one", "one.md"), workbook("two", "two.md")]}
      copyPromptText={() => pendingCopy.promise}
    />);
    const copy = screen.getByRole("button", { name: "COPY ONE-SHOT PROMPT" });
    fireEvent.click(copy);

    const selector = screen.getByRole("combobox", { name: "Package document" });
    fireEvent.change(selector, { target: { value: "two" } });
    selector.focus();
    await act(async () => pendingCopy.resolve("copied"));

    expect(screen.getByRole("heading", { name: "two.md" })).toBeInTheDocument();
    expect(screen.queryByText("One-shot prompt copied.")).not.toBeInTheDocument();
    expect(selector).toHaveFocus();
  });

  it("ignores a delayed Copy completion after the package workflow changes", async () => {
    const pendingCopy = deferred<"copied" | "select-manually">();
    render(<PreviewHarness copyPromptText={() => pendingCopy.promise} />);
    fireEvent.click(screen.getByRole("button", { name: "COPY ONE-SHOT PROMPT" }));

    const manual = screen.getByRole("tab", { name: "MANUAL" });
    fireEvent.click(manual);
    await act(async () => pendingCopy.resolve("copied"));

    expect(manual).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("One-shot prompt copied.")).not.toBeInTheDocument();
    expect(manual).toHaveFocus();
  });

  it("ignores a delayed Copy completion after the active manual stage changes", async () => {
    const pendingCopy = deferred<"copied" | "select-manually">();
    render(<PreviewHarness copyPromptText={() => pendingCopy.promise} />);
    fireEvent.click(screen.getByRole("tab", { name: "MANUAL" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy Decompose" }));

    const rewritePrompt = screen.getByRole("textbox", { name: "Editable Stage 2 — Rewrite prompt" });
    rewritePrompt.focus();
    await act(async () => pendingCopy.resolve("copied"));

    expect(screen.queryByText("Decompose prompt copied.")).not.toBeInTheDocument();
    expect(rewritePrompt).toHaveFocus();
  });
});
