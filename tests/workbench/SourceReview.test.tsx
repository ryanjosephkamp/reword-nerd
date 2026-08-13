import { fireEvent, render, screen, within } from "@testing-library/react";

import { App } from "../../src/app/App";
import type { WorkbenchServices } from "../../src/app/workbench/contracts";
import { CURRENT_TUTORIAL_VERSION, PREFERENCES_STORAGE_KEY } from "../../src/app/workbench/preferences";

beforeEach(() => {
  window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
    version: 1,
    data: { tutorialVersion: CURRENT_TUTORIAL_VERSION },
  }));
});

afterEach(() => window.localStorage.clear());

function services(): WorkbenchServices {
  let nextId = 0;
  return {
    createDocumentId: () => `item-${nextId++}`,
    preflight: async (files) => Promise.all(files.map(async (file) => ({
      accepted: true as const,
      file,
      format: file.name.endsWith(".html") ? "html" as const : "markdown" as const,
      previewKind: file.name.endsWith(".html") ? "markup" as const : "markdown" as const,
      languageId: file.name.endsWith(".html") ? "html" : "markdown",
      originalBytes: await file.arrayBuffer(),
    }))),
    extract: async (accepted) => ({
      format: accepted.format,
      previewKind: accepted.previewKind,
      languageId: accepted.languageId,
      extractedText: "Reviewed source",
      warnings: [],
      originalHash: "original-hash",
      extractedTextHash: "reviewed-hash",
      requiresReview: true,
    }),
    hashText: async (text) => `hash:${text}`,
    buildPackage: async () => ({ ok: false, error: { code: "INVALID_INPUT", message: "unused" } }),
    download: () => ({ ok: true }),
    downloadProgressCopy: () => ({ ok: true }),
  };
}

describe("SOURCE review surface", () => {
  it("defaults to EXTRACTED TEXT and switches to ORIGINAL without invalidating review", async () => {
    // This catches ORIGINAL replacing the global SOURCE mode or acting like a source mutation.
    render(<App services={services()} />);
    fireEvent.change(screen.getByLabelText("Add supported files"), {
      target: { files: [new File(["# Original heading"], "notes.md", { type: "text/markdown" })] },
    });
    await screen.findByDisplayValue("Reviewed source");
    fireEvent.click(screen.getByRole("button", { name: "Confirm review" }));

    const sourceTabs = screen.getByRole("tablist", { name: "Source view" });
    const tabs = within(sourceTabs).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["EXTRACTED TEXT", "ORIGINAL"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.click(tabs[1]);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("heading", { name: "Original heading" })).toBeInTheDocument();
    expect(screen.getAllByText("Review complete").length).toBeGreaterThan(0);

    fireEvent.click(tabs[0]);
    expect(screen.getByDisplayValue("Reviewed source")).toBeInTheDocument();
  });

  it("gives SOURCE and rich/raw tabs roving keyboard focus with controlled panels", async () => {
    // This catches nested tabs that announce as tabs but cannot be operated by keyboard or mapped to panels.
    render(<App services={services()} />);
    fireEvent.change(screen.getByLabelText("Add supported files"), {
      target: { files: [new File(["<h2>Original HTML</h2>"], "page.html", { type: "text/html" })] },
    });
    await screen.findByDisplayValue("Reviewed source");
    const sourceTabs = screen.getByRole("tablist", { name: "Source view" });
    const [extracted, original] = within(sourceTabs).getAllByRole("tab");
    extracted.focus();
    fireEvent.keyDown(extracted, { key: "End" });
    expect(original).toHaveFocus();
    expect(original).toHaveAttribute("aria-selected", "true");

    const formatTabs = await screen.findByRole("tablist", { name: "HTML view" });
    const [rich, raw] = within(formatTabs).getAllByRole("tab");
    expect(rich).toHaveAttribute("aria-controls");
    const richPanel = document.getElementById(rich.getAttribute("aria-controls") ?? "");
    expect(richPanel).toHaveAttribute("aria-labelledby", rich.id);
    rich.focus();
    fireEvent.keyDown(rich, { key: "ArrowRight" });
    expect(raw).toHaveFocus();
    expect(raw).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(raw, { key: "Home" });
    expect(rich).toHaveFocus();
  });
});
